# Deployment — container image & Unraid

**Status:** Release engineering added ahead of Phase 16 so a real staging instance can exist to
close the remaining [`docs/release-checklist.md`](release-checklist.md) items (staging-image
smoke journeys, Cloudflare Access allowlist check on the staging hostname, real-device push/PWA
install, CSP review against the actual production build). This is **not** itself Phase 16
(migration/cutover): it is the packaging step Phase 16 and the rest of the release checklist need
to exist first. See `PLAN.md` §4 and `HANDOFF.md` §9/§12 for the surrounding plan.

**Published:** the first image reached GHCR on 2026-09-29 — `ghcr.io/dougalbob/minsnooks:v0.1.0-rc.4`
(+ `:sha-5937ea0`), verified via the GHCR packages API (PRs #23–#26; the full diagnosis saga is
consolidated in `PLAN.md` §7 "15b"). The package is **public**, so pulls need no login (§4).

Treat the first published images as **pre-release / staging**, not a production cutover. Keep
following HANDOFF's isolation rules: a separate hostname, a separate Cloudflare Access
application, a separate Unraid appdata mount, and fictional/test data until Phase 16's rehearsal
and the release checklist are both signed off.

## 1. What gets built

- `Dockerfile` — multi-stage build. Stage 1 runs `npm ci && npm run build` (SvelteKit +
  `@sveltejs/adapter-node`, already wired in `vite.config.ts`) and prunes dev dependencies. Stage 2
  copies only `build/`, `node_modules`, `package.json` and `migrations/` into a slim
  `node:22-bookworm-slim` (Debian, glibc) runtime image, running as the image's built-in non-root
  `node` user.
- `better-sqlite3` ships prebuilt native bindings for `linux-x64`/`linux-arm64` (glibc) **inside
  its npm package** — no compiler toolchain is needed in either build stage, on either
  architecture (verified in-repo; see `SANDBOX.md` §0/§4).
