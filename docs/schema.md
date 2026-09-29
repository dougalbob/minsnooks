# Canonical league schema

Phases 2–11 of [`PLAN.md`](../PLAN.md). Applied by `migrations/0002_league.sql` through
`0009_knockout_entry.sql` on top of `migrations/0001_init.sql` (players, app settings). Read [`HANDOFF.md`](../HANDOFF.md) §4, §6 and §10 for the product rules this schema
enforces.

All migrations are forward-only. Never edit an applied migration — add a new one. The runner
(`src/lib/server/migrate.ts`) records a checksum per file and refuses to re-apply a changed one.

## Why the schema looks like this

V1 derived round opponents from the current player list, checked fixture uniqueness in application
code, and overloaded the booked date as the played date (HANDOFF §10). V2 therefore stores each
round's **roster**, its **pairings**, its **deadline/grace snapshot**, and the **actual date played**
explicitly, and enforces the invariants with database constraints rather than application checks.

## Tables

### `players`
Core player identity, role and contact preferences. Migration `0007_identity_roles.sql` adds the optional `phone` column for contact details.

### `seasons`
One row per league season. Scoring is **per season** and is never edited mid-season — an admin can
change league scoring only when starting a new season.

| Column | Notes |
| --- | --- |
| `label` | unique, e.g. `2026` |
| `frames_per_match` | 3 for 2026 (three frames actually played per league match) |
| `points_per_frame` | 1 for 2026 (one table point per frame won) |
| `match_win_bonus` | 0 for 2026 (no extra points for winning the match) |
| `timezone` | league-local calendar dates, confirmed `Europe/London` (owner confirmed before Phase 4) |

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
itself landed in Phase 7).

### `fixtures`
One fixture per pair per round, created for **every** opponent pair when the round opens — booking
is optional and a fixture exists independently of any booking.

| Column | Notes |
| --- | --- |
| `player_low_id` < `player_high_id` | canonical ordering; `CHECK (player_low_id < player_high_id)` |
| `UNIQUE (round_id, player_low_id, player_high_id)` | atomic uniqueness, including against the mirrored `(b, a)` ordering |
| `state` | `unplayed`, `awaiting_confirmation`, `confirmed`, `closed_unplayed`, `awarded` |
| `booked_date` | mirror of the fixture's single **active** planned date (`bookings`, Phase 5); `NULL` when there is none. **Never** the actual date played. |

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
| `revision` | how many times the row has been written: 1 for a first submission, +1 per resubmission or correction (0005) |
| `sent_back_by_player_id` / `sent_back_at` / `send_back_reason` | a send-back is a message, not just a status (0005) |
| `corrected_by_player_id` / `corrected_at` / `correction_reason` | post-approval admin change: who, when and **why** (0005; the reason is mandatory) |
| `details_locked_at` | when the optional frame points / highest breaks became locked (0005) |

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

### `result_frame_winners` (Phase 6)
The frame-by-frame winners the submitter entered and the opponent confirmed: one row per frame
(`PRIMARY KEY (result_id, frame_number)`), each naming the player who won it.

