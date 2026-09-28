# Canonical league schema

Phase 2 of [`PLAN.md`](../PLAN.md). Applied by `migrations/0002_league.sql` on top of
`migrations/0001_init.sql` (players, app settings). Read [`HANDOFF.md`](../HANDOFF.md) §4 and §10
for the product rules this schema enforces.

All migrations are forward-only. Never edit an applied migration — add a new one. The runner
(`src/lib/server/migrate.ts`) records a checksum per file and refuses to re-apply a changed one.

## Why the schema looks like this

V1 derived round opponents from the current player list, checked fixture uniqueness in application
code, and overloaded the booked date as the played date (HANDOFF §10). V2 therefore stores each
round's **roster**, its **pairings**, its **deadline/grace snapshot**, and the **actual date played**
explicitly, and enforces the invariants with database constraints rather than application checks.

## Tables

### `seasons`
One row per league season. Scoring is **per season** and is never edited mid-season — an admin can
change league scoring only when starting a new season.

| Column | Notes |
| --- | --- |
| `label` | unique, e.g. `2026` |
| `frames_per_match` | 3 for 2026 (three frames actually played per league match) |
| `points_per_frame` | 1 for 2026 (one table point per frame won) |
| `match_win_bonus` | 0 for 2026 (no extra points for winning the match) |
| `timezone` | league-local calendar dates, provisional `Europe/London` |

### `rounds`
One row per round of a season. Opening a round is a single transaction that snapshots everything
below, so later membership or settings changes cannot silently rewrite history.

| Column | Notes |
| --- | --- |
| `number` | 1-based within the season; `UNIQUE (season_id, number)` |
| `status` | `open` accepts scheduling; `closed` is final for that round |
| `is_final` | admin explicitly marks the season's final round; no auto-open afterwards |
| `deadline_at` | snapshot captured when the round opens |
| `grace_days` | snapshot; unplayed fixtures close neutrally after deadline + grace |
| `opened_at` / `closed_at` | audit trail |

### `round_players`
The **roster snapshot**: exactly the players included in this round. A player who joins later
appears from the next round, never halfway through a generated round. A withdrawn player stays
visible here so their history and earned points survive (`withdrawn` flag; the withdrawal flow
itself lands in Phase 7).

### `fixtures`
One fixture per pair per round, created for **every** opponent pair when the round opens — booking
is optional and a fixture exists independently of any booking.

| Column | Notes |
| --- | --- |
| `player_low_id` < `player_high_id` | canonical ordering; `CHECK (player_low_id < player_high_id)` |
| `UNIQUE (round_id, player_low_id, player_high_id)` | atomic uniqueness, including against the mirrored `(b, a)` ordering |
| `state` | `unplayed`, `awaiting_confirmation`, `confirmed`, `closed_unplayed`, `awarded` |
| `booked_date` | proposed/booked date — **never** the actual date played |

`closed_unplayed` is the neutral closure state: no played 0–0 is created, nobody is blamed or
awarded, and the fixture cannot reappear as outstanding or masquerade as a result.

### `results`
The played match. One row per fixture (`fixture_id UNIQUE`).

| Column | Notes |
| --- | --- |
| `player_low_frames` / `player_high_frames` | frame winners; the sum must equal the season's `frames_per_match` |
| `actual_played_date` | required for every saved result; never inferred from `booked_date` |
| `status` | `submitted` (awaiting opponent confirmation), `confirmed`, `sent_back` |
| `entry_source` | `player` (needs opponent confirmation), `admin_direct`, `admin_retrospective` |
| `submitted_by_player_id` / `confirmed_by_player_id` / `confirmed_at` | who recorded and who approved |
| `corrected_at` / `correction_reason` | post-approval changes (Phase 6) |

Only `status = 'confirmed'` results feed the standings. A submitted-but-unconfirmed result never
moves the table, and a result submitted before closure is not "unplayed" for auto-advance purposes.

