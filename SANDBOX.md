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
- **Refinement (verified 2026-09-29):** untracked new files may NOT survive a recycle (15 new files lost; tracked edits kept). Commit and push new files promptly — until pushed they can vanish entirely.
- **Symptoms:** preview says "expired" / "Sandbox Not Found"; `vite: not found`; `git log` shows the session's commits missing though `git status` shows the same content as uncommitted.
- **Fix — restore git from the remote (a push is the only durable save):**

  ```sh
  BRANCH=arena/<session-id>-minsnooks            # e.g. arena/01a0ea0c-minsnooks (check `git branch`)
  git fetch origin "$BRANCH"
  git update-ref "refs/remotes/origin/$BRANCH" FETCH_HEAD   # tracking ref may be missing
  git status && git diff FETCH_HEAD --stat    # inspect for any real uncommitted work first!
  git reset --hard FETCH_HEAD                 # only after confirming nothing valuable is unpushed
  ```

- **Rules:** `git commit` alone is **not** durable — push the session branch (`git push origin arena/<session-id>-minsnooks`) after every commit and verify with `git ls-remote origin arena/<session-id>-minsnooks`. If a push fails, say so at once and note what is unpushed in `PLAN.md` §7 at the next successful push. Never `reset --hard` without first inspecting `git diff FETCH_HEAD` — unpushed edits would be destroyed.
- **Also gone with the sandbox:** `node_modules`, `/tmp` scratch, running processes. Never read "every test file suddenly cannot find package X" as your code breaking — reinstall first.

### Phase 14 preview: optional local VAPID keys (verified 2026-09-29)

The in-app inbox needs no push keys. To exercise the opt-in controls in the current browser preview, generate a **throwaway** VAPID pair into gitignored `.env` (never print/share the private key):

```sh
node --input-type=module - <<'JS' >> .env
import webpush from 'web-push';
const {publicKey,privateKey}=webpush.generateVAPIDKeys();
console.log(`\nVAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=mailto:dev@example.test`);
JS
```

Restart the dev server after changing `.env`. Browser push requires a secure origin (the Arena HTTPS preview qualifies); push delivery depends on external browser push services and was not end-to-end tested in this sandbox. `/calendar?month=2026-10` shows the fictional agreed fixture after a **fresh seed**; if the database already existed before Phase 14, seed does not rewrite its prior inbox or force-agree old dates. No credentials or real player data belong in a preview.

## 2. Preview server *(verified here)*

### Preview says "expired" / "Sandbox Not Found"
- **Cause:** previews are proxied as `https://{port}-{sandboxId}.e2b.app` and **the sandbox id changes at turn boundaries** (seen: `itb2dfpaua52zr88yh7vo` → `iifwiw036m81zajeyh6c2` → `i8xj3jutf0c3xhzxjgoc1`). Any older link is permanently dead. Same symptom if the dev server simply isn't running.
- **Fix:** start the dev server in the *current* turn and use the **new** preview link. Never reuse old links. Current id: `echo $E2B_SANDBOX_ID`.

### Vite 403 "Blocked request. This host (…) is not allowed"
- **Cause:** Vite's dev-server host allowlist rejects `{port}-{sandboxId}.e2b.app`.
- **Fix (in repo):** `server.allowedHosts: ['.e2b.app', 'localhost']` in `vite.config.ts` — covers every sandbox id. Dev must bind `--host 0.0.0.0`.

### Stale output from a long-running dev server
- If an edit doesn't appear in `curl`/the preview, restart the dev server (and `rm -rf .svelte-kit` if still weird) before concluding the code is wrong. *(Adapted: originally observed with Next.js/Turbopack SSR staleness; the habit transfers.)*

### Re-seeding under a running dev server leaves it on a deleted inode *(verified here — 2026-09-29, Phase 13)*
- **Cause:** `rm -f data/minsnooks.db* && npm run seed` replaces the database file, but the dev server still holds the old file descriptor. Pages then fail with `SqliteError: no such table: …` for tables the freshly seeded file has (or silently serve the pre-seed state).
- **Fix:** stop and restart the dev server after any `rm`+`seed`. A plain `npm run seed` without deleting the file is safe (SQLite writes through the same inode).

