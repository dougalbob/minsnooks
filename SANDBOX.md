# SANDBOX.md — Arena sandbox & preview survival guide

**Purpose:** record sandbox/preview pitfalls in this repo and their known fixes, so future session agents (and humans) don't burn compute rediscovering them. Update this file whenever a new sandbox issue is found **and fixed** — before raising a PR, skim it.

Working directory for everything below: `/home/user/minsnooks`.

## 0. Session bootstrap (copy-paste)

```sh
npm install                      # node_modules never persists across sessions
cp .env.example .env             # if .env missing (gitignored; recreated easily)
npm run seed                     # if data/minsnooks.db missing (idempotent)
npm test
npm run dev -- --host 0.0.0.0 --port 4173   # preview — use the NEW link the platform shows
```

## 1. Preview server

### Preview says "expired" / "Sandbox Not Found"
- **Cause:** Arena previews are proxied as `https://{port}-{sandboxId}.e2b.app`, and **the sandbox id changes between sessions** (e.g. `itb2dfpaua52zr88yh7vo` → `iifwiw036m81zajeyh6c2`). Any link from an earlier sandbox is permanently dead — this is the "expired" page. The same symptom appears if the dev server simply isn't running.
- **Fix:** restart the dev server in the *current* session and use the **new** preview link the platform registers for it. Never reuse or bookmark preview URLs across sessions. Check the current id with `echo $E2B_SANDBOX_ID`; the live host is `{port}-$E2B_SANDBOX_ID.e2b.app`.
- **Note:** background processes do not survive turns — expect to restart `npm run dev` at every session start (this is already step 1 of PLAN.md's session protocol).

### Vite 403 "Blocked request. This host (…) is not allowed"
- **Cause:** Vite's dev-server host allowlist rejects the `{port}-{sandboxId}.e2b.app` proxy host.
- **Fix (already in repo):** `server.allowedHosts: ['.e2b.app', 'localhost']` in `vite.config.ts`. Keep this block; it covers every sandbox id. The dev command must bind `--host 0.0.0.0` (never 127.0.0.1).

## 2. npm install / native builds

### `sh: 1: vite: not found` (or `tsx: not found`) on any npm script
- **Cause:** `node_modules` is excluded from workspace snapshots and does not persist between sessions (same for the `.npm` cache, `.svelte-kit/`, `build/`, `dist/`).
- **Fix:** run `npm install` first (fast — lockfile committed). Don't diagnose missing binaries deeper than this.

### `npm error Cannot read properties of null (reading 'edgesOut')`
- **Cause:** npm 10.9 arborist bug in `#loadPeerSet` while resolving peer sets on this dependency graph (Vite 8 / Vitest 5).
- **Fix (already in repo):** `legacy-peer-deps=true` in `.npmrc`. Do not remove it; if install fails with this error again, someone removed it.

### better-sqlite3 build fails: node-gyp `ECONNRESET` fetching `node-v22.x-headers.tar.gz`
- **Cause:** sandbox egress blocks `nodejs.org`; node-gyp tries to download Node headers when no local ones are registered. (Prebuilt-binary downloads from GitHub release assets can also fail here.)
- **Fix (already in repo):** `nodedir=/usr/local` in `.npmrc` — headers ship at `/usr/local/include/node` in this sandbox and in official Node images, so `npm install` compiles fine offline. Verified with a clean `rm -rf node_modules && npm install`. Remove the line only if Node lives elsewhere (e.g. nvm-managed).

### `npm error notarget No matching version found for @sveltejs/adapter-node@^6.0.0` (or similar)
- **Cause:** a hand-edited `package.json` range that doesn't exist on the registry (adapter-node is **5.x**, not 6.x). Ranges must agree with the committed `package-lock.json`.
- **Fix:** check real versions with `npm view <pkg> version`; to regenerate the lockfile: `rm package-lock.json && npm install`, then commit it. `npm ci` is a good consistency check.

## 3. What does and does not persist

| Persists across sessions | Does NOT persist |
| --- | --- |
| Git-tracked files (source, `package-lock.json`, `.npmrc`, `migrations/`, docs) | `node_modules/` |
| Untracked workspace files in general (don't rely on it for secrets) | `.svelte-kit/`, `build/`, `dist/`, `.npm/` cache |
| — | `.env`, `data/*.db` were also missing after a sandbox recreation — treat both as recreatable (`cp .env.example .env`, `npm run seed`; seed is idempotent) |
| — | Running processes (dev servers). Restart every session. |
| — | **Local git history can be reset to the remote base (observed: a session commit vanished on sandbox recreation while the working tree survived). `git commit` alone is NOT durable — push to `origin arena/01a0e984-minsnooks` after committing.** |

## 4. Environment facts (observed)

- Node v22.22.3, npm 10.9.8, Python 3.11, gcc 12 — all present.
- Egress: npm registry reachable; `nodejs.org` header downloads **not** reachable (see above). `GH_TOKEN`/`GITHUB_TOKEN` in the env are Arena dummies — never useful for real GitHub API work beyond the proxied `gh`/`git` flows.
- Harmless noise: first Vite start logs `Forced re-optimization of dependencies`.
- Static prototype preview (rarely needed): `cd prototype && python3 -m http.server 4173`.

## 5. Checklist for the PR (later)

- [ ] This file present and current
- [ ] `npm test` green from a clean `npm install` (the bootstrap in §0)
- [ ] Preview works at a freshly generated URL (not a stale one)
- [ ] All work committed **and pushed** (local commits are not durable — see §3)
- [ ] No secrets, `.env`, or `data/*.db` in the diff
