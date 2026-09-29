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

Open the printed URL (mobile viewport recommended). First time: `cp .env.example .env`, then `npm run seed` to load the eight fictional players, 2026 league, friendly examples and two knockout preview invitations.

Player checkpoint: **`/fixtures`** — fixture cards for the round in play (your fixtures emphasised), planned dates you can arrange, change or cancel, the results archive, and the record/review journey.

Phase 7 admin checkpoint: **`/admin/awards`** — preview a withdrawal's impact, resolve outstanding fixtures from a genuine previous-round result or a one-time server-side 0–3 draw, inspect the award ledger, and review any awards whose source result was corrected. Switch to an admin in the DEV PREVIEW chooser first. Existing seed awards are fictional; use only this seeded demo data. The separate **Random draw demo preview** runs on an isolated copy where earlier Sam–Noah results are removed, so withdrawing Sam demonstrates the fallback; it does not change the main seeded preview.

Phase 9 player checkpoint: **`/stats`** — real **My Stats** and **League Stats**, five-result form, canonical league-position history, rolling eight-match frames-won trend with season average, optional point/break coverage, joint records, Most Improved, head-to-head and streaks. Use the dev identity chooser to review another fictional player; the home page has a gated current-round spotlight. Keep the preview server running for UX review.

Phase 10 player checkpoint: **`/friendlies`** — arrange a friendly with another registered player, record a played friendly (any frame count, draws allowed, 0–0 never saved, actual date required), and correct saved results as either participant or an admin. Optional frame scores and breaks stay out of every league stat; unsaved plans expire five days after the scheduled date via the scheduler (expiry demo: run the admin scheduler “as of” a later date on an isolated copy, as in `tests/friendlies.test.ts`).

Phase 11 player/admin checkpoint: **`/knockout`** — the seeded Autumn invitation is open for player opt-in; the separate six-player practice entry is past its fictional reply deadline and ready for an admin to close, select and draw. Switch identities with the DEV PREVIEW chooser to try a player reply. Invitations require 6–8 selected players, >8 opt-ins produce a randomized waiting list, consensual swaps are audited before the first draw, and the server saves opening ties/byes with the competition’s fixed first-to-2/3/4 format. Phase 12 adds match results and later-stage progression.

`/debug/seed` is a debug checkpoint: it renders the seeded round and season tables read straight from SQLite through the standings engine. It is not part of the player-facing app.

## Develop

```sh
npm test              # vitest unit tests (domain invariants, migrations, auth, standings, stats, bookings, results, withdrawals/awards, friendlies, knockout)
npm run check         # svelte-check / TypeScript
npm run migrate       # apply SQL migrations (idempotent)
npm run seed          # seed fictional league, friendlies and knockout preview data (idempotent)
npm run build && node build   # production-style build (adapter-node)
```

- SQLite database lives at `data/minsnooks.db` (git-ignored). WAL + foreign keys + busy timeout are enabled by `src/lib/server/db.ts`.
- SQL migrations live in `migrations/*.sql`, applied in order by a tested runner; never edit an applied migration — add a new one.
- [`docs/schema.md`](docs/schema.md) documents the canonical league schema and the standings engine.
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
| `src/lib/server/bookings.ts` | Planned dates: propose / change / cancel, permissions, audit (never a result) |
| `src/lib/server/withdrawals-awards.ts` | Phase 7 withdrawal/award transaction, one-time draws, source correction review and ledger |
| `src/lib/server/friendlies.ts` | Phase 10 friendly scheduling/results/corrections, permissions, idempotent expiry, loaders |
| `src/lib/server/knockout.ts` | Phase 11 invitations, opt-ins, random entry selection, consented swaps, first-stage draw and audit |
| `src/lib/friendly-entry.ts` | Pure friendly validation + form parsing shared by browser and server |
| `src/lib/server/fixtures-page.ts` | Fixtures & results page data (fixture views, results archive, fixture detail) |
| `src/lib/server/viewer.ts` | Verified email → active player row (Cloudflare Access or dev-only preview identity) |
| `src/lib/server/seed-data.ts` | Deterministic fictional league plan |
| `migrations/` | Forward-only SQL migrations |
| `tests/` | Vitest suites |
| `docs/` | Schema and design documentation |
| `prototype/` | Approved static UX prototype (frozen visual reference) |
| `PLAN.md` | Phased build plan + per-session status log |
| `HANDOFF.md` | Discovery handoff (binding product decisions) |