### `.env` values do NOT reach `process.env` in the dev server *(verified here — 2026-09-29)*
- **Cause:** `src/lib/server/db.ts` resolves the database path from raw `process.env`; Vite loads `.env` into `import.meta.env` only. A `DATABASE_PATH` line in `.env` is silently ignored by the dev server — the page renders against the empty `data/minsnooks.db` fallback ("No season seeded"). It can look like it works if `data/minsnooks.db` happens to hold an old seed.
- **Fix:** pass the path inline on the command: `DATABASE_PATH=/tmp/demo.db npm run dev -- --host 0.0.0.0 --port 4173` (absolute path, as above). Keep `.env` for the auth vars SvelteKit reads through its own env modules (`AUTH_MODE`, `DEV_USER_EMAIL` — a missing `DEV_USER_EMAIL` makes every page render signed-out).

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

### `SqliteError: FOREIGN KEY constraint failed` from an `INSERT … ON CONFLICT DO UPDATE` *(verified here — 2026-09-28, Phase 2)*
- **Cause:** `lastInsertRowid` is **not** the row you just upserted when the conflict took the
  UPDATE branch — it can be stale (or 0). Resolving ids with `lastInsertRowid` after an upsert then
  inserts child rows against a nonexistent parent, which surfaces as an FK failure on a *later*
  statement (e.g. `result_frames`) and is very confusing to read.
- **Fix (in repo):** after every `ON CONFLICT … DO UPDATE`, resolve the id by its natural key —
  `SELECT id FROM seasons WHERE label = ?`, `SELECT id FROM rounds WHERE season_id = ? AND number = ?`,
  `SELECT id FROM results WHERE fixture_id = ?`. Used in `createSeason`, `openRound` and
  `saveLeagueResult` in `src/lib/server/league.ts`. Prefer plain `INSERT` + `ON CONFLICT DO UPDATE`
  only when you genuinely need convergence (idempotent seeding).

### better-sqlite3 returns snake_case column names, not your TypeScript aliases *(verified here)*
- **Cause:** `SELECT player_low_points AS low` gives you `{ low: … }`; `SELECT *` gives you the real
  column names. A test that types the row as `{ lowPoints }` silently reads `undefined`, so
  `undefined > undefined` is `false` and every assertion looks like a data bug rather than a typo.
- **Fix:** alias explicitly and type the row to match, or use `SELECT *` and the real names. When a
  seed/validation mismatch appears, dump the row before believing the generator.

### `.env` values do NOT reach `process.env` in the dev server *(verified here — 2026-09-28, Phase 5)*
- **Cause:** Vite loads `.env` for its own config/`import.meta.env` use; it does **not** copy `AUTH_MODE`, `DEV_USER_EMAIL`, etc. into the SvelteKit dev server's `process.env`. Server code reading `process.env.AUTH_MODE` silently sees `undefined` in dev (and in `vite preview`), so a dev identity looks "signed out" in the preview while unit tests (which pass their own env object) stay green.
- **Fix (in repo):** import the SvelteKit env proxy in server code and pass it explicitly —
  `import { env } from '$env/dynamic/private';` then `resolveViewerEmail(event.request, env)` in `hooks.server.ts`. `src/lib/server/auth.ts` types its input as the exported `AuthEnv = Record<string, string | undefined>`, which both `process.env` and the proxy satisfy.
- **Watch for:** the same trap in any new code that reads configuration. `process.env.NODE_ENV` is fine (Vite sets it); anything an operator configures in `.env` is not.

### Dev identity chooser submits but the visible viewer does not change *(verified here — 2026-09-28, Phase 7)*
- **Fix:** the DEV PREVIEW chooser now intercepts submit, builds the GET URL from all preserved query parameters and the selected `as` value, and navigates with SvelteKit `goto(..., { invalidateAll: true })`. This ensures the hook writes the identity cookie and the root layout reloads its viewer data. JavaScript-disabled forms retain the native GET fallback.
- **Verification:** requested the seeded Jules Rivera account and confirmed the response wrote `minsnooks_dev_viewer=jules.rivera@example.test` and rendered the admin viewer; `tests/viewer.test.ts` covers selection, persistence, clearing, nobody, and production fail-closed behavior.