`results.player_low_frames` / `player_high_frames` hold the **match score** and `result_frames`
holds the **optional** point detail; HANDOFF §4 makes the frame winners the primary input ("exactly
three frames are played; the submitted match frame count must agree with the three frame winners"),
so they are stored rather than inferred. Results recorded before Phase 6 — and the aggregated
fictional seed — have no rows here, and the UI then shows the match score alone instead of
inventing a frame order.

`writeResultRow()` treats the list as: absent = leave untouched, `[]` = clear.

### `bookings` (Phase 5 — planned dates)
A **plan**, never a result. Either player in the fixture may propose, change or cancel it; an admin
or super-admin may do the same as an override, recorded in `audit_log`.

| Column | Notes |
| --- | --- |
| `proposed_date` | league-local calendar date `YYYY-MM-DD` (GLOB-checked) |
| `proposed_time` | optional league-local wall-clock time `HH:MM`, 24-hour |
| `status` | `proposed` (the active plan) or `cancelled` (superseded or withdrawn) |
| `proposed_by_player_id` | who suggested the date |
| `cancelled_at` / `cancelled_by_player_id` / `cancel_reason` | who dropped the plan and why |
| `note` | optional short message for the other player |

`CREATE UNIQUE INDEX idx_bookings_one_active … WHERE status = 'proposed'` makes **at most one
active plan per fixture** a database guarantee. Changing a date supersedes the previous row
(`status = 'cancelled'`, reason "Replaced by a newer planned date") instead of overwriting it, so
the plan history stays honest; `loadBookingHistory()` reads it, `loadActiveBooking()` reads the
single active row.

Why a separate table rather than reusing `fixtures.booked_date`: the fixtures column is a
convenience mirror only (`proposeBooking` and `cancelBooking` keep it in step in the same
transaction). Keeping the real plan in `bookings` means a plan can carry a time, a proposer, a note,
a cancellation, and a history — none of which fit one nullable column.

**Nothing here can create or move a result.** Proposing a date leaves `fixtures.state` untouched
(an unplayed fixture stays outstanding) and the standings engine never reads `bookings`, so a plan
cannot move a table position. `result.actual_played_date` is the only actual date in the schema.

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
automatic award source and ignores unconfirmed submissions and earlier awards. For a withdrawal it
uses the latest genuine confirmed league result against that same opponent from an earlier round in
the same season. If none exists, the withdrawal transaction draws one integer from 0–3 using
server-side `crypto.randomInt(4)` (equal odds) and persists both `draw_value` and `table_points`.
Re-submitting a withdrawal cannot create or reroll awards. A zero-point award changes no standings
value and does not raise the points asterisk.

### `audit_log`
Append-only record of who changed what, when and why. Populated by `recordAudit()`; the admin
browser arrives in Phase 15.

Phase 6 makes it the result history: `entity_type = 'result'` rows carry the action
(`submitted`, `resubmitted`, `confirmed`, `sent_back`, `corrected`, `direct_entry`,
`retrospective_recorded`, `award_review_needed`), the actor, the mandatory reason where one
applies, and a JSON `detail` snapshot (before/after frame scores, played date, warnings, and
source-linked award IDs). Phase 7 appends `withdrawn_from_future_rounds` for a player, `created` for
each award, and `award_reviewed` for the admin's explicit keep-or-apply decision. Award review state
is derived from the append-only audit log: a newer unresolved `award_review_needed` entry appears
in `/admin/awards`; it is never cleared by silently changing an award. The index
`idx_audit_award_review_queue` serves this lookup. One result's own history is read oldest-first
(`loadResultAudit`, index `idx_audit_result_history`); the league-wide feed is newest-first
(`loadResultActivity`).

## Withdrawals and award review (Phase 7)

`withdrawPlayerAndResolveFixtures()` in `src/lib/server/withdrawals-awards.ts` is the Phase 7
transaction. It applies the provisional admin permission through the existing `resultPermissions()`
seam; records the actor/reason through `recordAudit()`; keeps the player in all saved round snapshots;
sets the current snapshot's `withdrawn` flag; and excludes them from future rounds through
`player_withdrawals`. For each still-unplayed fixture involving them in the active round, it creates
one award for the other player and changes the fixture to `awarded`. A submitted result awaiting
confirmation is not treated as unplayed and is left to the existing review journey. Historical
points remain untouched, so a withdrawn player can still win the season on points already earned.

For each such fixture, the recipient's points are copied from their genuine confirmed result against
the withdrawing player in the latest earlier round of the same season. A prior award, a sent-back
submission, or an unconfirmed result is never a source. Without a suitable result, the server makes
one equal-odds draw from 0–3 with `crypto.randomInt(4)`, then persists the value and audit entry
before the route returns it for the reveal animation. Refreshing or repeating the withdrawal cannot
reroll it. The animation is presentation only; it does not call a randomizer. Awards add only table
points: no result row, frames, frame difference, match win/loss, or performance metrics. The existing
round and season standings use the canonical award aggregation and explain non-zero points with an
asterisk and accessible legend; zero-point awards remain visible in the ledger but do not change the
table or add an asterisk.

When Phase 6 corrects a source result, the `award_review_needed` audit row names each dependent
award. `/admin/awards` derives a pending-review queue by comparing each award's latest flag with its
latest `award_reviewed` entry. An admin must explicitly either apply the corrected source's new
frame count to the award or retain the old value, with a required reason. The award's original source
link remains intact, and no later table is silently rewritten. Every choice is itself audited.

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

## The result journey (Phase 6)

`src/lib/server/results.ts` is the only write path the app journeys use (`saveLeagueResult` in
`league.ts` remains the low-level primitive for the seed and the lifecycle rules). It layers the
permission matrix, the review state machine and the audit trail on top of the *same* validation the
browser runs live (`src/lib/result-entry.ts`), so what a player sees while typing is what the
server decides.

### State machine

```
  no result ──submit (player)──▶ submitted ──confirm (opponent)──▶ confirmed
                                     │                                 │
                                     │ send back (opponent)            │ correct (admin,
                                     ▼                                 │  reason mandatory)
                                 sent_back ──resubmit (submitter)──▶ submitted
                                                                       ▼
                                                              confirmed, revision + 1
```

- **submitted** — the fixture reads *awaiting confirmation*. The result is in **no** table.
- **sent_back** — the fixture is outstanding again (*unplayed*), carrying who sent it back and what
  they asked the submitter to check. Still in no table.
- **confirmed** — the only state the standings engine counts. Confirmation approves the scoreline
  **and** the actual date played together, never one without the other.
- **corrected** — stays `confirmed`; the original confirmation is preserved (the opponent approved
  the earlier version), the correcting admin and the mandatory reason are recorded, and `revision`
  rises. If an administrative award takes its value from the result, the change is flagged
  (`award_review_needed`) rather than silently rewriting a later table.
- **direct entry** (super-admin only) skips the opponent and lands `confirmed` with
  `entry_source = 'admin_direct'`; a **retrospective** result for a neutrally closed fixture lands
  `confirmed` with `entry_source = 'admin_retrospective'`, only for a match genuinely played inside
  the round's deadline + grace window. Both demand a reason.

### Permissions (consolidated in Phase 8)

`resultPermissions(db, fixtureId, viewerPlayerId)` derives the matrix from the database — role,
fixture state, result status — and every write path re-checks it inside its own transaction, so a
button is never offered for something the server would refuse. Each refusal carries a reason string
the UI displays: the screens say *why*, not just *no*.

| Action | Participant | Opponent (not the submitter) | Admin | Super-admin |
| --- | --- | --- | --- | --- |
| Submit a new result | ✅ while unplayed | ✅ while unplayed | ✅ audited override | ✅ |
| Resubmit after a send-back | ✅ submitter only | ❌ | ✅ | ✅ |
| Confirm / send back | ❌ never own submission | ✅ | ✅ override, audited | ✅ |
| Correct after approval | ❌ | ❌ | ✅ reason mandatory | ✅ |
| Direct entry (no approval) | ❌ | ❌ | ❌ | ✅ reason mandatory |
| Retrospective on a closed fixture | ❌ | ❌ | ✅ reason mandatory | ✅ |

Nobody confirms their own submission — including an admin who submitted one.

### Validation

`assessResultForm` → `validateLeagueResult` enforce: the frame winners sum to the season's
`frames_per_match`; no drawn match and no drawn frame; frame points agree with the selected frame
winners (all frames or none); a break never exceeds that player's best recorded frame score; the
played date is present, not in the future, and inside the round window (`assertPlayedDateAllowed`).

Surprising values are a **question, never a rejection**: a frame over 120 points, a century break,
or a break above 147 raise an "is this correct?" acknowledgement (`ResultNeedsConfirmationError`)
— fouls can inflate a frame — and the write proceeds once acknowledged. Optional frame points and
highest breaks lock at first submission (`checkDetailsLock`): a player correction may fix what was
submitted but may not add a category; only an admin change, with a reason, may.

A planned date is never read as a played date: the entry form bounds the date input with the round
window and today, and only mentions the active booking as a reminder.

### Routes

| Route | Purpose |
| --- | --- |
| `/fixtures/[fixtureId]/record` | The entry form: three frame winners, live scoreline, optional frame points and highest breaks, actual date played. Serves a first submission, a correction after a send-back (prefilled, details locked), and admin direct/retrospective entry |
| `/fixtures/[fixtureId]/review` | The opponent's decision: confirm the scoreline and the actual date together, or send it back with a note |
| `/fixtures/[fixtureId]/correct` | Admin correction of a confirmed result: prefilled form, mandatory reason, before/after in the audit trail |
| `/admin/results` | Result queue — every unconfirmed result (an admin sees the league, a participant only what waits on them) plus the league-wide audit feed |
| `/fixtures/[fixtureId]` | Fixture detail: plan, result summary, result history, and the call-to-action the viewer is allowed to take |

In development (`AUTH_MODE=dev`, never production) a preview identity switch (`?as=`, stored in the
`minsnooks_dev_viewer` cookie) lets one browser walk both halves of the journey. It can only select
a player who already exists; roles still come from the database and every write path still checks
them server-side. Phase 8 replaced the seam (`src/lib/server/viewer.ts`).

## Stats and highlights (Phase 9)

Phase 9 adds no schema migration: `loadStatsPageData()` in
`src/lib/server/stats-page.ts` reads the existing league tables, and the pure
calculations live in `src/lib/stats.ts`. `loadHomeStatsHighlights()` supplies
only the small round spotlight. `/stats` presents **My Stats** and **League
Stats**; the bottom navigation also links there.

All player performance summaries use only `results.status = 'confirmed'` for
the latest season. Friendlies and knockouts have separate data paths; awards,
neutral closures and pending results never become played / won / lost,
head-to-head, form, streak or frames-won stats. Optional history is not
reconstructed from aggregate frame winners:

- The position graph has one point per confirmed result and one per
  table-point award. Each point calls `computeStandings()` for the historical
  event instant, with a stable result/award ID tie-break for same-instant
  updates. Awards affect the canonical table position, not match performance.
- The frames-won graph is an eight-confirmed-match rolling average, updated at
  each result, with the season average shown as a dashed reference. Both main
  charts expose an approximately four-month horizontal viewport.
- Average points per frame are computed only from existing `result_frames`,
  grouped by round. Personal coverage counts eligible matches with optional
  point detail; league frame coverage counts results with frame detail. Break
  coverage is separate and counts player-match break entries against the two
  player slots per confirmed match. Empty details stay empty.
- Highest recorded breaks are read only from `result_breaks`; best single-frame
  scores are read only from `result_frames`. Equal records retain all joint
  holders. Home round records stay hidden until every active, non-withdrawn
  roster member has a confirmed result in that round.

**Most Improved** compares the player's latest eight matches with the preceding
eight within one season. The active season-opening roster controls the initial
16-match gate; a later joiner is eligible only after their own 16, while a
player who withdraws before reaching 16 no longer blocks the gate. The eligible
match snapshot is cut at `rounds.opened_at`, so a late retrospective result does
not silently alter an open round. An authorised correction keeps the original
confirmation instant and audit entry but its revised score is re-read, so the
comparison recalculates for that round. Joint winners share the highlight.

The personal view also derives head-to-head frame / W–L rows, the current
outcome run and best winning streak from confirmed match scores. See
`tests/stats.test.ts` for seeded loader, same-timestamp history, optional-detail
coverage, current-round reveal gating, Most Improved freeze and correction
coverage.

## Friendlies (Phase 10)

Phase 10 adds `migrations/0008_friendlies.sql`: `friendlies` (the plan: pair,
creator, scheduled date/time, note, `scheduled`/`played` status),
`friendly_results` (one per friendly: flexible frame totals, required actual
played date, revision + correction trail), `friendly_result_frames` (optional
per-frame points, all played frames or none) and `friendly_result_breaks`
(optional highest break per player, allowed without frame detail). Q3 was
decided 2026-09-29: friendlies offer the same optional detail fields as league
results, and admins may override participant corrections (audited).

The write paths live in `src/lib/server/friendlies.ts`; the shared pure rules
live in `src/lib/friendly-entry.ts` so the browser validates live with the
server's own logic:

- **Registered players only, distinct pairs.** Both sides must be active player
  rows; nobody can play themselves.
- **Flexible counts, draws allowed, 0–0 never saved.** Both the validator and a
  database `CHECK ((low + high) >= 1)` reject a 0–0; a 2–2 is an ordinary
  result. Optional point detail must cover every played frame (or be left
  blank), contain no drawn frame, and agree with the match totals; breaks
  follow the league rule (never above the player's best recorded frame score
  when detail exists).
- **Actual date required, never inferred.** Every saved result carries an
  explicit actual played date, never defaulted from the scheduled date and
  never in the future. There is no round window for friendlies.
- **No opponent approval.** Recording is final the moment it is written; there
  is no submitted/confirmed state machine and no reminders.
- **Either participant may correct; admin override is audited.** A participant
  correction needs no reason; an admin correcting someone else's friendly must
  give one (mirroring league post-approval corrections). There is no
  optional-details lock: with no opponent-approved version to protect, a
  correction may change anything, and the before/after audit snapshot keeps it
  honest.
- **Expiry is server-side and idempotent.** `expireStaleFriendlies()` removes a
  scheduled entry with no result once it is more than five league-local
  calendar days past its *current* scheduled date, so rescheduling moves the
  window. The `NOT EXISTS (friendly_results)` guard means a saved result is
  never auto-deleted. Only the scheduler (`runRoundLifecycle`, every minute
  plus the admin “run scheduler” action with its demo clock) calls it — a page
  load never expires anything — and re-running changes nothing.
- **Unusual scores prompt, never reject.** A 34–3 tally, a huge margin, a
  century or an extreme frame raises an “is this correct?” acknowledgement
  (`FriendlyNeedsConfirmationError`) and saves once confirmed.
- **Separation by construction.** The standings engine, the stats loaders, the
  highlights and knockout never read these tables; `tests/friendlies.test.ts`
  asserts league snapshots are byte-identical before and after loud friendly
  activity.

| Route | Purpose |
| --- | --- |
| `/friendlies` | Scheduled plans (with per-entry expiry dates) and recent results |
| `/friendlies/schedule` | Arrange a plan with another registered player |
| `/friendlies/record` | Record against a plan (`?friendly=`) or directly (`?opponent=`) |
| `/friendlies/[id]` | Plan/result detail, history, reschedule and withdraw |
| `/friendlies/[id]/correct` | Correction form (prefilled; reason mandatory for admin overrides) |

## Knockout entry and opening draw (Phase 11)

`migrations/0009_knockout_entry.sql` adds six tables. They are deliberately separate from league
fixtures, results, standings and statistics:

- `knockout_competitions` stores the announcement, immutable reply deadline, fixed `frames_to_win`
  (2, 3 or 4), creator and state (`inviting`, `abandoned`, `selected`, `drawn`).
- `knockout_responses` stores each active player's latest yes/no reply. Replies can change only while
  the invitation is open and before the saved deadline.
- `knockout_entries` stores the original randomized selection order plus current `selected` or
  `waiting` status. After the deadline, fewer than six opt-ins changes the competition to
  `abandoned`; six to eight select everyone; more than eight randomly select eight and keep the
  remaining randomized order as a waiting list. Selection is server-side and audited.
- `knockout_swaps` records a selected-player/waiting-list exchange, the admin actor, time, optional
  note and explicit consent attestation. A swap is allowed only before the first stage exists; it
  changes current membership without rerunning selection or rewriting the original random order.
- `knockout_stages` records who initiated each saved draw. `knockout_ties` stores canonical player
  pairs as `match` rows and each randomly assigned bye as a `bye` row. The first stage draws fresh
  pairings from the selected field: six entrants produce two ties and two byes, seven produce three
  ties and one bye, and eight produce four ties with no bye. Phase 12 adds results and progression;
  Phase 11 does not create league or knockout match results.

`src/lib/server/knockout.ts` uses Node's cryptographic `randomInt` for selection and draw shuffles;
only tests inject a seeded range source. Each announcement, reply change, abandonment, selection,
swap and first draw writes an `audit_log` snapshot. Competition format and saved outcomes cannot be
rerolled from the page.

| Route | Purpose |
| --- | --- |
| `/knockout` | Announce an invitation, opt in/out before the deadline, close/select after it, record consensual swaps, and save/view the opening ties and byes |

## Fictional seed

`npm run seed` inserts the eight prototype players and season 2026: six rounds, 168 fixtures
(6 × C(8,2)), 138 confirmed results and 2 administrative awards — the counts the approved
prototype's progress line shows ("22 of 28 results confirmed" in Round 6, "138 of 168" for the
season).

