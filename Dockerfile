# syntax=docker/dockerfile:1
#
# Minsnooks V2 — single Node application image (HANDOFF §9 / PLAN §"Deploy target").
# Multi-stage build: compile the SvelteKit (adapter-node) production bundle, then
# copy only the runtime artifacts into a slim image. better-sqlite3 ships
# prebuilt native bindings for linux-x64/arm64 (glibc) inside the npm package
# itself (see SANDBOX.md §0) — no compiler toolchain is required in either
# stage, on either architecture, AS LONG AS `npm ci` is run with
# --ignore-scripts (see the comment below; this was the actual cause of two
# earlier failed publish attempts, not the base distro). bookworm-slim (glibc)
# is used mainly to match the GitHub Actions runner and sidestep any future
# musl-specific native-module edge cases; docs/deployment.md records the full
# diagnosis.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./

# Install with the lockfile only first so this layer caches across source edits.
# --ignore-scripts, exactly like ci.yml (SANDBOX.md §0): better-sqlite3 has a
# binding.gyp with no declared install script, so npm's legacy default is to
# run `node-gyp rebuild` (compiling from source) unless scripts are skipped —
# that needs a full compiler toolchain this image doesn't have and isn't
# needed anyway, since better-sqlite3 resolves one of its bundled prebuilt
# `.node` binaries (linux-x64/linux-arm64/musl variants) at require() time.
RUN npm ci --ignore-scripts

COPY . .
RUN npx svelte-kit sync
RUN npm run build

# Drop devDependencies (vite, svelte-kit, playwright, vitest, typescript, ...)
# now that the production bundle in build/ exists; only runtime deps remain.
RUN npm prune --omit=dev


FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/minsnooks.db

# Run as the unprivileged "node" user the official image already ships with;
# the SQLite file lives on the mounted /data volume.
RUN mkdir -p /data && chown -R node:node /data

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/migrations ./migrations

USER node
VOLUME ["/data"]
EXPOSE 3000

# adapter-node's handler answers any path; a plain GET / is enough to prove the
# Node process is alive and the SQLite file opened (getDb() runs migrations on
# first access, so a broken DB/migration surfaces as a non-2xx here too).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000)).then((r) => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "build/index.js"]