### `$lib/...` runtime imports fail under Vitest *(verified here — 2026-09-28, Phase 6)*
- **Cause:** `vitest.config.ts` **replaces** `vite.config.ts` (Vitest does not merge the two), so the SvelteKit plugin — and with it the `$lib` alias — is not active in tests. Any *runtime* `import { x } from '$lib/x'` in a module the tests load dies with `Cannot find module '$lib/x'`. `import type { … } from '$lib/x'` is erased by the TS transform and is always safe.
- **Symptom:** `npm test` fails on a server module that `npm run check` and the dev server are perfectly happy with — the two use different resolvers, so green checks say nothing about test imports.
- **Fix (in repo):** server modules that tests load import their runtime siblings **relatively** (`../result-entry`, `./league-time`) and use `$lib` for types only. See `src/lib/server/league.ts` and `src/lib/server/results.ts`.

### `db.transaction(fn)` returns a function, not its result *(verified here — 2026-09-28, Phase 6)*
- **Cause:** better-sqlite3's `db.transaction(...)` *builds a wrapper*. `return db.transaction(() => {...})` hands the caller a `Transaction` object and writes nothing; the wrapper must be **invoked**: `return db.transaction((): ResultWriteOutcome => { ... })();`
- **Also:** annotate the callback's return type. Without it, TS widens literals like `'confirmed'` to `string` and the assignment to the declared outcome type fails at the call site.
- **Where:** `submitResult` / `reviewResult` / `correctResult` in `src/lib/server/results.ts`.

### Ordering a pair by *string* keys vs *numeric* ids *(verified here — Phase 2)*
- **Cause:** `orderedPair(a, b)` on player **keys** sorts lexicographically (`'ella' < 'maya'`), but
  the fixtures table orders by **numeric id** (`ella` = 6, `maya` = 1). Frame counts stored relative
  to `player_low_id` then land on the wrong player, and the only symptom is a validator complaint
  about breaks/frame winners.
- **Fix:** order seed keys by seed index (the order ids are assigned in) — `orderKeys()` in
  `src/lib/server/seed-data.ts` — and defensively re-derive `low`/`high` from the real ids at the
  write site.

### `npm error notarget No matching version found for @sveltejs/adapter-node@^6.0.0` (or similar)
- **Cause *(verified)*:** hand-edited `package.json` range that doesn't exist (adapter-node is **5.x**). Ranges must agree with the committed `package-lock.json`.
- **Fix:** `npm view <pkg> version`; regenerate with `rm package-lock.json && npm install`, then commit the lockfile.

### `throw redirect()` inside a SvelteKit action's `try` is swallowed *(verified here — 2026-09-29, Phase 10)*
- **Cause:** an action that computes its outcome and redirects inside one `try`, with `if (cause instanceof Response) throw cause` in the `catch`, returns the error fallback instead of redirecting — the write lands but the browser gets a 400. (`instanceof Response` does not reliably match the thrown redirect across the SSR module boundary.)
- **Fix (in repo):** compute inside `try`, redirect **after** the `catch` — the league record/review/correct actions already do this (`let outcome; try { outcome = ... } catch {...}; throw redirect(...)`). All five friendly actions follow the same shape. Symptom to recognise: action JSON `{"type":"error",...}` on an op whose DB row demonstrably exists.

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

  The digest is the `name` field (the `digest` field is always null). **Verified working here —
  2026-09-29, first publish (`v0.1.0-rc.4`)** — but only for **public** packages.
- **Private-package gotcha:** a private package returns `404 Package not found` for this session's
  token — never a 403 — so "404" means *private, invisible, or nonexistent*, not necessarily
  missing. The `GET /users/<u>/packages?package_type=…` list endpoint is useless here too:
  `container` → 400, `docker` → a misleading empty `[]` even when public packages exist. Trust
  only the versions endpoint above, with `package_type=container`.
- **Visibility gotcha:** GHCR creates a package **private** on first push regardless of the repo's
  visibility, and flipping the *repository* public later does **not** publish an existing package —
  the **package** must be flipped on its own settings page (owner-only; one-way: public cannot go
  back to private). Page URL format:
  `https://github.com/users/<user>/packages/container/package/<name>` — the owner opening that
  page while logged in is also the definitive existence check from outside the sandbox. The
  registry host itself (`ghcr.io`) stays unreachable from here (§4) — no manifest pulls.