The seed is generated by `src/lib/server/seed-data.ts`, which is fully deterministic (a seeded
PRNG plus a fixture-orientation solver) so re-running converges to identical rows. Rounds 1–5 are
generated to hit the season totals implied by the approved mockup; Round 6 reproduces the 22
results listed in `prototype/app.js` verbatim, including their actual played dates.

`seedFriendlies()` adds three fictional friendlies through the same write paths the app uses (so
the rows and audit entries always agree): a Leon–Priya plan for Sun 4 Oct 2026, a played Jules–Owen
3–2 with full point detail and breaks, and a played Maya–Noah 2–2 draw. Re-running the seed leaves
them untouched.

`seedKnockoutPreviews()` adds two fictional Phase 11 cards: one open invitation for trying player
opt-in, and one past-deadline six-player practice entry ready for admin selection and the first draw.
Both are idempotent and live only in the separate knockout tables.

The fictional story behind the two awards: Ella Thompson withdrew from the league during Round 6
after playing five of her seven fixtures. Her remaining fixtures were resolved with table-points-only
awards taken from genuine Round 5 results — Jules Rivera gets the 2 points he earned against her
(2–1), and Noah Kim gets the 0 points he earned against her (0–3), so his table is unchanged and
carries no asterisk. The withdrawal → award flow itself is Phase 7.

