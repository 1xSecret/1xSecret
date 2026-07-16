# 1xSecret — Security

This document describes the exact cryptographic scheme and the threat model. The
implementation lives in `src/lib/crypto/` (isomorphic, unit-tested) and
`src/lib/server/secrets.ts`; this document is written to match the code — if they ever
disagree, that is a bug worth reporting.

For the vulnerability reporting policy see [SECURITY.md](../SECURITY.md) in the
repository root.

## Design goals

1. The server must never be able to decrypt a secret — not live, not from a database
   dump, not with the operator's cooperation.
2. A secret can be viewed exactly once, and nobody except the intended reveal action
   can consume that one view (no burning by link scanners, previews, or crawlers).
3. An optional password must be a real cryptographic factor, not a UI gate — and
   guessing it must not destroy the secret.

## Cryptographic scheme (`1xsecret/v1`)

All parameters are versioned under the `1xsecret/v1` label (AAD, HKDF info strings,
signature contexts, fragment prefix). Changing any parameter requires a new version
tag so existing links keep decrypting.

### Key material and derivation

Every secret gets its own freshly random `masterKey`, `salt` and `nonce` — nothing
is reused between secrets.

```
masterKey = 32 random bytes            (per secret; generated in the browser, never sent)
salt      = 16 random bytes            (per secret; stored server-side, returned at handshake)

ikm       = masterKey                                        (no password)
          = concat(masterKey, Argon2id(password, salt))      (password set)

encKey    = HKDF-SHA256(ikm, salt, info="1xsecret/v1/enc")   -> AES-256-GCM key
authSeed  = HKDF-SHA256(ikm, salt, info="1xsecret/v1/auth")  -> Ed25519 seed (32 bytes)
```

(`concat` = byte concatenation, i.e. the master key followed by the Argon2id output.)

- The AES key is imported as a **non-extractable** WebCrypto key; its bytes never
  materialize in JavaScript.
- The Ed25519 keypair (`@noble/curves`) is derived deterministically from `authSeed`;
  the public key is stored server-side at seal time.
- `encKey` and `authSeed` are computationally independent HKDF branches: the server,
  which learns the public key and signatures, gains nothing towards decryption.
- Argon2id parameters (hash-wasm): **m = 19456 KiB, t = 2, p = 1**, 32-byte output
  (OWASP Password Storage Cheat Sheet baseline). The password is NFC-normalized before
  hashing. Argon2id runs only when a password is set — the random 256-bit master key
  needs no stretching.

### Encryption

- AES-256-GCM with a fresh random **12-byte nonce** per encryption.
- Domain-separation AAD: `"1xsecret/v1"`.
- Plaintext is UTF-8; the client enforces a 500-character maximum, the server caps the
  sealed ciphertext at 8192 bytes as a sanity bound.

### The link

```
https://host/{locale}/s/{id}#v1.<base64url(masterKey)>[.pw]
```

- The **URL fragment** carries the master key. Browsers never send fragments in HTTP
  requests, so no server, proxy, or access log ever sees it.
- The optional `.pw` suffix tells the retrieval page to render a password field. Whether
  a secret has a password is a purely client-side flag — the server never stores it and
  no endpoint exposes it, so it cannot be learned from the database or the API.
- `{id}` is a 21-character nanoid (~126 bits of entropy) — an unguessable capability.
- After a successful reveal the page scrubs the fragment from the address bar via
  `history.replaceState`, so the key does not linger in the visible URL.

### Challenge-response signatures

Both writing (seal) and reading (reveal) require an Ed25519 signature over a message
that binds **purpose, secret id, and a server-issued challenge**, so a signature can
never be replayed for another secret, another challenge, or another operation:

```
"1xsecret/v1/seal:{id}:{challenge}"      seal   — challenge TTL 15 minutes
"1xsecret/v1/reveal:{id}:{challenge}"    reveal — challenge TTL  2 minutes
```

(`{challenge}` is the base64url form of 32 random bytes.)

Challenges are **single-use**: sealing clears the challenge in the same conditional
update that stores the ciphertext; each reveal handshake rotates the challenge, and the
burn statement re-checks the exact challenge value it verified.

### Atomic burn

Retrieval executes a single atomic statement:

```sql
UPDATE secrets s
SET ciphertext = NULL, nonce = NULL, salt = NULL, public_key = NULL,
    challenge = NULL, challenge_expires_at = NULL,
    state = 'retrieved', retrieved_at = now()
FROM (
  SELECT id, ciphertext, nonce FROM secrets
  WHERE id = ... AND state = 'sealed'
    AND challenge = ... AND challenge_expires_at > now() AND expires_at > now()
  FOR UPDATE
) old
WHERE s.id = old.id
RETURNING old.ciphertext, old.nonce
```

The inner `SELECT ... FOR UPDATE` serializes concurrent retrievers; `RETURNING` reads
from the locked pre-update row, so exactly one caller receives the old (non-null)
payload and every other caller gets nothing. All payload columns (ciphertext, nonce,
salt, public key, challenge) are nulled in the same statement.

