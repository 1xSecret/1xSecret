# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 1xSecret production image (multi-stage).
#
# One image serves every configuration: all env vars are read at runtime
# (see docs/ARCHITECTURE.md), so no configuration is needed at build time.
# ---------------------------------------------------------------------------

# ----- deps: install node_modules with a cached pnpm store ----------------
FROM node:24-alpine AS deps
# corepack is removed from Node 25+; installing it explicitly via npm is
# version-proof. package.json pins "packageManager": "pnpm@11.13.1".
RUN npm install -g corepack@latest && corepack enable pnpm
WORKDIR /app
# The SDK (@1xsecret/sdk) is a workspace member; its package.json is needed for
# pnpm to resolve the workspace. It never ends up in the runner image (only the
# Next.js standalone output is copied there).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY sdk/package.json ./sdk/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ----- build: compile the Next.js standalone output ------------------------
FROM node:24-alpine AS build
RUN npm install -g corepack@latest && corepack enable pnpm
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# pnpm >=10 verifies dependency freshness before running a script and, on a
# mismatch, re-installs. In a clean build the node_modules copied from `deps`
# has no accompanying pnpm store in this stage, so the check decides to purge
# node_modules and — lacking a TTY to confirm — aborts the build with
# ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. Dependencies are already installed
# with --frozen-lockfile above, so disable the pre-run check and build directly.
RUN echo 'verify-deps-before-run=false' > .npmrc
# No DATABASE_URL needed here: every page renders dynamically at request
# time and config validation only runs at server start (instrumentation.ts).
RUN pnpm build

# ----- runner: minimal runtime image ---------------------------------------
FROM node:24-alpine AS runner

LABEL org.opencontainers.image.source="https://github.com/1xSecret/1xSecret" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.description="1xSecret - end-to-end encrypted one-time secret sharing"

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Next.js standalone server (includes a pruned node_modules with `pg`).
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Migration runner (one-shot compose service / Helm hook Job). It only
# depends on `pg`, which ships in the standalone node_modules above.
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=node:node /app/drizzle ./drizzle

# Mount point for operator-provided legal markdown (LEGAL_DIR).
RUN mkdir -p /app/legal && chown node:node /app/legal

USER node
EXPOSE 3000

# Liveness probe via node's global fetch — no curl/wget in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