### A session's remote GitHub access can end the moment its own PR merges *(lesson — 2026-09-29)*
- **Symptom:** `git push` / `gh` start failing with a "this coding session has ended…" style
  message right after the session's own PR merges.
- This is **not** the transient connector-drop issue above — no toggle fixes it; it means the
  session's GitHub credentials have been retired and will not come back.
- **Consequence:** don't merge a PR assuming you can still iterate afterwards via follow-up
  pushes/tags/PRs in the same session — prove the whole thing before merging where possible. For
  a release workflow that means: push a throwaway tag (e.g. `v0.0.0-test1`) against the PR
  branch's commit first — tag pushes trigger `release-image.yml` using the workflow file at that
  commit, regardless of branch — confirm the image actually lands in GHCR, delete the throwaway
  tag, and only then merge. Batch any unavoidable post-merge remote writes (e.g. the real release
  tag) into the same short window as the merge itself.

### The Arena GitHub connector can drop mid-session
- **Symptom:** every GitHub call dies at once — `git push` prompts for credentials (disabled → fails), `gh api` → `401 Bad credentials`. `GH_TOKEN` is an Arena-issued handle (in some sandboxes literally a dummy string), **not** a real PAT — there is no local credential to refresh; don't look for `~/.git-credentials` and don't ask the user for a PAT.
- **Fix:** the reconnect window — batch all remote work (push, PR, gh reads) into short windows; ask the user to toggle the GitHub connector off/on in Arena's "Add files and connections"; once they confirm, probe liveness with a **repo-scoped** read (`gh api repos/dougalbob/minsnooks --jq .full_name`) and run remote calls immediately. `GET /user` returning 403 is normal for the bot token; the dead-handle signature is **401**.
- **Do:** keep all local work (edits, tests, previews) outside windows. **Don't:** blindly retry a 401 — report exactly what completed, request a toggle, resume mid-checklist. Never force-push or re-tag a pushed tag. If a toggle doesn't revive `gh`, the sandbox may be stuck — start a fresh session.

## 6. Browsers / Playwright *(verified in this repo — 2026-09-29, Phase 15)*

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
- **Verified here, 2026-09-29:** `npx playwright install chromium` failed with CDN `ECONNRESET`. Installing `@sparticuz/chromium` into `/tmp/pwbrowsers` through npm succeeded; running its `executablePath()` inflated the binary, then the `.tar.br` shared libraries were inflated manually as above. `LD_LIBRARY_PATH=/tmp/al2023/lib /tmp/chromium --version` returned Chromium 153. The Phase 15 Playwright suite passed 3/3 using a throwaway overlay config pointing to `/tmp/chromium`; do not commit that local overlay. CI now uses `npx playwright install --with-deps chromium` followed by `npm run test:e2e`.
- **Do not:** accept "browser tests can't run here" — use the `/tmp/pwbrowsers` fallback when CDN/apt are blocked. Do not retry apt or the Playwright CDN in this sandbox.

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

- **Blanket find-and-replace hits unintended sites** *(verified here — Phase 6)*: turning every `\t});` into `\t})();` (to fix the transaction trap above) also rewrote two unrelated `rows.map(...)` closers, surfacing later as `TS2349: This expression is not callable`. Prefer anchored, unique strings; when a mass replace is unavoidable, `grep -n` every changed site and check each one.
- **An exact-match replace that silently does nothing is usually invisible whitespace** *(verified here)*: dump the region with `sed -n 'N,Mp' file | cat -A` before retyping the anchor — tabs versus spaces in a heredoc-embedded literal are the common cause, and the `assert s.count(old) == 1` guard above turns it into a loud failure instead of a no-op.

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
- [ ] All work committed **and pushed**; `git ls-remote origin "$(git branch --show-current)"` shows the tip
- [ ] No secrets, `.env`, or `data/*.db` in the diff
- [ ] Docs audit done (all six docs describe the implementation — standing pre-PR gate)