The remaining receipt row (id and timestamps only — no payload) is kept for
`RETENTION_DAYS` (default 30) so the creator can see when the secret was read, then
deleted by the sweeper. Expiry is enforced by every read predicate
(`expires_at > now()`); the periodic sweeper is garbage collection, not a security
boundary.

## Threat model

### What the server stores and sees

Stored per secret: id, state, ciphertext, nonce, salt, Ed25519 public key, the current
challenge, a failed-attempt counter, a created-from-safe-network flag, and timestamps
(created / sealed / retrieved / expires). Observed per request: client IP (rate
limiting, SAFEGUARDED checks) and the usual HTTP metadata.

The server never sees: the plaintext, the master key, the password, any derived key,
or even whether a password is set.

### Database dump alone

Nothing decryptable. The ciphertext is AES-256-GCM under a key derived from a 256-bit
random master key that exists only in the creator's and recipient's links. The stored
public key is on an independent HKDF branch and contributes nothing to decryption.
Salts and challenges are worthless without the master key.

### Link interception

A link is a bearer capability: whoever holds it (and the password, if set) can retrieve
the secret — once. The one-time semantics turn silent theft into a detectable event: if
an interceptor uses the link, the intended recipient finds the secret already
retrieved, and the creator's read receipt shows a retrieval that the recipient will
deny. Compromise is not prevented, but it cannot go unnoticed, and the parties know to
rotate the exposed credential.

### Link scanners and previews

Mail gateways, chat link previews, and crawlers fetch URLs automatically. In 1xSecret,
merely loading the page (or calling `GET /api/secrets/{id}/status`) is non-destructive.
Consuming the secret requires executing the reveal flow: an explicit user action, a
handshake, and a valid Ed25519 signature over a fresh challenge. Automated fetchers
never do this, so they can never burn a secret.

### Password as a second factor

The password is folded into the IKM, so it is cryptographically required for **both**
the reveal signature and decryption — there is no server-side "password check" to
bypass. Consequences:

- **Wrong password ≠ burned secret.** A wrong password yields a wrong `authSeed`,
  hence an invalid signature; the server rejects the attempt and the ciphertext stays
  intact. A wrong password can **never** destroy a secret, so no third party who guesses
  can deny the legitimate recipient their one view. Legitimate typos are harmless.
- **Online guessing is slowed by exponential backoff.** Failed attempts are recorded per
  `(secret, client-IP)` in the database (`retrieval_attempts`), and after every 2 failures
  a lockout is applied that doubles from 30 s (30 s → 60 s → 120 s → …, capped at 1 h),
  during which further attempts from that address are refused with HTTP 429 — the signature
  is not even checked. Because the state lives in Postgres, the backoff is consistent
  across all replicas. The client IP is stored only as an HMAC (pepper from
  `RATE_LIMIT_HASH_SECRET`, or derived from `DATABASE_URL`), never in plaintext. Scoping to
  the IP means an attacker only throttles their own address and can never lock out the
  recipient (a different address); an in-memory 30 req/min per-IP limiter is a cheap first
  line in front of it. The residual risk is an attacker rotating many IPs (a botnet) —
  which is bounded by the Argon2id cost per guess and by the fact that the link itself is
  a second, high-entropy factor the attacker must also possess.
- **Offline guessing is expensive.** An attacker holding both the link *and* a
  database dump (or a burned link plus the dump taken before the burn) must brute-force
  the password against Argon2id (m = 19456 KiB, t = 2, p = 1) per guess — and only for
  that one secret, since each secret has its own random salt and master key.

### Malicious or compromised server

The server delivers the JavaScript that performs the client-side cryptography. A
malicious operator (or an attacker who controls the app origin) could serve modified
code that exfiltrates keys or plaintext. **This is an inherent limit of web-delivered
cryptography**, not something 1xSecret can solve in-browser. Mitigations:

- The code is open source and auditable; the crypto core is small and isolated.
- Self-hosting puts the serving infrastructure under the same trust domain as the
  secrets being shared — the primary deployment model for 1xSecret.
- TLS protects the delivered code and API traffic in transit.

What even a fully malicious server can **not** do retroactively: decrypt ciphertext it
stored while serving honest code, since it never received key material.

## Intentionally not protected

- **Ciphertext length.** AES-GCM preserves plaintext length (plus a 16-byte tag), so
  the server learns the approximate length of a secret (bounded by the 500-character
  maximum). Padding was deliberately omitted.
- **Existence, to link holders.** `GET /api/secrets/{id}/status` tells whoever knows an
  id whether the secret is still available. Ids are unguessable ~126-bit capabilities,
  so this "oracle" only informs parties who already hold the link — and it is what
  powers the recipient page and the creator's read receipts. For everyone else,
  missing, expired, and burned secrets are indistinguishable (`SECRET_UNAVAILABLE`).
- **Traffic metadata.** The operator sees IPs and timing like any web service.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub private vulnerability reporting](https://github.com/1xSecret/1xSecret/security/advisories/new)
("Security" tab → "Report a vulnerability"). Do not open public issues for security
problems. See [SECURITY.md](../SECURITY.md) for the policy.
