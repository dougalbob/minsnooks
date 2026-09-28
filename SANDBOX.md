# SANDBOX.md — Arena sandbox & preview survival guide

**Purpose:** sandbox/preview pitfalls in this repo and their known fixes, so future session agents don't burn compute rediscovering them. Update whenever a new issue is found **and fixed**. Mark provenance: entries marked *(verified here)* were reproduced in this repo/sandbox; entries marked *(adapted)* come from a sibling Arena project's notes (`simple-finance`, 2026-09-24…27) and are consistent with this sandbox's behaviour but were not all re-verified here.

Working directory for everything below: `/home/user/minsnooks`.

## 0. Session bootstrap (copy-paste)

```sh
npm ci --ignore-scripts       # fast: loads better-sqlite3's bundled prebuild, no compile
npx svelte-kit sync           # REQUIRED after --ignore-scripts (prepare is skipped)
cp .env.example .env          # if .env missing (gitignored; recreated easily)
npm run seed                  # if data/minsnooks.db missing (idempotent)
npm test
npm run dev -- --host 0.0.0.0 --port 4173   # preview — use the NEW link the platform shows
```

If `npm ci --ignore-scripts` misbehaves, the fallback is `npm install` (compiles better-sqlite3 against local headers via `nodedir=/usr/local` in `.npmrc` — see §3).

**Do this at the start of every turn, not just every session.** The sandbox is recycled at user-turn boundaries (§1) — expect `node_modules`, `.env`, `data/`, and running processes to be gone.

## 1. The sandbox recycles at turn boundaries *(verified here — 2026-09-28, twice)*

- **Observed:** between user turns, `node_modules` vanished, the dev server died, `.env`/`data/` disappeared, **and local git history rewound to the remote base commit** while the working-tree files came back as untracked/modified changes. Workspace source files survive; git refs and installed dependencies do not.
- **Symptoms:** preview says "expired" / "Sandbox Not Found"; `vite: not found`; `git log` shows the session's commits missing though `git status` shows the same content as uncommitted.
- **Fix — restore git from the remote (a push is the only durable save):**

  ```sh
  git fetch origin arena/01a0e984-minsnooks
  git update-ref refs/remotes/origin/arena/01a0e984-minsnooks FETCH_HEAD   # tracking ref may be missing
  git status && git diff FETCH_HEAD --stat    # inspect for any real uncommitted work first!
  git reset --hard FETCH_HEAD                 # only after confirming nothing valuable is unpushed
  ```

- **Rules:** `git commit` alone is **not** durable — `git push origin arena/01a0e984-minsnooks` after every commit and verify with `git ls-remote origin arena/01a0e984-minsnooks`. If a push fails, say so at once and note what is unpushed in `PLAN.md` §7 at the next successful push. Never `reset --hard` without first inspecting `git diff FETCH_HEAD` — unpushed edits would be destroyed.
- **Also gone with the sandbox:** `node_modules`, `/tmp` scratch, running processes. Never read "every test file suddenly cannot find package X" as your code breaking — reinstall first.

## 2. Preview server *(verified here)*

### Preview says "expired" / "Sandbox Not Found"
- **Cause:** previews are proxied as `https://{port}-{sandboxId}.e2b.app` and **the sandbox id changes at turn boundaries** (seen: `itb2dfpaua52zr88yh7vo` → `iifwiw036m81zajeyh6c2` → `i8xj3jutf0c3xhzxjgoc1`). Any older link is permanently dead. Same symptom if the dev server simply isn't running.
- **Fix:** start the dev server in the *current* turn and use the **new** preview link. Never reuse old links. Current id: `echo $E2B_SANDBOX_ID`.

### Vite 403 "Blocked request. This host (…) is not allowed"
- **Cause:** Vite's dev-server host allowlist rejects `{port}-{sandboxId}.e2b.app`.
- **Fix (in repo):** `server.allowedHosts: ['.e2b.app', 'localhost']` in `vite.config.ts` — covers every sandbox id. Dev must bind `--host 0.0.0.0`.

### Stale output from a long-running dev server
- If an edit doesn't appear in `curl`/the preview, restart the dev server (and `rm -rf .svelte-kit` if still weird) before concluding the code is wrong. *(Adapted: originally observed with Next.js/Turbopack SSR staleness; the habit transfers.)*

### Previewing unusual league states (tip)
- Vite (unlike Next) allows two dev servers in one directory: `cp data/minsnooks.db /tmp/demo.db && DATABASE_PATH=/tmp/demo.db npm run dev -- --host 0.0.0.0 --port 4174` — useful later for demoing withdrawal/award/expiry states without touching the main seed. Keep `DATABASE_PATH` **absolute**.

## 3. npm install / native builds

### `sh: 1: vite: not found` / `tsx: not found` on any npm script
- **Cause *(verified)*:** `node_modules` never persists across turns (§1).
- **Fix:** bootstrap (§0). Don't diagnose deeper.

