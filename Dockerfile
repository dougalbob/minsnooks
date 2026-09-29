# syntax=docker/dockerfile:1
#
# Minsnooks V2 — single Node application image (HANDOFF §9 / PLAN §"Deploy target").
# Multi-stage build: compile the SvelteKit (adapter-node) production bundle, then
# copy only the runtime artifacts into a slim image. better-sqlite3 ships
# prebuilt native bindings for linux-x64/arm64 *and* musl (Alpine) inside the
# npm package itself (see SANDBOX.md §0) — no compiler toolchain is required in
# either stage, on either architecture.

FROM node:22-alpine AS build
WORKDIR /app

# Install with the lockfile only first so this layer caches across source edits.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx svelte-kit sync
RUN npm run build

# Drop devDependencies (vite, svelte-kit, playwright, vitest, typescript, ...)
# now that the production bundle in build/ exists; only runtime deps remain.
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/minsnooks.db

# Run as an unprivileged user; the SQLite file lives on the mounted /data volume.
RUN addgroup -S minsnooks \
    && adduser -S minsnooks -G minsnooks \
    && mkdir -p /data \
    && chown -R minsnooks:minsnooks /data

COPY --from=build --chown=minsnooks:minsnooks /app/package.json ./package.json
COPY --from=build --chown=minsnooks:minsnooks /app/node_modules ./node_modules
COPY --from=build --chown=minsnooks:minsnooks /app/build ./build
COPY --from=build --chown=minsnooks:minsnooks /app/migrations ./migrations

USER minsnooks
VOLUME ["/data"]
EXPOSE 3000

# adapter-node's handler answers any path; a plain GET / is enough to prove the
# Node process is alive and the SQLite file opened (getDb() runs migrations on
# first access, so a broken DB/migration surfaces as a non-2xx here too).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000)).then((r) => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "build/index.js"]
