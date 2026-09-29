# Minsnooks V2

A ground-up V2 of the Minsnooks family snooker league — mobile-first, snooker-led, and built incrementally with tests. **This checkout contains no live data and must never touch V1** (`dougalbob/snooker-league`) or its database. All names, dates, scores, and fixtures in development are fictional.

## Where to start

1. **[`PLAN.md`](PLAN.md)** — the phased implementation plan and session status log.
2. **[`HANDOFF.md`](HANDOFF.md)** — discovery decisions, league rules, safety constraints, and open product questions.
3. **[`SANDBOX.md`](SANDBOX.md)** — sandbox/preview pitfalls and fixes (read before fighting the environment).
4. **[`prototype/`](prototype/)** — the owner-approved static UX prototype (visual source of truth; run it with any static server from that directory).

## Run the app (preview)

```sh
npm install
npm run dev -- --host 0.0.0.0
```

Open the printed URL (mobile viewport recommended). First time: `cp .env.example .env`, then `npm run seed` to load the eight fictional players, 2026 league, friendly examples and four knockout demo invitations.

Player checkpoint: **`/fixtures`** — fixture cards for the round in play (your fixtures emphasised), planned dates you can arrange, agree to, change or cancel, the results archive, and the record/review journey.

Phase 7 admin checkpoint: **`/admin/awards`** — preview a withdrawal's impact, resolve outstanding fixtures from a genuine previous-round result or a one-time server-side 0–3 draw, inspect the award ledger, and review any awards whose source result was corrected. Switch to an admin in the DEV PREVIEW chooser first. Existing seed awards are fictional; use only this seeded demo data. The separate **Random draw demo preview** runs on an isolated copy where earlier Sam–Noah results are removed, so withdrawing Sam demonstrates the fallback; it does not change the main seeded preview.

Phase 9 player checkpoint: **`/stats`** — real **My Stats** and **League Stats**, five-result form, canonical league-position history, rolling eight-match frames-won trend with season average, optional point/break coverage, joint records, Most Improved, head-to-head and streaks. Use the dev identity chooser to review another fictional player; the home page has a gated current-round spotlight. Keep the preview server running for UX review.

Phase 10 player checkpoint: **`/friendlies`** — arrange a friendly with another registered player, record a played friendly (any frame count, draws allowed, 0–0 never saved, actual date required), and correct saved results as either participant or an admin. Optional frame scores and breaks stay out of every league stat; unsaved plans expire five days after the scheduled date via the scheduler (expiry demo: run the admin scheduler “as of” a later date on an isolated copy, as in `tests/friendlies.test.ts`).

Phase 11 player/admin checkpoint: **`/knockout`** — the seeded Autumn invitation is open for player opt-in; the separate six-player practice entry is past its fictional reply deadline and ready for an admin to close, select and draw. Switch identities with the DEV PREVIEW chooser to try a player reply. Invitations require 6–8 selected players, >8 opt-ins produce a randomized waiting list, consensual swaps are audited before the first draw, and the server saves opening ties/byes with the competition’s fixed first-to-2/3/4 format.

Phase 12 player/admin checkpoint: **`/knockout`** — the same page now runs the whole event dynamically. Participants record first-to-N results frame by frame (play stops at the target), propose dates, nudge each other, and correct their own results; admins draw each later stage once the previous one is fully resolved, record audited dropouts (opponent advances on a walkover; a dropped bye-holder is removed and the stage redrawn afresh — never from the waiting list), and override corrections with a mandatory reason. The seed loads **Winter Plate · Played to the Final** (opening, semis and final draw all saved — record the final to complete it) and **Charity Cup · Stage Two Ready** (a dropped bye-holder voided their tie; the stage-two play-in is played and the admin can draw the last stage). Knockout results never add league points or stats.