- **Root cause found the hard way (2026-09-29):** three publish attempts (`v0.1.0-rc.1/2/3`, all
  since deleted — none ever produced an image) failed inside `RUN npm ci` with only a generic
  `exit code: 1` (GitHub Actions run logs are unreadable from this sandbox — SANDBOX.md §5 — so
  the initial guesses were made blind). First guess: Alpine/musl + QEMU arm64 emulation — disproved
  by re-running on `bookworm-slim` with the same failure (the switch was kept as glibc hardening
  that matches the Actions runner, not as the fix). Second finding, real but masked: reproducing
  the step locally surfaced that `better-sqlite3` ships a `binding.gyp` with **no** declared
  `install`/`postinstall` script, so npm's legacy default kicks in and runs `node-gyp rebuild` —
  compiling from source, which needs a full C/C++ toolchain neither base image has. The fix for
  that is `npm ci --ignore-scripts` (exactly what `ci.yml` already does per SANDBOX.md §0); the
  package still works because `better-sqlite3` resolves one of its bundled prebuilt `.node`
  binaries at `require()` time (verified locally: `require('better-sqlite3')` opens a database
  immediately after an `--ignore-scripts` install, no compiler present). **The actual bug,**
  revealed only when the owner pasted the raw Actions log: an automated edit in PR #25 had
  deleted the `COPY package.json package-lock.json ./` line, so `npm ci` ran against an empty
  `/app` and died with `npm error code EUSAGE … npm ci can only install with an existing
  package-lock.json`. Restoring that line (PR #26) fixed the publish. Both facts now stand in the
  Dockerfile: lockfile copied first (also makes the layer cache across source edits), then
  `npm ci --ignore-scripts`. Lesson (SANDBOX.md §5): if a future build fails with only a generic
  `exit code: 1`, ask for the raw log before guessing — this sandbox cannot read CI logs itself.
- `.github/workflows/release-image.yml` builds and pushes `linux/amd64` + `linux/arm64` images to
  `ghcr.io/dougalbob/minsnooks` — **only** on a pushed `vX.Y.Z` tag or a manual dispatch, never on
  every `main`/`arena/**` push (that stays CI-only, per `.github/workflows/ci.yml`). Images are
  tagged with the git tag itself and `sha-<short-sha>`; `:latest` only moves for a **stable**
  `vX.Y.Z` tag, never a pre-release like `vX.Y.Z-rc.1` — always pin an exact tag on Unraid, never
  `:latest`, so a redeploy never silently changes what is running.

## 2. Publishing an image

1. Merge the packaging change to `main` (owner-approved PR, same as every other phase).
2. Tag the release commit and push the tag, e.g. (next tag after the first published `v0.1.0-rc.4`):
   ```sh
   git checkout main && git pull
   git tag v0.1.0-rc.5
   git push origin v0.1.0-rc.5
   ```
3. GitHub Actions builds and pushes `ghcr.io/dougalbob/minsnooks:v0.1.0-rc.5` (+ `:sha-xxxxxxx`).
   Watch it with `gh run watch --exit-status` (CI logs are unreadable from this sandbox — see
   `SANDBOX.md` §5 — but `gh run view <id> --json jobs` and check-run annotations work).
4. Verify the tags actually landed via the packages API (works from this sandbox now that the
   package is public — see `SANDBOX.md` §5 for the private-package 404 gotcha):
   ```sh
   gh api "/users/dougalbob/packages/container/minsnooks/versions?per_page=20" \
     -q '.[] | "tags=\(.metadata.container.tags|join(","))  digest=\(.name)"'
   ```
5. **Visibility:** GHCR creates a package **private** on first push (this is independent of the
   repository's visibility, and repository visibility changes afterwards do **not** propagate to
   an existing package). The `minsnooks` package was created private (the repo was private at the
   time) and the owner flipped it to **public** on 2026-09-29 — note that is **one-way**: a public
   package cannot be made private again. The image contains only application code — no secrets, no
   real player data — so public is acceptable here; if a package must stay private, Unraid needs a
   credential (§4).

Never re-tag or force-push an already-published tag (SANDBOX.md §5) — cut a new tag instead.

## 3. Required environment variables

Set these on the container (the Unraid template in `deploy/unraid/example.xml` exposes all of
them):

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | Always `production` in the image; do not override. |
| `PORT` / `HOST` | no | Default `3000` / `0.0.0.0`; match the template's port mapping if changed. |
| `DATABASE_PATH` | yes | Must point inside the mounted volume, e.g. `/data/minsnooks.db`. Migrations run automatically on first DB access (`getDb()` in `src/lib/server/db.ts`) — no separate migrate step needed at container start. |
| `ORIGIN` | **yes** | The public HTTPS origin players use, e.g. `https://snooker-v2.example.com`. SvelteKit's built-in form-action CSRF/origin check (see `docs/security.md` §7) needs this whenever the app sits behind a reverse proxy/Cloudflare — without it, every POST (recording a result, booking a date, etc.) is rejected. |
| `AUTH_MODE` | yes | Must be `access` for any Internet-reachable deployment. `dev` is refused whenever `NODE_ENV=production` (see `src/lib/server/viewer.ts`), but set it explicitly anyway. |
| `CF_TEAM_DOMAIN` | when `AUTH_MODE=access` | e.g. `yourteam.cloudflareaccess.com`. |
| `CF_AUD` | when `AUTH_MODE=access` | The Access application's AUD tag. |
| `ACCESS_EMAIL_ALLOWLIST` | when `AUTH_MODE=access` | Comma-separated approved league member emails. Fails closed if unset (`docs/security.md`). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | no | Optional web push (Phase 14). Without them the in-app inbox still works; push controls gracefully disable. Generate a fresh pair per deployment — never reuse a dev pair. |

Do not set `AUTH_MODE=dev` on the Unraid box at all; there is no reason to and it removes the
fail-closed guardrail as a safety net.

## 4. Pulling from GHCR on Unraid (private-pull login, if ever needed)

The `minsnooks` package is **public** (since 2026-09-29), so Unraid pulls
`ghcr.io/dougalbob/minsnooks:<tag>` anonymously — no login step is needed. (Public is one-way on
GitHub; if the package were ever private again, or you publish a separate private image, Unraid's
Docker engine needs a login for `ghcr.io`. From the Unraid terminal or SSH:)

```sh
docker login ghcr.io -u <your-github-username> -p <personal-access-token>
```

Use a GitHub PAT scoped to `read:packages` only (a fine-grained token limited to this repository's
packages is preferable to a classic all-scopes token). This only needs to be done once per Unraid
box; the credential persists in Docker's config and dockerman will then pull
`ghcr.io/dougalbob/minsnooks:<tag>` like any other private image when you add the template.

## 5. Reverse proxy / Cloudflare notes

- The container listens on plain HTTP inside the LAN (`PORT`, default `3000`). Whatever sits in
  front of it (Cloudflare Tunnel, Nginx Proxy Manager, SWAG, etc.) terminates TLS and forwards to
  the container's mapped port; the container itself never needs a TLS certificate.
- Set `ORIGIN` to the externally visible `https://` hostname regardless of the internal transport
  — see §3.
- Cloudflare Access protects the hostname; the app additionally verifies the
  `Cf-Access-Jwt-Assertion` JWT itself (issuer/audience/signature/expiry) and enforces
  `ACCESS_EMAIL_ALLOWLIST` server-side — it never trusts Access success alone for admin/role
  decisions (`docs/security.md`). Use a **separate** Access application/hostname from any existing
  V1 Access app; never point this container at V1's hostname or database.
- All SSR/API responses are `Cache-Control: private, no-store`; nothing authenticated is cacheable
  at Cloudflare's edge, so no cache-bypass rule is required for correctness. A short-lived "cache
  bypass"/"manifest bypass" rule is still worth adding for the PWA manifest/icons if Cloudflare's
  edge is caching static assets aggressively for the zone.

## 6. Data persistence and backups

- Mount a single persistent volume at `/data` (Unraid appdata, e.g.
  `/mnt/user/appdata/snooker-league-v2` per HANDOFF's suggested naming) — never a network share,
  and never rely on the image layer. `DATABASE_PATH` must live under this mount.
- WAL mode + foreign keys + a busy timeout are enabled by the app itself (`src/lib/server/db.ts`);
  a naive file copy of a live WAL database is not a safe backup on its own.
- The Phase 16 backup/restore rehearsal (daily online backup, weekly encrypted off-machine copy,
  30 daily + 12 weekly retention, quarterly restore drill; destination still to be chosen) is
  separate follow-up work, not covered by this packaging change.

## 7. Health check and updates

- The image defines a `HEALTHCHECK` (`GET /` inside the container); `docker ps` / Unraid's
  dashboard show `healthy`/`unhealthy` once the DB has opened and migrations have run.
- To upgrade: pull a new pinned tag, recreate the container (data survives on the `/data` volume),
  confirm `healthy`, then smoke-test. Never point the template at `:latest`.
