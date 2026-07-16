# Contributing to 1xSecret

Thanks for contributing! This document covers the development setup and the ground
rules for pull requests.

## Prerequisites

- **Node.js >= 20.9**
- **pnpm 11** via corepack — `package.json` pins the exact version
  (`packageManager: pnpm@11.13.1`):

  ```bash
  npm install -g corepack@latest && corepack enable pnpm
  ```

- **Docker** (for a local PostgreSQL)

## Setup

```bash
git clone https://github.com/1xSecret/1xSecret.git
cd 1xsecret
pnpm install

# local PostgreSQL on a non-default port
docker run -d --name onexsecret-dev-db \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=onexsecret \
  -p 55432:5432 postgres:18-alpine
```

Create `.env.local` (read by `next dev`, never committed):

```bash
DATABASE_URL=postgres://postgres:dev@localhost:55432/onexsecret
LEGAL_DIR=./legal-examples
```

Apply migrations and start the dev server (`scripts/migrate.mjs` reads only the
process environment, so pass `DATABASE_URL` explicitly):

```bash
DATABASE_URL=postgres://postgres:dev@localhost:55432/onexsecret pnpm db:migrate
pnpm dev
```

## Commands

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `pnpm dev`         | Next.js dev server (reads `.env.local`)                   |
| `pnpm build`       | Production build (`next build`, needs no configuration)   |
| `pnpm test`        | Vitest, single run                                        |
| `pnpm test:watch`  | Vitest in watch mode                                      |
| `pnpm typecheck`   | `tsc --noEmit`                                            |
| `pnpm lint`        | ESLint                                                    |
| `pnpm db:generate` | Generate a SQL migration from schema changes (drizzle-kit) |
| `pnpm db:migrate`  | Apply migrations (`scripts/migrate.mjs`, advisory-locked) |

CI runs `lint`, `typecheck`, `test`, and `build` on every PR — please run them locally
first.

## Project layout

```
src/app/[locale]/          pages (landing+create, s/[id], secrets, legal/[slug])
src/app/api/               JSON route handlers
src/lib/crypto/            isomorphic crypto core (browser + tests)
src/lib/server/            config, db, client-ip, cidr, secrets lifecycle, rate limit
src/components/            UI components (shadcn/ui in components/ui)
messages/                  en.json, de.json (next-intl)
drizzle/                   generated SQL migrations
scripts/migrate.mjs        advisory-lock migration runner
deploy/helm/1xsecret/     Helm chart
docs/                      ARCHITECTURE.md, SECURITY.md, SELF-HOSTING.md
```

[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) is the canonical specification — keep
it in sync with behavior changes.

## Pull request guidelines

- **English only** — code, comments, commit messages, and documentation. (The UI is
  translated; the codebase is not.)
- **Tests are required for crypto and server changes.** Anything in `src/lib/crypto/`
  or `src/lib/server/` that affects behavior needs unit tests next to it.
- **Never break the `v1` crypto scheme.** Existing links must keep decrypting forever.
  Any change to key derivation, cipher parameters, signature contexts, or the fragment
  format requires a **new version tag** (`v2`, …) alongside `v1`, not a modification
  of `v1` (see `src/lib/crypto/constants.ts`).
- **Never edit an applied migration.** Add a new migration instead — the runner tracks
  content hashes and refuses modified files.
- Keep PRs focused; separate refactors from behavior changes.

## Internationalization (i18n)

- `messages/en.json` is the **source of truth**; `messages/de.json` must stay in sync
  — same keys, same ICU placeholders/plurals. PRs that add or change UI text must
  update both files.
- Namespaces are PascalCase; use ICU plurals rather than manual singular/plural
  branching.
- Message keys are type-checked; `pnpm typecheck` catches missing keys.

## Security issues

Do not open public issues for vulnerabilities — see [SECURITY.md](./SECURITY.md).
