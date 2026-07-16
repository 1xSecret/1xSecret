# 1xSecret — Architecture

1xSecret is a self-hostable web service for sharing secrets (text up to 500 characters)
via one-time links. Secrets are encrypted **end-to-end in the browser**; the server only
ever stores ciphertext and can never decrypt it. Every secret can be viewed exactly once.

This document is the canonical technical specification. See [SECURITY.md](./SECURITY.md)
for the threat model and cryptographic details.

## Stack

| Concern      | Choice                                                              |
| ------------ | ------------------------------------------------------------------- |
| Framework    | Next.js 16 (App Router, `output: 'standalone'`, Route Handlers)     |
| UI           | React 19, Tailwind CSS v4, shadcn/ui (Base UI primitives)           |
| i18n         | next-intl 4, `[locale]` routing, `localePrefix: 'always'`, de + en  |
| Database     | PostgreSQL (16+; images/docs use 18), Drizzle ORM, node-postgres    |
| Client crypto| WebCrypto (AES-256-GCM, HKDF), hash-wasm (Argon2id), @noble/curves (Ed25519) |
| Deployment   | Docker / docker-compose, Helm chart (OCI), GHCR images (amd64+arm64)|

## Data flow

### Creating a secret (two-phase)

```
Browser                                  Server
   |  POST /api/secrets                    |
   |     { expiresIn }                     |
   |<--- { id, challenge } ----------------|   row created: state=pending
   |                                       |
   |  [client-side — all values below are freshly random for THIS secret]
   |  masterKey = random 32 bytes          |
   |  salt      = random 16 bytes          |
   |  nonce     = random 12 bytes          |
   |  ikm       = masterKey                  (no password), or
   |             concat(masterKey, Argon2id(password, salt))   (password set)
   |  encKey    = HKDF(ikm, salt, "1xsecret/v1/enc")
   |  authSeed  = HKDF(ikm, salt, "1xsecret/v1/auth")
   |  keypair   = Ed25519 from authSeed (deterministic)
   |  ciphertext= AES-256-GCM(encKey, nonce, plaintext, aad="1xsecret/v1")
   |  signature = sign("1xsecret/v1/seal:"+id+":"+challenge)
   |                                       |
   |  PUT /api/secrets/{id}                |
   |     { ciphertext, nonce, salt,        |
   |       publicKey, signature }          |   verify signature w/ publicKey,
   |<--- { ok } ---------------------------|   row sealed: state=sealed
   |                                       |
   |  link = https://host/{locale}/s/{id}#v1.<base64url(masterKey)>[.pw]
```

The URL fragment (`#...`) is never sent to any server. The optional `.pw` suffix tells
the retrieval page to render a password field; whether a secret has a password is never
stored server-side or exposed through any endpoint.

### Retrieving a secret (two-phase, burn-on-read)

```
Browser                                  Server
   |  GET /api/secrets/{id}/status         |   non-destructive:
   |                                       |     { status: available|restricted|unavailable }
   |                                       |   (link previews/scanners can never burn)
   |  user clicks "Reveal once"            |
   |  [enters password if link has .pw]    |
   |                                       |
   |  POST /api/secrets/{id}/handshake     |
   |<--- { salt, challenge } --------------|   challenge: single-use, 2 min TTL
   |                                       |
   |  re-derive authSeed from fragment key |
   |  (+ password), sign                   |
   |  "1xsecret/v1/reveal:"+id+":"+challenge
   |                                       |
   |  POST /api/secrets/{id}/retrieve      |
   |     { signature }                     |   verify vs stored publicKey;
   |<--- { ciphertext, nonce } ------------|   ATOMIC: null ciphertext, set retrievedAt
   |                                       |
   |  decrypt locally, show plaintext      |
   |  history.replaceState() scrubs the fragment
```

A wrong password produces a wrong `authSeed`, hence an invalid signature: the server
rejects the attempt **without burning the secret** and without ever seeing the password.
A wrong password can **never** destroy a secret. Online guessing is instead slowed by a
per-`(secret, client-IP)` exponential backoff stored in the database (see
`retrieval-throttle.ts`): after every 2 failures a lockout is applied, doubling from 30 s
(30 s → 60 s → 120 s → …, capped at 1 h), during which further attempts from that address
are refused (HTTP 429) without touching the secret. The client IP is stored only as an
HMAC (`ip-hash.ts`), never in plaintext, and because the throttle lives in Postgres it is
consistent across replicas. Scoping to the IP means an attacker can only slow down their
own guessing and can never lock out the legitimate recipient, who retrieves from a
different address.

