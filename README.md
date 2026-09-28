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

Open the printed URL (mobile viewport recommended). First time: `cp .env.example .env`, then `npm run seed` to load the eight fictional players and the 2026 league.

`/debug/seed` is a debug checkpoint: it renders the seeded round and season tables read straight from SQLite through the standings engine. It is not part of the player-facing app.

## Develop

```sh
npm test              # vitest unit tests (domain invariants, migrations, auth, standings)
npm run check         # svelte-check / TypeScript
npm run migrate       # apply SQL migrations (idempotent)
npm run seed          # seed fictional players + the 2026 league (idempotent)
npm run build && node build   # production-style build (adapter-node)
```

- SQLite database lives at `data/minsnooks.db` (git-ignored). WAL + foreign keys + busy timeout are enabled by `src/lib/server/db.ts`.
- SQL migrations live in `migrations/*.sql`, applied in order by a tested runner; never edit an applied migration — add a new one.
- [`docs/schema.md`](docs/schema.md) documents the canonical league schema and the standings engine.
- **Standings have exactly one path.** `computeStandings()` in `src/lib/server/standings.ts` is the only way to produce a league table; screens, reports and statistics must all use it. Only confirmed results count, and administrative awards add table points without touching frames, frame difference or match wins.
- Auth: `AUTH_MODE=dev` uses `DEV_USER_EMAIL` (never allowed in production); `AUTH_MODE=access` verifies Cloudflare Access JWTs against `CF_TEAM_DOMAIN`/`CF_AUD` with an explicit `ACCESS_EMAIL_ALLOWLIST`, failing closed on any missing configuration. See `.env.example`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/` | SvelteKit 2 + Svelte 5 + TypeScript application |
| `src/lib/standings.ts` | Pure ranking core (ordering, shared positions, ball colours) |
| `src/lib/server/standings.ts` | Canonical DB-backed standings engine |
| `src/lib/server/league.ts` | League write paths (open round, save result, awards, audit) |
| `src/lib/server/seed-data.ts` | Deterministic fictional league plan |
| `migrations/` | Forward-only SQL migrations |
| `tests/` | Vitest suites |
| `docs/` | Schema and design documentation |
| `prototype/` | Approved static UX prototype (frozen visual reference) |
| `PLAN.md` | Phased build plan + per-session status log |
| `HANDOFF.md` | Discovery handoff (binding product decisions) |