### `npm error Cannot read properties of null (reading 'edgesOut')`
- **Cause *(verified)*:** npm 10.9 arborist bug in `#loadPeerSet` resolving peer sets on this graph (Vite 8 / Vitest 5).
- **Fix (in repo):** `legacy-peer-deps=true` in `.npmrc`. Don't remove it.

### better-sqlite3: node-gyp fails fetching headers from nodejs.org (curl exit 35 / ECONNRESET)
- **Reality *(verified)*:** better-sqlite3@13.0.3 **ships a prebuild inside its npm tarball** (`prebuilds/linux-x64.node` for Node 22) and needs no compile here. The failure is only its install script (`prebuild-install` → GitHub release assets, blocked → falls back to `node-gyp` → nodejs.org headers, blocked).
- **Route A (preferred, fast):** `npm ci --ignore-scripts` + `npx svelte-kit sync`. Verified: driver loads, 16/16 tests green. Caveat: `prepare` is skipped, so anything assuming `.svelte-kit/` must run `npx svelte-kit sync` first (symptom otherwise: `TSCONFIG_ERROR Failed to load tsconfig '.svelte-kit/tsconfig.json'`).
- **Route B (full install with scripts):** `nodedir=/usr/local` in `.npmrc` *(verified)* — headers exist at `/usr/local/include/node` in this sandbox and in official Node images; node-gyp compiles offline. What npm honours is the `nodedir` config / `npm_config_nodedir` env — staging `~/.cache/node-gyp/.../config.gypi` alone is ignored *(adapted)*.
- **Do not:** retry nodejs.org or `npm rebuild better-sqlite3`. If a header tree is ever needed elsewhere, `codeload.github.com` is reachable: `https://codeload.github.com/nodejs/node/tar.gz/v22.22.3` (prefix `node-22.22.3`, no `v`; `include/node` must be assembled — the tarball has `src/` but no ready tree) *(adapted)*.

### `npm error notarget No matching version found for @sveltejs/adapter-node@^6.0.0` (or similar)
- **Cause *(verified)*:** hand-edited `package.json` range that doesn't exist (adapter-node is **5.x**). Ranges must agree with the committed `package-lock.json`.
- **Fix:** `npm view <pkg> version`; regenerate with `rm package-lock.json && npm install`, then commit the lockfile.

## 4. Network reachability map *(verified here + adapted)*

| Host | Status | Notes |
| --- | --- | --- |
| `registry.npmjs.org` | ✔ | Installs work. |
| `api.github.com`, `codeload.github.com` | ✔ | `gh api`, check-runs, tarballs. |
| `nodejs.org` | ✘ | node-gyp header downloads fail (§3). |
| `objects.githubusercontent.com` | ✘ | GitHub release-asset redirects die — why `prebuild-install` fails. |
| `cdn.playwright.dev`, `deb.debian.org` | ✘ | No Playwright browser download, no apt packages (§6). |
| `ghcr.io` | ✘ | No registry inspection; no Docker daemon either (§5). |
| Actions log blob hosts (`productionresults*.blob.core.windows.net`, `results-receiver.actions.githubusercontent.com`) | ✘ | CI logs unreadable (§5). |

## 5. GitHub from the sandbox *(adapted — same platform, same quirks expected)*

### CI logs are unreachable — read conclusions and annotations instead
- `gh run view <id> --log` / `gh api .../actions/jobs/<id>/logs` die on blocked blob hosts. This is **not** transient.
- What works:

  ```sh
  gh run view <id> --json jobs -q '.jobs[] | {name, id, conclusion}'
  gh api repos/dougalbob/minsnooks/check-runs/<job-id>/annotations \
    --jq '.[] | {level:.annotation_level, path:.path, line:.start_line, msg:.message}'
  gh run watch <id> --exit-status    # gates on completion; non-zero on failure
  ```