The burn is a single atomic statement (`UPDATE ... FROM (SELECT ... FOR UPDATE)
RETURNING`), so two concurrent readers can never both receive the ciphertext. The row
itself (id, createdAt, retrievedAt, expiresAt — no ciphertext) is kept for
`RETENTION_DAYS` (default 30) so the creator can see when the secret was read, then
deleted by the sweeper.

### Creator's local history

The create page stores `{ id, label?, createdAt, expiresAt, hasPassword }` in
`localStorage` (never the key, never the plaintext). The "My secrets" page polls
`POST /api/secrets/status` with the stored ids to show pending / retrieved (when) /
expired. Labels exist only in the browser.

## HTTP API

All endpoints are JSON Route Handlers under `/api`. Errors use
`{ error: { code, message } }` with stable machine-readable codes. Responses for
missing/expired/burned secrets are indistinguishable (`SECRET_UNAVAILABLE`) to avoid
existence oracles.

| Method | Path                        | Purpose                                        |
| ------ | --------------------------- | ---------------------------------------------- |
| POST   | `/api/secrets`              | Init: `{expiresIn}` → `{id, challenge}`        |
| PUT    | `/api/secrets/{id}`         | Seal: ciphertext + publicKey + seal signature  |
| GET    | `/api/secrets/{id}/status`  | Non-destructive status for the reveal page     |
| POST   | `/api/secrets/{id}/handshake` | Fresh single-use challenge + salt            |
| POST   | `/api/secrets/{id}/retrieve`| Verify signature, atomic burn (429 when throttled) |
| POST   | `/api/secrets/status`       | Batch status for the creator's local history   |
| GET    | `/api/config`               | `{mode, clientIsSafe, defaultLanguage, maxSecretLength}` |
| GET    | `/api/health`               | Liveness (no DB)                               |
| GET    | `/api/ready`                | Readiness (DB `SELECT 1`)                      |

`expiresIn` is an enum: `10m`, `1h`, `1d`, `7d`, `30d`.

## Access modes

- **`DANGEROUS-PUBLIC`** (default): anyone can create and retrieve.
- **`SAFEGUARDED`**: requires `SAFE_NETWORKS` (comma-separated CIDRs, **IPv4 and IPv6**;
  IPv4-mapped IPv6 clients like `::ffff:10.0.0.1` match IPv4 CIDRs transparently).
  - Created from a safe network → anyone may retrieve.
  - Created from outside → retrieval only from safe networks (status/handshake/retrieve
    all enforce it; the status endpoint tells the UI so it can explain the restriction).
  - Creation is open to everyone (third parties can send secrets *to* the operator),
    but third parties cannot exchange secrets among themselves.

### Client IP resolution

Route handlers cannot see the TCP socket, and `X-Forwarded-For` from the wire is
spoofable when no proxy is in front. 1xSecret therefore anchors IP resolution to the
socket in `instrumentation.ts`: a hook on the Node HTTP server **always overwrites**
the internal header `x-1xsecret-socket-ip` with `socket.remoteAddress` before Next.js
handles the request — external values can never survive.

Resolution algorithm (`src/lib/server/client-ip.ts`):

1. `socketIp` = `x-1xsecret-socket-ip` (always trustworthy).
2. If `TRUSTED_PROXIES` (CIDRs) is set **and** `socketIp` matches it, walk
   `X-Forwarded-For` right-to-left and return the first entry not in
   `TRUSTED_PROXIES`; if all entries are trusted, return the leftmost.
3. Otherwise return `socketIp` (direct exposure: header spoofing is ineffective).

This is safe with a proxy chain *and* without any proxy at all.

## Configuration (runtime env vars)

All variables are read at request/boot time — one image serves every configuration.
`NEXT_PUBLIC_*` is deliberately not used (build-time inlining).

| Variable                | Default            | Notes                                        |
| ----------------------- | ------------------ | -------------------------------------------- |
| `DATABASE_URL`          | — (required)       | Postgres connection string                   |
| `DATABASE_REPLICA_URLS` | —                  | Comma-separated read replicas (`withReplicas`); reads that must be consistent use the primary |
| `APP_URL`               | —                  | Canonical base URL (SEO, sitemap). Falls back to request host |
| `DEFAULT_LANGUAGE`      | `en`               | `en` or `de`; runtime default locale         |
| `ACCESS_MODE`           | `DANGEROUS-PUBLIC` | or `SAFEGUARDED`                             |
| `SAFE_NETWORKS`         | —                  | IPv4/IPv6 CIDRs; required when `SAFEGUARDED` |
| `TRUSTED_PROXIES`       | —                  | IPv4/IPv6 CIDRs of reverse proxies / LBs     |
| `ALLOW_INDEXING`        | `false`            | Opt-in search engine indexing                |
| `RETENTION_DAYS`        | `30`               | Keep read-receipt rows after burn/expiry     |
| `RATE_LIMIT_HASH_SECRET`| —                  | Pepper for the IP HMAC in the retrieval backoff; derived from `DATABASE_URL` when unset |
| `LEGAL_DIR`             | `/app/legal`       | Mounted markdown dir for legal pages         |
| `PORT` / `HOSTNAME`     | `3000` / `0.0.0.0` | Standalone server bind                       |

