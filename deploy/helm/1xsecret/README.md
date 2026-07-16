# 1xsecret Helm chart

Deploys [1xSecret](https://github.com/1xSecret/1xSecret) — a self-hostable
web service for sharing secrets via one-time links. Secrets are encrypted
end-to-end in the browser; the server only ever stores ciphertext.

## Prerequisites

- Kubernetes 1.25+ and Helm 3.8+ (OCI support) — Helm 4 works too
- A PostgreSQL 16+ database (see [Database](#database) below — the chart
  deliberately does **not** bundle one)

## Installing

The chart is published as an OCI artifact:

```bash
helm install my-1xsecret oci://ghcr.io/1xsecret/charts/1xsecret \
  --set database.existingSecret.name=db-app \
  --set database.existingSecret.key=uri \
  --set config.appUrl=https://secrets.example.com
```

To pin a chart version, add `--version 0.1.0`.

## Database

The recommended setup is the [CloudNativePG](https://cloudnative-pg.io)
operator. This chart does not bundle a PostgreSQL subchart on purpose: the
commonly used Bitnami PostgreSQL images were frozen and moved to
`bitnamilegacy` in 2025 and are no longer a viable base, and a production
database belongs to an operator with backups and failover anyway.

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: db
  namespace: databases
spec:
  instances: 3
  storage:
    size: 10Gi
```

CloudNativePG generates a Secret named `<cluster>-app` (here: `db-app`)
whose key `uri` contains the full connection string. It points at the
**read-write** service `<cluster>-rw` (the primary). Point the chart at it:

```yaml
database:
  existingSecret:
    name: db-app
    key: uri
```

### Using the read replicas

CloudNativePG also exposes a **read-only** service `<cluster>-ro` (all standbys)
that shares the same credentials as `<cluster>-app`. Send read-only queries
there via `DATABASE_REPLICA_URLS`, building the URL from the Secret's `password`
key so it never appears in a values file (Kubernetes expands `$(PG_PASSWORD)`
because it is defined earlier in the same env list):

```yaml
database:
  existingSecret:
    name: db-app       # <cluster>-app -> the -rw primary
    key: uri
  replicaUrls: ""      # leave empty; set the replicas via extraEnv below

extraEnv:
  - name: PG_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-app
        key: password
  - name: DATABASE_REPLICA_URLS
    # user "app" and db "app" are the CloudNativePG defaults; -ro is the
    # read-only service. Namespace-qualify the host if the DB is elsewhere.
    value: "postgresql://app:$(PG_PASSWORD)@db-ro:5432/app"
```

The app routes writes and read-your-write reads to the primary and other reads
to the replicas; replication lag is never on the reveal path.

Notes:

- If the database runs in a different namespace than the app, the Secret
  must be copied/replicated into the app's namespace, and the hosts (`-rw`,
  `-ro`) must be namespace-qualified in-cluster DNS, e.g.
  `db-rw.databases.svc.cluster.local` and `db-ro.databases.svc.cluster.local`.
- `database.url` exists as a **dev-only** convenience: it renders a chart
  managed Secret. Never put production credentials in values files.
- Database **migrations** run automatically as a Helm
  `pre-install,pre-upgrade` hook Job executing `node scripts/migrate.mjs`.
  The runner takes a Postgres advisory lock, so concurrent runs are safe.

## Upgrades

`helm upgrade` first runs the migration Job (pre-upgrade hook) and only
then rolls the Deployment. The **old** pods keep serving traffic while and
after the migrations run, so migrations must stay **backward-compatible**
with the previous app version (expand/contract pattern: add columns first,
remove them one release later).

If an upgrade fails during migration, the failed Job is kept for
debugging:

```bash
kubectl logs job/<release-fullname>-migrate
```

## Image version and chart releases

The image tag defaults to the chart's `appVersion` (`image.tag: ""`), so a
`helm install`/`upgrade` runs whatever app version the chart was published with.
The image and the chart are therefore released **together from one git tag**:
pushing `vX.Y.Z` runs `release.yml`, which builds the multi-arch image and
packages the chart with both `version` and `appVersion` set to `X.Y.Z`. A fresh
install then pulls the matching image with no extra flags. (The `appVersion` in
the committed `Chart.yaml` is only a placeholder; the release overrides it.)

You can always pin a specific image regardless of chart version:

```bash
helm upgrade my-1xsecret oci://ghcr.io/1xsecret/charts/1xsecret \
  --set image.tag=v0.2.3
```

## ServiceAccount

The chart creates a dedicated ServiceAccount for the pods
(`serviceAccount.create: true`). The app never calls the Kubernetes API, so its
token is **not** mounted (`serviceAccount.automount: false`): the point is a
distinct, least-privilege identity rather than sharing (and auto-mounting the
token of) the namespace `default` ServiceAccount. To reuse an existing account
instead, set `serviceAccount.create: false` and `serviceAccount.name: <name>`.

## Legal documents (legal notice / terms of service)

Markdown files mounted at `/app/legal` become legal pages with footer
links (`legal-notice-{en|de}.md`, `tos-{en|de}.md`; a page exists iff the
file for the default language exists). Provide them inline as block
scalars:

```yaml
legal:
  documents:
    legal-notice-de.md: |
      # Impressum

      Max Mustermann
      Musterstraße 1, 12345 Musterstadt
    legal-notice-en.md: |
      # Legal notice
      ...
```

Or load a file from disk at install time — note that the dots in the
filename key must be escaped so Helm does not treat them as nesting:

```bash
helm upgrade --install my-1xsecret oci://ghcr.io/1xsecret/charts/1xsecret \
  --set-file 'legal.documents.legal-notice-de\.md=./impressum.md'
```

Alternatively manage the ConfigMap yourself and set
`legal.existingConfigMap`. The volume is mounted with `optional: true`, so
deploying without any legal documents is valid.

## SAFEGUARDED mode

In `SAFEGUARDED` mode, secrets created from outside the safe networks can
only be retrieved from within them. `config.safeNetworks` is **required**
(enforced by the values schema):

```yaml
config:
  accessMode: SAFEGUARDED
  safeNetworks: "10.20.0.0/16,203.0.113.0/24"
  # In Kubernetes, requests reach the app through the ingress controller
  # and the pod/node network — list those CIDRs so the real client IP is
  # resolved from X-Forwarded-For:
  trustedProxies: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
```

Without a correct `trustedProxies` setting every request appears to come
from the ingress controller's pod IP, which breaks `SAFEGUARDED`
enforcement.

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `image.repository` | string | `ghcr.io/1xsecret/1xsecret` | Container image repository |
| `image.tag` | string | `""` | Image tag (defaults to the chart `appVersion`) |
| `image.pullPolicy` | string | `IfNotPresent` | Image pull policy |
| `imagePullSecrets` | list | `[]` | Pull secrets for private registries |
| `replicaCount` | int | `2` | Replicas (ignored when autoscaling is enabled) |
| `nameOverride` | string | `""` | Override the chart name |
| `fullnameOverride` | string | `""` | Override the fully qualified name |
| `database.existingSecret.name` | string | `""` | Existing Secret with the connection string (recommended) |
| `database.existingSecret.key` | string | `DATABASE_URL` | Key inside the existing Secret (`uri` for CloudNativePG) |
| `database.url` | string | `""` | Dev-only inline connection string (renders a chart Secret) |
| `database.replicaUrls` | string | `""` | Optional comma-separated read replica URLs (`DATABASE_REPLICA_URLS`) |
| `config.appUrl` | string | `""` | Canonical base URL (SEO/sitemap) |
| `config.defaultLanguage` | string | `en` | Default UI language (`en` or `de`) |
| `config.accessMode` | string | `DANGEROUS-PUBLIC` | `DANGEROUS-PUBLIC` or `SAFEGUARDED` |
| `config.safeNetworks` | string | `""` | CIDRs of safe networks (required for `SAFEGUARDED`) |
| `config.trustedProxies` | string | `""` | CIDRs of trusted proxies/LBs (usually cluster pod+node CIDRs) |
| `config.allowIndexing` | bool | `false` | Opt-in search engine indexing |
| `config.retentionDays` | int | `30` | Days to keep read-receipt rows |
| `legal.documents` | map | `{}` | Filename → markdown content, mounted at `/app/legal` |
| `legal.existingConfigMap` | string | `""` | Use an existing ConfigMap for legal documents |
| `migrations.enabled` | bool | `true` | Run migrations as a pre-install/pre-upgrade hook Job |
| `migrations.activeDeadlineSeconds` | int | `300` | Migration Job deadline |
| `migrations.backoffLimit` | int | `3` | Migration Job retries |
| `serviceAccount.create` | bool | `true` | Create a ServiceAccount |
| `serviceAccount.automount` | bool | `false` | Automount the API token (app never uses the K8s API) |
| `serviceAccount.annotations` | object | `{}` | ServiceAccount annotations |
| `serviceAccount.name` | string | `""` | ServiceAccount name override |
| `service.type` | string | `ClusterIP` | Service type |
| `service.port` | int | `3000` | Service port |
| `ingress.enabled` | bool | `false` | Expose via Ingress |
| `ingress.className` | string | `""` | IngressClass name |
| `ingress.annotations` | object | `{}` | Ingress annotations |
| `ingress.hosts` | list | see values | Host rules |
| `ingress.tls` | list | `[]` | TLS configuration |
| `resources` | object | `{requests: {cpu: 100m, memory: 256Mi}, limits: {memory: 512Mi}}` | Pod resources — no CPU limit on purpose (throttling only adds tail latency) |
| `autoscaling.enabled` | bool | `false` | Enable the HPA |
| `autoscaling.minReplicas` | int | `2` | HPA minimum |
| `autoscaling.maxReplicas` | int | `5` | HPA maximum |
| `autoscaling.targetCPUUtilizationPercentage` | int | `80` | HPA CPU target |
| `podDisruptionBudget.enabled` | bool/string | `auto` | `true`/`false`/`auto` (auto: PDB when >1 replica) |
| `podDisruptionBudget.minAvailable` | int/string | `1` | PDB minAvailable |
| `podSecurityContext` | object | non-root, uid/gid 1000, `RuntimeDefault` seccomp | Pod security context |
| `containerSecurityContext` | object | no privilege escalation, drop ALL capabilities | Container security context (`readOnlyRootFilesystem: false` — Next.js writes a runtime cache) |
| `extraEnv` | list | `[]` | Extra env entries for the app container |
| `podAnnotations` | object | `{}` | Extra pod annotations |
| `podLabels` | object | `{}` | Extra pod labels |
| `nodeSelector` | object | `{}` | Node selector |
| `tolerations` | list | `[]` | Tolerations |
| `affinity` | object | `{}` | Affinity rules |

## Probes

- **Liveness** `GET /api/health` — never touches the database, so a DB
  outage cannot restart-storm the replicas.
- **Readiness** `GET /api/ready` — runs `SELECT 1`; pods drop from the
  Service while the database is unreachable and rejoin automatically.