Rounds 1–5 are closed with their unplayed fixtures in the neutral `closed_unplayed` state (2, 4, 5,
6 and 7 respectively). Round 6 is the round in play, with 22 confirmed results, 2 awards and 4
fixtures still open.

## Planned dates in the seed

`src/lib/server/seed-data.ts` can attach `bookings` to a round, and `seedLeague()` writes them
through `proposeBooking()` — the same validated path the app uses — so the row, the fixture mirror
and the audit entry always agree. Round 6 seeds exactly the plan the approved prototype shows:

> Leon Park vs Owen Brooks — Saturday, 3 October · 4:00 pm (proposed by Owen Brooks)

The other open Round 6 fixtures deliberately have no date so the arrange-a-date flow can be tried
against real state. Re-running `npm run seed` leaves an identical active proposal untouched.

## Fixtures & results UI (Phase 5)

| Route | Purpose |
| --- | --- |
| `/fixtures` | Fixtures tab: outstanding fixtures first (yours emphasised), planned-date status, arrange/change, record-result entry point; resolved fixtures in a collapsible list |
| `/fixtures?tab=results&round=N` | Results archive: confirmed results only, newest actual date first, previous/next round navigation |
| `/fixtures/[fixtureId]` | Fixture detail: planned date + plan history + cancel, actual result (or the neutral-closure / award explanation), playable window |
| `/fixtures/[fixtureId]/arrange` | The prototype's booking screen as a real form: planned date, time, note, and a warning when the plan falls outside the round window |
| `/fixtures/[fixtureId]/record` | Result entry — the real form arrived in Phase 6 (see *The result journey* above) |

Copy that carries the rule everywhere: *a planned date is a promise between two players, not proof a
match was played; the actual date played is entered with the result and confirmed by the opponent.*

## Preview checkpoint

`/debug/seed` renders the seeded round and season tables straight from SQLite through the engine,
plus the per-round fixture states and the award ledger. It is a debug view, not part of the app.
`/fixtures` is the player-facing Phase 5 checkpoint; `/friendlies` is the Phase 10 checkpoint
(scheduled plans with expiry dates, saved results, and the record/correct journeys); `/knockout` is
the Phase 11 entry and first-draw checkpoint.
