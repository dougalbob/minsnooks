# Deployment — container image & Unraid

**Status:** Release engineering added ahead of Phase 16 so a real staging instance can exist to
close the remaining [`docs/release-checklist.md`](release-checklist.md) items (staging-image
smoke journeys, Cloudflare Access allowlist check on the staging hostname, real-device push/PWA
install, CSP review against the actual production build). This is **not** itself Phase 16
(migration/cutover): it is the packaging step Phase 16 and the rest of the release checklist need
to exist first. See `PLAN.md` §4 and `HANDOFF.md` §9/§12 for the surrounding plan.

Treat the first published images as **pre-release / staging**, not a production cutover. Keep
following HANDOFF's isolation rules: a separate hostname, a separate Cloudflare Access
application, a separate Unraid appdata mount, and fictional/test data until Phase 16's rehearsal
and the release checklist are both signed off.

## 1. What gets built

- `Dockerfile` — multi-stage build. Stage 1 runs `npm ci && npm run build` (SvelteKit +
  `@sveltejs/adapter-node`, already wired in `vite.config.ts`) and prunes dev dependencies. Stage 2
  copies only `build/`, `node_modules`, `package.json` and `migrations/` into a slim
  `node:22-alpine` runtime image, running as a non-root `minsnooks` user.
- `better-sqlite3` ships prebuilt native bindings for `linux-x64`, `linux-arm64`, `linuxmusl-x64`
  and `linuxmusl-arm64` **inside its npm package** — no compiler toolchain is needed in either
  build stage, and the same install works unmodified on Alpine and on both `amd64`/`arm64`
  (verified in-repo; see `SANDBOX.md` §0/§4).
- `.github/workflows/release-image.yml` builds and pushes `linux/amd64` + `linux/arm64` images to
  `ghcr.io/dougalbob/minsnooks` — **only** on a pushed `vX.Y.Z` tag or a manual dispatch, never on
  every `main`/`arena/**` push (that stays CI-only, per `.github/workflows/ci.yml`). Images are
  tagged with the git tag itself and `sha-<short-sha>`; `:latest` only moves for a **stable**
  `vX.Y.Z` tag, never a pre-release like `vX.Y.Z-rc.1` — always pin an exact tag on Unraid, never
  `:latest`, so a redeploy never silently changes what is running.

## 2. Publishing an image

1. Merge the packaging change to `main` (owner-approved PR, same as every other phase).
2. Tag the release commit and push the tag, e.g.:
   ```sh
   git checkout main && git pull
   git tag v0.1.0-rc.1
   git push origin v0.1.0-rc.1
   ```
3. GitHub Actions builds and pushes `ghcr.io/dougalbob/minsnooks:v0.1.0-rc.1` (+ `:sha-xxxxxxx`).
   Watch it with `gh run watch --exit-status` (CI logs are unreadable from this sandbox — see
   `SANDBOX.md` §5 — but `gh run view <id> --json jobs` and check-run annotations work).
4. The package is created **private**, linked to the private `dougalbob/minsnooks` repo. Unraid
   needs a credential to pull it (§4) unless you deliberately flip the package to public in its
   GitHub package settings — the image contains only application code, no secrets and no real
   player data, but default to private to match the rest of this project's posture.

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

## 4. Pulling a private GHCR image on Unraid

Unraid's Docker engine can pull private GHCR images once it has a login for `ghcr.io`. From the
Unraid terminal (or an SSH session):

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