Config is validated fail-fast in `instrumentation.ts` (e.g. `SAFEGUARDED` without
`SAFE_NETWORKS` refuses to start).

## Database

Two tables (see `src/lib/server/db/schema.ts`).

`secrets`:

```
id                text PK (nanoid(21), ~126-bit random)
state             text: pending | sealed | retrieved
ciphertext        bytea NULL   (nulled at burn)
nonce             bytea NULL
salt              bytea NULL
public_key        bytea NULL   (Ed25519, 32 bytes)
challenge         bytea NULL   (single-use, rotated by handshake)
challenge_expires_at timestamptz NULL
created_from_safe boolean
expires_in        text (enum, for creator display)
created_at / sealed_at / retrieved_at / expires_at   timestamptz
```

`retrieval_attempts` — the per-`(secret, IP)` guessing backoff:

```
secret_id     text  FK secrets(id) ON DELETE CASCADE
ip_hash       text  (HMAC-SHA256 of the client IP; raw IPs never stored)
fail_count    int
locked_until  timestamptz NULL
updated_at    timestamptz
PRIMARY KEY (secret_id, ip_hash)
```

- **Migrations**: generated SQL files in `drizzle/` (via `drizzle-kit generate` at
  development time), applied by `scripts/migrate.mjs` — a standalone runner (its only
  runtime dependency, `pg`, ships in the standalone image) that applies pending files in
  filename order and records them by content hash in a `_1xsecret_migrations` table,
  all under `pg_advisory_lock(745839201701)` on a dedicated connection. Concurrent runs
  (5 replicas, CI, compose) serialize safely; it is the only supported way to apply
  migrations (`drizzle-kit` is generate-only). docker-compose runs it as a one-shot
  service; the Helm chart as a `pre-install,pre-upgrade` hook Job. The app never
  migrates on boot.
- **Sweeper**: `instrumentation.ts` starts a 10-minute interval (guarded by
  `pg_try_advisory_lock`, `.unref()`ed) that destroys expired ciphertext and deletes
  rows past retention. The security boundary is *not* the sweeper: every read predicate
  checks `expires_at > now()`.
- **Read replicas**: optional; status reads may lag, burn/retrieve always hit the primary.

## Internationalization

- `[locale]` URL segment, always prefixed (`/en/...`, `/de/...`); unprefixed requests
  are redirected in `proxy.ts` using the runtime `DEFAULT_LANGUAGE` (cookie wins for
  returning visitors).
- Messages in `messages/{en,de}.json`, PascalCase namespaces, ICU plurals; type-safe
  keys via `AppConfig` augmentation.
- Legal pages: operator mounts markdown files into `LEGAL_DIR`
  (`legal-notice-{en|de}.md`, `tos-{en|de}.md`). A page + footer link exists iff the
  file for the **default language** exists; missing translations fall back to the
  default-language file. Rendered with react-markdown (no raw HTML).

## SEO

- Opt-in via `ALLOW_INDEXING`: `X-Robots-Tag: noindex, nofollow` header in `proxy.ts`
  (runtime-authoritative), plus `robots.ts`/`sitemap.ts` that read the env per request
  (`await connection()`).
- Secret pages (`/s/[id]`) are `noindex` and sitemap-excluded in **all** configurations.
- Per-locale self-referencing canonicals, bidirectional hreflang + `x-default`,
  localized OG image (`opengraph-image.tsx`), WebApplication JSON-LD (no FAQPage —
  discontinued by Google), tool-first landing page with real HTML FAQ content.

## Repository layout

```
src/app/[locale]/          pages (landing+create, s/[id], secrets, legal/[slug])
src/app/api/               route handlers
src/lib/crypto/            isomorphic crypto core (browser + tests)
src/lib/server/            config, db, client-ip, cidr, challenges, rate limit
src/components/            UI (shadcn in components/ui)
messages/                  de.json, en.json
drizzle/                   generated SQL migrations
scripts/migrate.mjs        advisory-lock migration runner
deploy/helm/1xsecret/     Helm chart
Dockerfile, compose.yaml
docs/                      ARCHITECTURE.md, SECURITY.md, SELF-HOSTING.md
```