Phase 13 player checkpoint: **`/chat`** — a calm league channel plus private one-to-one messages, with a **Chat** entry and unread badge in the bottom navigation. Messages cannot be edited; an author can delete their own (a placeholder stays in place), and anyone can report a message to the admin queue at **`/admin/chat`**, where an admin hides it with a written, audited reason or keeps it. Admins never read a private conversation they are not part of, and there is no blocking — the family-league decision recorded in [`docs/spec/chat.md`](docs/spec/chat.md) §10. The seed supplies a short fictional channel conversation, two DM threads (one unread message for the preview identity) and one open report; switch identities with the DEV PREVIEW chooser to walk both sides.

Phase 14 (merged to `main` in PR #19) checkpoint: **`/calendar?month=2026-10`** shows an agreed fictional league date and Maya’s availability; use the DEV PREVIEW switcher to mark days or, as a fixture participant, send/accept a date proposal from its fixture page. Pending league/friendly/knockout plans are visible to participants only; agreed league dates and member availability are visible to signed-in members, never visitors. **`/notifications`** has an in-app inbox, generic DM-only chat alerts (no league-channel push) and optional device push controls. Install the PWA via the browser; offline navigation shows a static fallback, never cached member data. Local push requires VAPID values in `.env` (see `.env.example`); without keys the inbox works and push controls gracefully disable. For real deployment configure a fresh VAPID key pair/subject and test push on the Access-protected hostname.

**Phase 15 implementation merged to `main` via [PR #21](https://github.com/dougalbob/minsnooks/pull/21); release verification remains in progress.** Preview the admin dashboard at **`/admin`**, league reports at **`/admin/reports`**, and future-only defaults at **`/admin/settings`** (switch to Maya Chen, admin, with the DEV PREVIEW chooser). Settings updates are audited; existing round/season snapshots and player privacy choices are not rewritten. PR and post-merge CI passed. The release checklist is [`docs/release-checklist.md`](docs/release-checklist.md); do not treat the app as release-ready until it is complete.

`/debug/seed` is a debug checkpoint: it renders the seeded round and season tables read straight from SQLite through the standings engine. It is not part of the player-facing app.

## Deploy (container image / Unraid)

A `Dockerfile` builds the single Node application (`@sveltejs/adapter-node`) into a slim
`node:22-bookworm-slim` image; `.github/workflows/release-image.yml` publishes it to
`ghcr.io/dougalbob/minsnooks` for a pushed `vX.Y.Z` git tag (never for every `main`/`arena/**`
push). The first image reached GHCR on 2026-09-29: `v0.1.0-rc.4` (+ `sha-5937ea0`) — a
pre-release/staging build, verified via the GHCR packages API (`:latest` only ever moves for a
stable tag). [`docs/deployment.md`](docs/deployment.md) covers required environment variables
(`ORIGIN`, `AUTH_MODE=access`, `CF_TEAM_DOMAIN`, `CF_AUD`, `ACCESS_EMAIL_ALLOWLIST`, optional VAPID
keys), pulling from GHCR on Unraid (the package is public — no login needed), and
persistence/backup notes.
[`deploy/unraid/example.xml`](deploy/unraid/example.xml) is a starting-point Unraid Docker template
for `dockerman` — pin an exact published tag before use, never `:latest`. This packaging step is
separate from, and comes before, Phase 16 (migration/cutover) and the remaining
[`docs/release-checklist.md`](docs/release-checklist.md) items, several of which need a real
staging image/hostname to close out.

## Develop

```sh
npm test              # vitest unit tests (domain invariants, migrations, auth, standings, stats, admin settings/security, chat, calendar, notifications)
npm run test:e2e      # Playwright player/opponent/admin smoke journeys on a fresh isolated fictional DB
npm run check         # svelte-check / TypeScript
npm run migrate       # apply SQL migrations (idempotent)
npm run seed          # seed fictional league, friendlies and knockout preview data (idempotent)
npm run build && node build   # production-style build (adapter-node)
```

- Before the first `npm run test:e2e`, install Chromium with `npx playwright install chromium`; if the sandbox CDN is blocked, use the verified `@sparticuz/chromium` instructions in [`SANDBOX.md`](SANDBOX.md) §6. The suite creates and removes an isolated fictional SQLite database; it never runs against the application's seeded preview DB or production.
- SQLite database lives at `data/minsnooks.db` (git-ignored). WAL + foreign keys + busy timeout are enabled by `src/lib/server/db.ts`.
- SQL migrations live in `migrations/*.sql`, applied in order by a tested runner; never edit an applied migration — add a new one.
- [`docs/schema.md`](docs/schema.md) documents the canonical league schema (including chat) and the standings engine; [`docs/spec/chat.md`](docs/spec/chat.md) is the owner-confirmed chat specification.
- **A planned date is never a played date.** `bookings` is a plan between two players (the fixture's `booked_date` column only mirrors the single active plan); the actual date played lives on `results.actual_played_date` and is confirmed by the opponent. Only the two players in a fixture — or an admin override — can propose, change or cancel a plan, and every change is audited.
- **Standings have exactly one path.** `computeStandings()` in `src/lib/server/standings.ts` is the only way to produce a league table; screens, reports and statistics must all use it. Only confirmed results count, and administrative awards add table points without touching frames, frame difference or match wins.
- Auth: `AUTH_MODE=dev` uses `DEV_USER_EMAIL` (never allowed in production); `AUTH_MODE=access` verifies Cloudflare Access JWTs against `CF_TEAM_DOMAIN`/`CF_AUD` with an explicit `ACCESS_EMAIL_ALLOWLIST`, failing closed on any missing configuration. See `.env.example`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/` | SvelteKit 2 + Svelte 5 + TypeScript application |
| `src/lib/standings.ts` | Pure ranking core (ordering, shared positions, ball colours) |
| `src/lib/server/standings.ts` | Canonical DB-backed standings engine, including historical event snapshots |
| `src/lib/stats.ts` | Pure league-stat calculations (form, rolling averages, records, streaks) |
| `src/lib/server/stats-page.ts` | Confirmed-result stats loader, optional-detail coverage and home highlights |
| `src/lib/server/league.ts` | League write paths (open round, save result, awards, audit) |
| `src/lib/server/bookings.ts` | Planned dates: propose / change / cancel / opponent acceptance, permissions, audit (never a result) |
| `src/lib/server/withdrawals-awards.ts` | Phase 7 withdrawal/award transaction, one-time draws, source correction review and ledger |
| `src/lib/server/friendlies.ts` | Phase 10 friendly scheduling/results/corrections, permissions, idempotent expiry, loaders |
| `src/lib/server/knockout.ts` | Phase 11 invitations, opt-ins, random entry selection, consented swaps, first-stage draw, competition views and audit |
| `src/lib/server/knockout-progression.ts` | Phase 12 results, corrections, dropouts, later-stage draws, arrangements, nudges (transactional, audited) |
| `src/lib/knockout-progression.ts` | Pure first-to-N frame validation and stage pairing rules shared by browser and server |
| `src/lib/friendly-entry.ts` | Pure friendly validation + form parsing shared by browser and server |
| `src/lib/chat.ts` | Pure chat rules: body/reason normalisation, day grouping, league-local labels (shared by browser and server) |
| `src/lib/chat-view.ts` | Client-safe chat view types (messages, threads, reports) |
| `src/lib/server/chat.ts` | Phase 13 chat write/read paths: channel + DM threads, unread cursors, rate limits, author delete, reports and audited moderation |
| `src/lib/server/calendar.ts` | Private calendar queries and self-managed availability |
| `src/lib/server/notifications.ts` | In-app inbox, push subscriptions and server-side VAPID delivery |
| `src/lib/server/fixtures-page.ts` | Fixtures & results page data (fixture views, results archive, fixture detail) |
| `src/lib/server/viewer.ts` | Verified email → active player row (Cloudflare Access or dev-only preview identity) |
| `src/lib/server/seed-data.ts` | Deterministic fictional league plan |
| `migrations/` | Forward-only SQL migrations |
| `tests/` | Vitest suites |
| `docs/` | Schema and design documentation |
| `prototype/` | Approved static UX prototype (frozen visual reference) |
| `PLAN.md` | Phased build plan + per-session status log |
| `HANDOFF.md` | Discovery handoff (binding product decisions) |
