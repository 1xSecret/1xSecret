# 1xSecret

[![CI](https://github.com/1xSecret/1xSecret/actions/workflows/ci.yml/badge.svg)](https://github.com/1xSecret/1xSecret/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)

Share secrets — OAuth client secrets, initial passwords, shared keys — as **end-to-end
encrypted one-time links** instead of leaving them in mailboxes forever. Secrets (up to
500 characters) are encrypted in the browser before anything is sent; the server only
ever stores ciphertext and can never decrypt it. Every secret can be viewed exactly
once, retrieval is protected by a cryptographic challenge-response so link scanners can
never burn a secret, and the creator gets a read receipt. Open source, self-hostable
with Docker or Helm.

## Features

- **End-to-end encryption in the browser** — AES-256-GCM; the key travels only in the
  URL fragment (`#v1.…`), which browsers never send to any server.
- **Optional retrieval password** — stretched with Argon2id and folded into the key
  derivation, so it is cryptographically required for both retrieval and decryption.
  It is never sent to the server, and a wrong password does **not** burn the secret.
- **Ed25519 challenge-response retrieval** — revealing a secret requires signing a
  fresh single-use challenge with a key derived from the link (and password). Mail
  gateways, link scanners, and chat previews only ever touch non-destructive endpoints
  and can never burn a secret.
- **Burn-on-read with read receipts** — the ciphertext is destroyed atomically at
  retrieval; two concurrent readers can never both receive it. The creator's local
  "My secrets" page shows when each secret was retrieved. Labels are stored only in
  the creator's browser.
- **Expiry from 10 minutes to 30 days** — `10m`, `1h`, `1d`, `7d`, `30d`.
- **German and English UI** — the instance default language is a runtime setting.
- **Two access modes** — `DANGEROUS-PUBLIC` (anyone can create and retrieve) or
  `SAFEGUARDED` (CIDR-restricted retrieval for corporate instances).
- **Opt-in search-engine indexing** — instances are `noindex` unless the operator
  enables indexing.
- **Operator-mounted legal pages** — drop markdown files (legal notice, terms) into a
  directory; pages and footer links appear automatically.
- **PostgreSQL** with optional read replicas and replica-safe migrations (Postgres
  advisory lock — any number of app replicas, CI jobs, or manual runs serialize).
- **Docker and Helm deployment** — one runtime-configured image
  (`ghcr.io/1xsecret/1xsecret`) serves every configuration.

## How it works

The full specification lives in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and
[docs/SECURITY.md](./docs/SECURITY.md). In short:

### Creating a secret

```
Browser                                     Server
   |  POST /api/secrets {expiresIn}           |
   |<-- {id, challenge} ----------------------|  empty pending row
   |                                          |
   |  masterKey = 32 random bytes             |
   |  keys      = HKDF(masterKey [+ Argon2id(password)])
   |              -> AES-256-GCM key + Ed25519 keypair
   |  encrypt plaintext, sign the challenge   |
   |                                          |
   |  PUT /api/secrets/{id}                   |
   |     {ciphertext, nonce, salt,            |
   |      publicKey, signature}               |  verify signature, store ciphertext
   |                                          |
   |  link = https://host/en/s/{id}#v1.<key>[.pw]
```

The URL fragment (`#…`) holds the key and never leaves the browser. The server stores
ciphertext it cannot decrypt.

### Retrieving a secret (view once)

```
Browser                                     Server
   |  GET /api/secrets/{id}/status            |  non-destructive — scanners stop here
   |  user clicks "Reveal once"               |
   |  (enters password if the link says so)   |
   |  POST /api/secrets/{id}/handshake        |
   |<-- {salt, challenge} --------------------|  single-use challenge, 2 min TTL
   |                                          |
   |  re-derive Ed25519 key from the fragment |
   |  (+ password), sign the challenge        |
   |  POST /api/secrets/{id}/retrieve         |
   |     {signature}                          |  verify vs stored public key,
   |<-- {ciphertext, nonce} ------------------|  ATOMIC burn: ciphertext nulled
   |                                          |
   |  decrypt locally, scrub fragment from URL
```

A wrong password produces an invalid signature, which the server rejects **without
burning the secret** — and without ever seeing the password. A wrong password can never
destroy a secret; repeated wrong guesses from the same client are instead slowed by a
per-`(secret, IP)` exponential backoff (stored in the database, IPs hashed), so the
legitimate recipient always keeps their one view.

## Quick start

### Docker Compose

```bash
git clone https://github.com/1xSecret/1xSecret.git
cd 1xSecret
cp .env.example .env       # set POSTGRES_PASSWORD (everything else has defaults)
docker compose up -d
```

The app is now on `http://localhost:3000`. [compose.yaml](./compose.yaml) starts
PostgreSQL, a one-shot advisory-locked migration service, and the app. For production,
put a TLS reverse proxy in front and set `TRUSTED_PROXIES` — see
[docs/SELF-HOSTING.md](./docs/SELF-HOSTING.md).

### Helm

```bash
helm install onexsecret oci://ghcr.io/1xsecret/charts/1xsecret \
  --set database.existingSecret.name=onexsecret-db-app \
  --set database.existingSecret.key=uri
```

The chart expects an external PostgreSQL and composes directly with the
[CloudNativePG](https://cloudnative-pg.io/) operator (`<cluster>-app` Secret, key
`uri`). Migrations run as a `pre-install,pre-upgrade` hook Job. Full walkthrough with
values examples: [docs/SELF-HOSTING.md](./docs/SELF-HOSTING.md).

## Configuration

All configuration is read from the environment **at runtime** — one prebuilt image
serves every configuration. Validation is fail-fast at server start.

| Variable                | Default                                    | Description                                                                                          |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | — (required)                               | PostgreSQL connection string (primary).                                                              |
| `DATABASE_REPLICA_URLS` | —                                          | Comma-separated read-replica connection strings. Reads that must be consistent always use the primary. |
| `APP_URL`               | —                                          | Canonical base URL (SEO: canonicals, sitemap). Falls back to the request host.                       |
| `DEFAULT_LANGUAGE`      | `en`                                       | Default UI language: `en` or `de`. A visitor's own language choice (cookie) wins.                    |
| `ACCESS_MODE`           | `DANGEROUS-PUBLIC`                         | `DANGEROUS-PUBLIC` or `SAFEGUARDED` (see below).                                                     |
| `SAFE_NETWORKS`         | —                                          | Comma-separated CIDRs. Required when `ACCESS_MODE=SAFEGUARDED`.                                      |
| `TRUSTED_PROXIES`       | —                                          | Comma-separated CIDRs of reverse proxies / load balancers in front of the app.                       |
| `ALLOW_INDEXING`        | `false`                                    | Opt-in search-engine indexing (`true`/`1`/`yes`).                                                    |
| `RETENTION_DAYS`        | `30`                                       | Days to keep read-receipt rows (no ciphertext) after burn/expiry. Integer 0–3650.                    |
| `RATE_LIMIT_HASH_SECRET`| — (derived from `DATABASE_URL`)            | Optional pepper for hashing client IPs in the retrieval backoff. Only set to rotate it independently. |
| `LEGAL_DIR`             | `<working dir>/legal` (`/app/legal` in the container) | Directory with operator-provided legal markdown files (`legal-notice-`, `tos-`, `privacy-{en,de}.md`). |
| `APP_NAME`              | `1xSecret`                                 | Display name in the header, tab title and OpenGraph.                                                 |
| `BRAND_LOGO_PATH`       | —                                          | Absolute path to a mounted logo file shown in the header (svg/png/…).                                 |
| `LANDING_MODE`          | `full`                                     | `full` (marketing landing) or `minimal` (just the form with a neutral heading).                      |
| `SHOW_SOURCE_LINK`      | `true`                                     | Show the source-repo link in the footer (the "based on 1xSecret" attribution always stays).          |
| `SOURCE_URL`            | upstream project                           | URL the footer source link / attribution points at.                                                  |
| `MESSAGES_OVERRIDE_DIR` | —                                          | Directory with `<locale>.json` partial message overrides, deep-merged over the built-in texts.       |
| `PORT` / `HOSTNAME`     | `3000` / `0.0.0.0`                         | Bind address of the standalone server.                                                               |

## White-label / branding

The single prebuilt image can be rebranded entirely through configuration — no fork
needed. Set `APP_NAME`, mount a logo and point `BRAND_LOGO_PATH` at it, choose
`LANDING_MODE=minimal` for an internal instance (drops the marketing sections and uses a
neutral heading), mount your own legal/privacy markdown, and change any individual string
by mounting `<locale>.json` files into `MESSAGES_OVERRIDE_DIR` (deep-merged over the
defaults). `SHOW_SOURCE_LINK=false` hides the footer repo link. Per the AGPL, a short
"based on the open-source project 1xSecret" attribution is always shown; point `SOURCE_URL`
at your own modified sources to satisfy the network-use clause. See
[docs/SELF-HOSTING.md](./docs/SELF-HOSTING.md#white-label--branding).

## SAFEGUARDED mode

`SAFEGUARDED` is built for corporate instances: sharing secrets with partners without
opening a public secret-sharing service to the whole internet.

- Secrets created **from a safe network** (`SAFE_NETWORKS`) can be retrieved by anyone
  — you can send secrets *to* external partners.
- Secrets created **from outside** can only be retrieved *from* a safe network —
  partners can send secrets *to* you, but third parties cannot exchange secrets among
  themselves through your instance.
- Creation is open to everyone; the status endpoint tells the UI when retrieval is
  restricted so it can explain why.

### Client-IP trust model

CIDR checks are only as good as the client IP they see, so 1xSecret anchors IP
resolution to the TCP socket: a server hook always overwrites an internal header with
`socket.remoteAddress` before the request is handled, so a client-supplied value can
never get through.

- **No proxy** (app port exposed directly): the socket peer *is* the client. Spoofed
  `X-Forwarded-For` headers are ignored entirely.
- **Behind proxies**: if the socket peer is inside `TRUSTED_PROXIES`, the
  `X-Forwarded-For` chain is walked right-to-left and the first entry that is not
  itself a trusted proxy is the client ("rightmost untrusted").

When a proxy is used, the app port must be reachable **only** through that proxy;
otherwise anyone who can connect from a trusted-proxy address range could forge the
header. Deployment recipes: [docs/SELF-HOSTING.md](./docs/SELF-HOSTING.md).

## Legal pages

Operators mount markdown files into `LEGAL_DIR`:

| File                                     | Route                    |
| ---------------------------------------- | ------------------------ |
| `legal-notice-en.md`, `legal-notice-de.md` | `/{locale}/legal-notice` |
| `tos-en.md`, `tos-de.md`                 | `/{locale}/terms`        |

A page (and its footer link) exists if and only if the file for the instance's
**default language** exists. A missing translation falls back to the default-language
file, with a note about the displayed language. Rendered as markdown; raw HTML is not
interpreted. Example files: [legal-examples/](./legal-examples).

## Development

Requirements: Node >= 20.9, pnpm 11 (via corepack), Docker (for a local PostgreSQL).

```bash
pnpm install

# local PostgreSQL
docker run -d --name onexsecret-dev-db \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=onexsecret \
  -p 55432:5432 postgres:18-alpine

# .env.local
echo 'DATABASE_URL=postgres://postgres:dev@localhost:55432/onexsecret' >> .env.local

DATABASE_URL=postgres://postgres:dev@localhost:55432/onexsecret pnpm db:migrate
pnpm dev
```

Checks: `pnpm test` (Vitest), `pnpm typecheck`, `pnpm lint`. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

## Client SDK

[`@1xsecret/sdk`](./sdk) is a small TypeScript client for sealing and revealing secrets
from a backend against any 1xSecret instance (default `https://1xsecret.com`):

```ts
import { OneXSecretClient } from "@1xsecret/sdk";

const client = new OneXSecretClient({ apiUrl: "https://secrets.your-company.com" });
const { link } = await client.seal({ text: "client_secret=…", password, expiresIn: "1d" });
const secret = await client.reveal({ link, password });
```

The SDK is **MIT-licensed** — deliberately more permissive than the server — so it can be
used in any project, including closed-source and commercial ones. See [sdk/README.md](./sdk/README.md).

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — canonical technical specification
- [docs/SECURITY.md](./docs/SECURITY.md) — threat model and cryptographic details
- [docs/SELF-HOSTING.md](./docs/SELF-HOSTING.md) — operations guide (compose, Helm, proxies, scaling, backups)
- [sdk/README.md](./sdk/README.md) — client SDK usage
- [CONTRIBUTING.md](./CONTRIBUTING.md) — development setup and PR guidelines
- [SECURITY.md](./SECURITY.md) — vulnerability reporting policy

## License

The **server/app** is [GNU AGPL-3.0-or-later](./LICENSE): the AGPL's network-use clause
(section 13) means anyone who runs a modified version as a network service must offer that
version's source to its users — so improvements stay open and 1xSecret cannot be turned
into a closed-source paid product.

The **client SDK** ([`@1xsecret/sdk`](./sdk)) is separately **MIT-licensed** so it can be
embedded in any application, including proprietary ones. A client that only talks to the
1xSecret HTTP API is not a derivative of the AGPL server, so this combination is sound.