**Why the frame sum is not a table CHECK:** `frames_per_match` lives on the parent season, and a
SQLite `CHECK` cannot see a parent row. The sum is validated in `validateLeagueResult`
(`src/lib/server/league.ts`) and covered by tests instead.

### `result_frames`
Optional frame-by-frame snooker point scores (e.g. 47–65, 76–38, 65–29). All frames or none; they
cannot be added after submission.

### `result_breaks`
Optional highest break per player for a result. May be recorded even when frame detail is omitted.
A break may not exceed that player's best recorded frame score **in any frame they played** — a 60
break in a 60–65 frame is legal.

### `awards`
Administrative awards. **Table points only** — they live in their own table and create no result
row, so they cannot contribute frames, frame difference, match wins or any performance metric.

| Column | Notes |
| --- | --- |
| `table_points` | non-negative; a 0-point award changes nothing and raises no asterisk |
| `source_type` | `previous_round_result` (requires `source_result_id`), `random_draw` (requires `draw_value`, 0–3, equal odds), `manual` |
| `source_result_id` | must be a **genuine previous-round league result** against the same opponent — never a previous award |
| `created_by_player_id` / `reason` | initiator and justification |

`fixture_id UNIQUE` keeps an award one-per-fixture. `previousRoundPointsAgainst()` is the only
automatic award source and ignores unconfirmed submissions.

### `audit_log`
Append-only record of who changed what, when and why. Populated by `recordAudit()`; the admin
browser arrives in Phase 15.

## The standings engine

`src/lib/server/standings.ts` is the **single canonical path** from the database to a standings
table (HANDOFF §10). Every screen, report and statistic must go through `computeStandings`.

- **Table points** = frames won in confirmed results + award table points.
- **Frame difference** = frames won − frames lost in confirmed results. Awards contribute nothing.
- **Match wins** = confirmed results where the player won more frames.
- **Ordering**: table points → frame difference → match wins. Players still tied share a position
  (competition ranking), so joint first means joint champions with no mandatory playoff.
- **Scope**: pass `roundId` for a round table, omit it for the season table. Players come from
  `round_players`, so a withdrawn player still appears with their earned points.
- The pure ordering and positional ball-colour core lives in `src/lib/standings.ts` (`rankRows`),
  shared with the client.

An invariant worth testing: for played results only, `frame difference = 2 × points − 3 × played`
for a three-frame season. Awards break that identity by design, which is exactly why
`tests/league.test.ts` subtracts award points before asserting it.

## Fictional seed

`npm run seed` inserts the eight prototype players and season 2026: six rounds, 168 fixtures
(6 × C(8,2)), 138 confirmed results and 2 administrative awards — the counts the approved
prototype's progress line shows ("22 of 28 results confirmed" in Round 6, "138 of 168" for the
season).

The seed is generated by `src/lib/server/seed-data.ts`, which is fully deterministic (a seeded
PRNG plus a fixture-orientation solver) so re-running converges to identical rows. Rounds 1–5 are
generated to hit the season totals implied by the approved mockup; Round 6 reproduces the 22
results listed in `prototype/app.js` verbatim, including their actual played dates.

The fictional story behind the two awards: Ella Thompson withdrew from the league during Round 6
after playing five of her seven fixtures. Her remaining fixtures were resolved with table-points-only
awards taken from genuine Round 5 results — Jules Rivera gets the 2 points he earned against her
(2–1), and Noah Kim gets the 0 points he earned against her (0–3), so his table is unchanged and
carries no asterisk. The withdrawal → award flow itself is Phase 7.

Rounds 1–5 are closed with their unplayed fixtures in the neutral `closed_unplayed` state (2, 4, 5,
6 and 7 respectively). Round 6 is the round in play, with 22 confirmed results, 2 awards and 4
fixtures still open.

## Preview checkpoint

`/debug/seed` renders the seeded round and season tables straight from SQLite through the engine,
plus the per-round fixture states and the award ledger. It is a debug view, not part of the app.
