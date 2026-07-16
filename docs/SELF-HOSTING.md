# 1xSecret — Self-Hosting Guide

1xSecret ships as a single runtime-configured container image,
`ghcr.io/1xsecret/1xsecret` (amd64 + arm64). All configuration is read from the
environment at runtime — see the [configuration table](../README.md#configuration) —
so the same image serves every deployment.

Requirements:

- PostgreSQL 16+ (the examples and images use 18)
- A TLS reverse proxy or ingress for anything beyond local testing

Contents:

- [Docker Compose](#docker-compose)
- [Reverse proxy (Caddy, nginx)](#reverse-proxy)
- [Client IPs and TRUSTED_PROXIES](#client-ips-and-trusted_proxies)
- [SAFEGUARDED mode recipes](#safeguarded-mode-recipes)
- [Helm / Kubernetes](#helm--kubernetes)
- [Legal pages](#legal-pages)
- [Scaling](#scaling)
- [Read replicas](#read-replicas)
- [Backups](#backups)
- [Updating](#updating)
- [Monitoring](#monitoring)

## Docker Compose

[`compose.yaml`](../compose.yaml) starts three services:

1. `db` — PostgreSQL 18 with a named volume and a healthcheck.
2. `migrate` — a one-shot migration runner (`node scripts/migrate.mjs`). It holds a
   Postgres advisory lock, so concurrent runs are safe; the app never migrates on boot.
3. `app` — the application, started only after `migrate` completed successfully.

```bash
git clone https://github.com/1xSecret/1xSecret.git
cd 1xSecret
cp .env.example .env
# edit .env: POSTGRES_PASSWORD is required; everything else has defaults
docker compose up -d
```

The app listens on `:3000`. All application settings (`APP_URL`, `DEFAULT_LANGUAGE`,
`ACCESS_MODE`, `SAFE_NETWORKS`, `TRUSTED_PROXIES`, `ALLOW_INDEXING`, `RETENTION_DAYS`)
are passed through from `.env`.

To serve legal pages, mount your markdown directory read-only into the container
(see [Legal pages](#legal-pages)):

```yaml
# compose override for the app service
volumes:
  - ./legal:/app/legal:ro
```

For production, run a reverse proxy with TLS in front (next section) and bind the app
port to localhost only so it is reachable exclusively through the proxy:

```yaml
# compose override for the app service
ports:
  - "127.0.0.1:3000:3000"
```

## Reverse proxy

The app itself speaks plain HTTP. Terminate TLS at a reverse proxy and forward
`X-Forwarded-For` and `X-Forwarded-Proto`. Whenever a proxy is in front, set
`TRUSTED_PROXIES` to the address range the proxy connects **from** (as seen by the
app), and make sure the app port is not reachable any other way.

### Caddy

Caddy handles TLS certificates and sets `X-Forwarded-For` / `X-Forwarded-Proto`
automatically:

```caddyfile
secrets.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

A host proxy connecting to a **published container port** does not reach the container
as `127.0.0.1`: Docker's port publishing rewrites the source address, so the container's
socket peer is the Docker bridge gateway. Use `TRUSTED_PROXIES=172.16.0.0/12` (the
Docker bridge range) for that case as well as for a Caddy that runs as another compose
service on the same network. `127.0.0.1/32` is correct only when the app runs directly
on the host (`node server.js`) or the container uses `network_mode: host`.

### nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name secrets.example.com;

    # ssl_certificate     /etc/letsencrypt/live/secrets.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/secrets.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`$proxy_add_x_forwarded_for` appends the connecting client to any existing
`X-Forwarded-For` chain, which is exactly what the rightmost-untrusted resolution
expects.

## Client IPs and TRUSTED_PROXIES

Rate limiting and `SAFEGUARDED` CIDR checks depend on the client IP, so its resolution
is designed to be spoof-proof (details in
[ARCHITECTURE.md](./ARCHITECTURE.md#client-ip-resolution)):

1. A server hook always overwrites an internal header with the TCP socket's
   `remoteAddress` — a client-supplied value can never get through.
2. If the socket peer is **not** in `TRUSTED_PROXIES`, the socket peer *is* the client;
   any `X-Forwarded-For` header is ignored. Direct exposure without a proxy is
   therefore safe by default (with `TRUSTED_PROXIES` unset, nothing is ever trusted).
3. If the socket peer **is** a trusted proxy, `X-Forwarded-For` is walked
   right-to-left and the first entry that is not itself a trusted proxy is the client.

Guidance:

| Deployment                                   | `TRUSTED_PROXIES`                                  |
| -------------------------------------------- | -------------------------------------------------- |
| No proxy (direct exposure)                   | leave unset                                        |
| App directly on host (`node server.js`) behind a host proxy | `127.0.0.1/32` (add `::1/128` if it uses IPv6) |
| Proxy → published container port, or proxy as a compose service | `172.16.0.0/12` (Docker bridge range — the container sees the bridge gateway, not `127.0.0.1`) |
| Kubernetes ingress                           | your cluster's pod/node CIDRs — often the RFC1918 ranges `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` |
| External LB/CDN in front of your proxy       | add the LB/CDN egress ranges as published by the provider |

Two rules of thumb:

- Every hop that legitimately connects to the app (or to the next proxy) and appends
  to `X-Forwarded-For` must be covered by `TRUSTED_PROXIES`; otherwise all traffic
  appears to originate from the proxy's IP.
- Nothing else may be able to connect from those ranges. When a proxy is used, do not
  expose the app port to clients directly.

`SAFEGUARDED` deployments must run the stock Node server from the image (the standalone
`server.js`) — the socket-anchoring hook is installed at server start and other
runtimes are unsupported for CIDR enforcement.

## SAFEGUARDED mode recipes

Semantics (see [README](../README.md#safeguarded-mode)): secrets created from
`SAFE_NETWORKS` are retrievable by anyone; secrets created from outside are retrievable
only from `SAFE_NETWORKS`; creation is open to everyone.

**Corporate instance — office network + VPN.** Employees (office egress
`203.0.113.0/24`, VPN pool `10.8.0.0/16`) exchange secrets with external partners in
both directions, but third parties cannot use the instance among themselves:

```bash
ACCESS_MODE=SAFEGUARDED
SAFE_NETWORKS=203.0.113.0/24,10.8.0.0/16
TRUSTED_PROXIES=172.16.0.0/12   # the reverse proxy in front
```

Notes:

- `SAFE_NETWORKS` is matched against the *resolved client IP*, so `TRUSTED_PROXIES`
  must be correct — get it wrong and either everyone or no one is "safe".
- IPv6 CIDRs work; if your networks are dual-stack, list both.
- The status endpoint tells restricted visitors that retrieval is network-restricted
  (without leaking anything else), so recipients get a clear message instead of a
  generic error.
- The server startup fails fast if `ACCESS_MODE=SAFEGUARDED` is set without
  `SAFE_NETWORKS`.

## Helm / Kubernetes

The chart is published as an OCI artifact: `oci://ghcr.io/1xsecret/charts/1xsecret`
(sources in [`deploy/helm/1xsecret`](../deploy/helm/1xsecret)). It deploys the app
plus a `pre-install,pre-upgrade` hook Job for migrations, and expects an **external
PostgreSQL** — either bring a connection string or use an operator like
[CloudNativePG](https://cloudnative-pg.io/) (CNPG).

### With CloudNativePG

CNPG generates a `<cluster>-app` Secret whose connection string lives under the key
`uri`; the chart's `database.existingSecret` points straight at it:

```yaml
# cnpg-cluster.yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: onexsecret-db
spec:
  instances: 2
  storage:
    size: 5Gi
```

```yaml
# values-prod.yaml
replicaCount: 2

database:
  existingSecret:
    name: onexsecret-db-app   # generated by CNPG
    key: uri

config:
  appUrl: https://secrets.example.com
  defaultLanguage: en
  accessMode: SAFEGUARDED
  safeNetworks: 203.0.113.0/24,10.8.0.0/16
  # Ingress + pod/node networks; adjust to your cluster's CIDRs.
  trustedProxies: 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
  allowIndexing: false
  retentionDays: 30

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
  hosts:
    - host: secrets.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: onexsecret-tls
      hosts:
        - secrets.example.com

legal:
  # filename -> markdown; rendered into a ConfigMap mounted at /app/legal
  documents:
    legal-notice-en.md: |
      # Legal notice

      Example Corp
      1 Example Street, Example City

      Contact: legal@example.com
    tos-en.md: |
      # Terms of Service

      ...
```

```bash
kubectl apply -f cnpg-cluster.yaml
helm install onexsecret oci://ghcr.io/1xsecret/charts/1xsecret -f values-prod.yaml
```

### Without CNPG

For a database elsewhere, reference any existing Secret
(`database.existingSecret.name`/`key`), or — for development only — set `database.url`
directly and let the chart render its own Secret. Never put production credentials in
values files.

Other chart features (see the chart's `values.yaml` for the authoritative schema):
`autoscaling` (HPA), `podDisruptionBudget` (auto-enabled with >1 replica),
`legal.existingConfigMap` as an alternative to inline `legal.documents`, `extraEnv`
for e.g. `DATABASE_REPLICA_URLS` from a Secret, and `migrations.enabled` to disable
the hook Job if you run migrations yourself.

## Legal pages

Mount markdown files into `LEGAL_DIR` (default `/app/legal` in the container):

| File                                        | Route                    |
| ------------------------------------------- | ------------------------ |
| `legal-notice-en.md` / `legal-notice-de.md` | `/{locale}/legal-notice` |
| `tos-en.md` / `tos-de.md`                   | `/{locale}/terms`        |
| `privacy-en.md` / `privacy-de.md`           | `/{locale}/privacy`      |

- A page and its footer link exist **iff the file for the instance's default
  language** (`DEFAULT_LANGUAGE`) exists.
- A missing translation falls back to the default-language file, with a note about the
  displayed language.
- Files are read per request — updating them requires no restart.
- Rendered with a markdown renderer; raw HTML is not interpreted.

Compose: bind-mount a directory (`- ./legal:/app/legal:ro`). Helm: `legal.documents`
or `legal.existingConfigMap`. Example files: [`legal-examples/`](../legal-examples).

## White-label / branding

Rebrand the stock image entirely through configuration — no fork, so security fixes stay
a `docker pull` / `helm upgrade` away. Everything below is optional.

| What | How |
| ---- | --- |
| App name | `APP_NAME` (header, tab title, OpenGraph) |
| Logo | mount a file, set `BRAND_LOGO_PATH` to it |
| Landing page | `LANDING_MODE=minimal` — drops the marketing sections, neutral heading |
| Legal / privacy | mount `legal-notice-`, `tos-`, `privacy-{en,de}.md` (see above) |
| Any text | mount `<locale>.json` into `MESSAGES_OVERRIDE_DIR` (deep-merged over defaults) |
| Source link | `SHOW_SOURCE_LINK=false` hides the footer repo link |

The "based on the open-source project 1xSecret" attribution is always shown (AGPL). Point
`SOURCE_URL` at your own modified sources to satisfy the network-use clause (§13).

### Compose

```yaml
# .env
APP_NAME=Acme Secrets
LANDING_MODE=minimal
SHOW_SOURCE_LINK=false
BRAND_LOGO_PATH=/app/brand/logo.svg
MESSAGES_OVERRIDE_DIR=/app/message-overrides
```

```yaml
# compose override for the app service
volumes:
  - ./legal:/app/legal:ro
  - ./brand/logo.svg:/app/brand/logo.svg:ro
  - ./message-overrides:/app/message-overrides:ro   # de.json / en.json (partial)
```

### Helm

```yaml
branding:
  appName: Acme Secrets
  landingMode: minimal
  showSourceLink: false
  logo:
    existingConfigMap: acme-logo   # kubectl create configmap acme-logo --from-file=logo.svg
    key: logo.svg
  messageOverrides:
    de.json: |
      { "HomePage": { "minimalTitle": "Passwort teilen" } }
```

A partial override JSON only needs the keys you change, e.g.:

```json
{ "HomePage": { "minimalTitle": "Share a password" }, "Header": { "mySecrets": "My items" } }
```

## Scaling

The app is stateless — run any number of replicas behind one database. Everything that
must be exactly-once is enforced in PostgreSQL:

- The **burn** is a single atomic statement; concurrent retrievers across replicas are
  serialized by a row lock.
- **Failed-attempt counting** is a per-secret DB counter.
- **Migrations** serialize on Postgres advisory lock **745839201701** — any number of
  concurrent runners (Helm hook, compose one-shot, manual) apply each migration exactly
  once; followers see them as applied and exit 0.
- The **sweeper** (10-minute interval in every app process) takes advisory lock
  **745839201702** non-blockingly, so only one replica sweeps per round.

If other applications share the same PostgreSQL database, make sure they do not use
these two advisory lock ids.

One caveat: the per-IP request rate limiter is in-memory **per app instance**, so its
effective limit scales with the replica count. It is a flood brake, not the security
boundary (that is the per-secret DB counter); configure stricter global limits at the
reverse proxy if you need them.

## Read replicas

Set `DATABASE_REPLICA_URLS` (comma-separated) to spread read load. Only reads that
tolerate lag (e.g. the creator's status page) use replicas; everything correctness-
critical — seal, handshake, retrieve/burn, status of a specific reveal — always uses
the primary.

## Backups

Standard PostgreSQL tooling (`pg_dump`, WAL archiving, CNPG backups) applies. Points
worth knowing:

- A dump contains **only ciphertext and receipt metadata** — no keys, no plaintext, no
  passwords. A leaked backup alone decrypts nothing (see
  [SECURITY.md](./SECURITY.md#database-dump-alone)).
- Restoring an old dump resurrects secrets that were retrieved or expired *after*
  the dump was taken — their one-time guarantee is then already spent or voided.
  After restoring from backup, consider the affected window compromised and advise
  users to rotate secrets shared during it.

## Updating

**Compose:**

```bash
docker compose pull
docker compose up -d
```

The `migrate` one-shot service runs first (advisory-locked); the app starts after it
completes.

**Helm:**

```bash
helm upgrade onexsecret oci://ghcr.io/1xsecret/charts/1xsecret -f values-prod.yaml
```

The migration Job runs as a `pre-upgrade` hook before the new pods roll out. Migrations
are applied in order, tracked by content hash — editing an already-applied migration
fails the run by design.

## Monitoring

| Endpoint      | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `/api/health` | Liveness: the process is up. Never touches the database.             |
| `/api/ready`  | Readiness: the database answers `SELECT 1`. Returns 503 otherwise.   |

The container image ships a `HEALTHCHECK` against `/api/health`. On Kubernetes, use
`/api/health` for liveness and `/api/ready` for readiness probes so pods are taken out
of rotation when the database is unreachable.

The app logs a single startup line with the effective mode/language/replica settings
and fails fast with a readable list of problems when the configuration is invalid.