- Check-run annotations (served by api.github.com) carry the actual failure text (e.g. Playwright's github reporter: locator, expected vs received, source line). Empty log ≠ step skipped — check `conclusion`.
- `gh pr view <n>` can fail with a GraphQL `Projects (classic)` deprecation error — use REST: `gh api repos/dougalbob/minsnooks/pulls/<n> --jq '{title, state, head:.head.ref, head_sha:.head.sha, mergeable}'`.

### Verifying container images without ghcr.io
- Use the packages API (dougalbob is a **user** account — `/orgs/...` returns 404):

  ```sh
  gh api "/users/dougalbob/packages/container/<image>/versions?per_page=20" \
    -q '.[] | "tags=\(.metadata.container.tags|join(","))  digest=\(.name)"'
  ```

  The digest is the `name` field (the `digest` field is always null). *(Adapted; only needed if/when we publish images.)*

### The Arena GitHub connector can drop mid-session
- **Symptom:** every GitHub call dies at once — `git push` prompts for credentials (disabled → fails), `gh api` → `401 Bad credentials`. `GH_TOKEN` is an Arena-issued handle (in some sandboxes literally a dummy string), **not** a real PAT — there is no local credential to refresh; don't look for `~/.git-credentials` and don't ask the user for a PAT.
- **Fix:** the reconnect window — batch all remote work (push, PR, gh reads) into short windows; ask the user to toggle the GitHub connector off/on in Arena's "Add files and connections"; once they confirm, probe liveness with a **repo-scoped** read (`gh api repos/dougalbob/minsnooks --jq .full_name`) and run remote calls immediately. `GET /user` returning 403 is normal for the bot token; the dead-handle signature is **401**.
- **Do:** keep all local work (edits, tests, previews) outside windows. **Don't:** blindly retry a 401 — report exactly what completed, request a toggle, resume mid-checklist. Never force-push or re-tag a pushed tag. If a toggle doesn't revive `gh`, the sandbox may be stuck — start a fresh session.

## 6. Browsers / Playwright *(adapted — proven in the sibling project; we will need this in Phase 15)*

- `cdn.playwright.dev` and apt (`deb.debian.org`) are blocked, so `npx playwright install` and `--with-deps` cannot work. **But a browser CAN run here:** `@sparticuz/chromium` ships Chromium + the needed shared libs inside its npm tarball (registry is reachable).

  ```sh
  mkdir -p /tmp/pwbrowsers && cd /tmp/pwbrowsers && npm init -y && npm i @sparticuz/chromium
  node -e "import('@sparticuz/chromium').then(async (m) => console.log(await m.default.executablePath()))"   # → /tmp/chromium
  # libs auto-extract only on Amazon Linux — inflate manually:
  node -e "import('/tmp/pwbrowsers/node_modules/@sparticuz/chromium/build/lambdafs.js').then(m => m.inflate('/tmp/pwbrowsers/node_modules/@sparticuz/chromium/bin/al2023.tar.br'))"
  LD_LIBRARY_PATH=/tmp/al2023/lib /tmp/chromium --version
  ```

- Then point Playwright at the binary with a **throwaway overlay config** (never committed; the repo's own config stays intact):

  ```ts
  // playwright.local.config.ts
  import { defineConfig } from '@playwright/test';
  import base from './playwright.config';
  const launchOptions = {
  	executablePath: '/tmp/chromium',
  	args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  };
  export default defineConfig({
  	...base,
  	projects: (base.projects ?? []).map((p) => ({ ...p, use: { ...p.use, launchOptions } })),
  	use: { ...base.use, launchOptions }
  });
  ```

  `LD_LIBRARY_PATH=/tmp/al2023/lib npx playwright test --config playwright.local.config.ts`
- Notes: pass your own args (the package's defaults include `--single-process`, which Playwright dislikes); a version gap between the package's Chromium and Playwright's expected build has proven harmless; local red-to-green loops beat CI (≈2 min vs ≈16 min, and CI logs are unreadable here).
- **Do not:** accept "browser tests can't run here" — entries 2/3 of the sibling notes were corrected by this recipe. Do not try apt or the Playwright CDN again.

## 7. Editing discipline *(adapted — applies to any large file in this repo)*

- The fuzzy edit tool can silently mangle a large file far from the edited hunk (observed in a 1900-line component: an operator changed ~40 lines away, a stray insert appeared in unrelated JSX, one edit didn't apply at all — while unit tests stayed green).
- **Habits:** after edits to large files, run `git diff` (and `npm run check` / `npm test`) per edit batch, not once at the end. For surgical changes in big files, prefer `python3` with an explicit uniqueness check:

  ```sh
  python3 - <<'EOF'
  p, old, new = "src/…", "exact old text", "exact new text"
  s = open(p).read(); assert s.count(old) == 1, "anchor not unique"
  open(p, "w").write(s.replace(old, new))
  EOF
  ```

- "Edit succeeded" is not verification. Neither is a green unit suite for a UI change — unit tests here are server-side; components are covered by `npm run check` and (Phase 15) Playwright.

## 8. Environment facts *(verified here)*

- Node v22.22.3, npm 10.9.8, Python 3.11, gcc 12 — present. Harmless: first Vite start logs `Forced re-optimization of dependencies`.
- `db.ts` resolves `DATABASE_PATH` to an absolute path; still, run npm scripts from the repo root so relative defaults and `migrations/` resolution behave.
- Static prototype (rarely needed): `cd prototype && python3 -m http.server 4173`.

## 9. Not applicable here (from the sibling notes — don't re-litigate)

- **Next.js/Turbopack traps:** second `next dev` in one directory guard; symlinked `node_modules` panic. We use SvelteKit/Vite, which has neither rule.
- **Their prettier `format:check` untracked-file trap:** we don't run prettier.
- Their app-specific `getDbHandle()`/`DATA_DIR` bug — our equivalent risk (relative DB path) is already hardened in `src/lib/server/db.ts`.

## 10. Checklist before the PR

- [ ] SANDBOX.md current
- [ ] `npm test` green from the §0 bootstrap (clean `npm ci --ignore-scripts`)
- [ ] Preview works at a freshly generated URL (not a stale one)
- [ ] All work committed **and pushed**; `git ls-remote origin arena/01a0e984-minsnooks` shows the tip
- [ ] No secrets, `.env`, or `data/*.db` in the diff
