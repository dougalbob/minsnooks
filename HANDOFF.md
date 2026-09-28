# Minsnooks V2 — Discovery and Prototype Handoff

**Updated:** 28 September 2026
**Status:** Approved visual-prototype baseline; living discovery handoff. This is **not** an approved `SPEC.md`, database schema, or production implementation plan.
**Purpose:** Carry the discovery decisions and safety constraints into a fresh agent session, record what the current session prototyped and what the owner approved, and give the next agent a safe starting point for phased planning and implementation.

## 1. Start here: repository and safety

- This Arena session is attached to the **new, private V2 repository** `dougalbob/minsnooks`. It is separate from V1 and has no V1 files or history in the checkout. Continue on the session's fixed branch; do not copy V1 history into this repository.
- The owner intends to start a fresh Arena session from the merged V2 work. Read this file and review the approved prototype before making production changes.
- Keep V1 `dougalbob/snooker-league`, its live service, and its live database running and untouched throughout V2 development. V1 is a read-only feature reference only. This repository does not provide access to the live V1 installation or database.
- No live Unraid server or live database has been accessed. Use fictional users, matches, dates, scores, and other content in every mockup, preview, and test.
- V1 has tracked secret material, including deployment configuration. **Do not copy or echo secrets, `.env` files, credentials, database dumps, or real player data.** Treat tracked credentials as exposed and coordinate any V1 credential rotation separately.
- Never let V2 write to the V1 database. Use a separate V2 app, hostname, host mount and database.

## 2. Owner’s UX and product tone — cross-cutting priority

The experience must feel like a **polished, contemporary, unmistakably snooker-led leisure app**, with the “wow” appeal of a fresh product rather than a refreshed version of V1. UX quality is a product requirement throughout design, implementation, and release—not a final polish pass.

The owner describes Minsnooks as a fun, leisure-focused family league: *“let’s enjoy and have fun.”* Cheeky, purposeful animations are welcome when they make scores, progress, or a draw more satisfying. Avoid frantic GIFs, constant movement, or an overwhelming Discord-like feel. Keep game information calm and easy to scan; respect reduced-motion preferences.

### Approved visual direction

- The owner’s current preferred reference is **`UXdirection1.jpg`**. The owner said they liked the prototype “a lot” and approved the direction as a baseline. The other uploaded explorations (`UX_oldboysclub.jpg` and `UXdirection2.jpg`) remain secondary inspiration, not alternate requirements.
- Preserve the reference’s rich, unmistakably snooker-green/baize feel, glowing jade greens, clear round/season context, compact but legible standings, and purposeful snooker-ball accents. Do not drift toward a mostly ivory/cream editorial-card design or heavy bronze/wood framing.
- Keep position numbers plain and easy to scan. Put compact glossy ball-like badges behind **table-points values**, coloured by positional rank in the snooker sequence: 1st black, 2nd pink, 3rd blue, 4th brown, 5th green, 6th yellow, 7th red, later positions neutral. Tied players share the same positional treatment. Colours are visual accents only; they do not change the score or indicate an awarded snooker-ball value. Maintain accessible number contrast and do not rely on colour alone.
- Show the award asterisk and a clear legend. Avatar-led highlights should feel friendly and celebratory without taking attention away from the table.
- The images are visual references only. Do not copy their invented names, results, dates, statistics, or defects. The source visuals contain illustrative/generated content; use the fictional data in the prototype or new internally consistent fictional data.
- The JPG attachments came through the previous Arena chat and are not stored in this repository. The prototype is the durable visual record; the owner may re-upload `UXdirection1.jpg` in the fresh session if the agent needs to compare directly against the source image.

### Prototype completed and owner-approved so far

The repository contains a **static, lightly interactive visual prototype**, not the V2 application:

- Mobile-first Round 6 / 2026 standings, with Round/Season switching, neutral ranks, positional PTS balls, frame difference, matches played/wins, an explained administrative-award asterisk, and avatar highlights.
- A **Fixtures & results** view with separate Fixtures and Results tabs. Fixtures show six remaining pairings, date-arranging and record-result paths; the Results tab lists the 22 fictional Round 6 results and has previous/next round navigation. Round 5 currently has a small, explicitly fictional sample rather than a complete historical archive.
- A mock booking date-proposal screen, clearly distinct from the actual played date.
- A league result-entry and opponent-review path: actual date played, three frame winners, optional frame-by-frame point scores/highest breaks, review, confirm, and send-back-for-correction screens. Interaction is simulated in the browser only.
- An illustrative Stats screen with a six-round points-per-frame graph, explicit coverage, and frozen highlights. **The owner has explicitly noted that the real release will need more stats; this page is representative only, not a complete stats inventory or approved stats specification.**
- A fixed fictional six-entrant knockout draw example showing two opening ties, two byes, first-to-three format, and fresh later-round draws. It is not a randomizer.

All names, dates, results, graphs, and draw content are fictional. No screen connects to a backend, authenticates a player, saves data, sends a message, or changes the standings. The current preview can be run as a static site; see `README.md`.

### Accessibility baseline

Keep browser zoom enabled; use readable mobile text and comfortably large touch targets; ensure contrast, visible keyboard focus, keyboard/screen-reader semantics, colour-independent status, and reduced-motion support. Do not copy V1’s tiny fixed navigation or disabled zoom.

## 3. Product goal and feature inventory

**Agreed:** Build a ground-up V2 for approximately 8–10 family league players plus admins. Keep V1 in service during development. Cloudflare Access remains the sign-in gate. Preserve the broad useful feature set: round and season tables; match fixtures, invitations and rearrangements; results; player stats/history; availability/calendar; chat/direct messages; notifications/push; avatars; admin/super-admin controls; knockout display; PWA; admin reports/settings. Confirm detailed acceptance criteria for secondary features in the specification rather than silently omitting them.

The round table was the first design/review milestone and its current visual direction is approved. The next agent should use the approved static prototype as a UX reference while planning production phases; do not mistake a mock interaction for completed business logic.

## 4. League rules — agreed

### Season, rounds, roster, and standings

- A season usually spans much of a calendar year, but its end is flexible. It contains sequential one-leg round-robin rounds. At discovery the league was in Round 6 of 2026, with roughly another two or three rounds expected; confirm the exact live state during a safe migration rehearsal.
- Each round has one fixture against every other player included in that round. Participation is fixed when the round opens: a new player joins from the next round, not halfway through a generated round. A withdrawn player is omitted from future rounds, while their history and earned points remain.
- **Accepted recommendation:** when a round opens, save its participant roster, create one pairing/fixture for every opponent pair even when neither player books a date, and snapshot that round’s deadline and grace period. Later membership or settings changes must not silently change an existing round. Apply new deadline settings to later rounds only. This protects historical fixtures and makes duplicate prevention enforceable.
- Only one league round is open for scheduling at a time. Do not open a new round while the current one has unresolved fixtures, apart from the defined closure and confirmation handling below.
- The admin explicitly marks the active round as the season’s final round. Once this final round is resolved, do not auto-open another round or start a season on 1 January; wait for an admin to create the next season. If not marked final, the next round may open automatically after the current round is safely resolved.
- An opened round’s ranking is ordered by **table points, frame difference, then match wins**. Players still tied share the same position. Joint first-place players are joint champions; no mandatory playoff. A withdrawn player can still become season champion on points already earned.

### 2026 scoring and future scoring

- Preserve the live 2026 season’s existing V1 league-scoring rules for all remaining 2026 rounds. The owner expects to select the same scoring options shown in V1 for those rounds. The current understanding is three frames actually played per league match, one table point per frame won, and no extra match-win points; verify actual live V1 settings during the owner-approved migration process rather than trusting repository defaults.
- Mirror useful V1 league-scoring options, but save selected rules **per season**. An admin can change league scoring only when starting a new season; no mid-season recalculation. A correction or rules change must not silently rewrite completed old seasons.
- Knockout match format is chosen per knockout competition and is separate from league scoring.

### Fixture resolution, deadlines, and auto-advance

- Booking is optional for recording a league result. The fixture exists independently of a booking; its card should clearly offer arranging/changing a date or recording a match already played. Enforce one league fixture per pair per round.
- Save planned/booked date separately from actual date played. Every newly saved result, including friendlies, needs an actual date played. A league opponent confirms the submitted result **and its actual date** together. Never infer the actual date from a stale booking.
- Each round has a deadline and a configurable grace period, captured when the round opens. Warn players that uncompleted fixtures will close after grace. For ordinary unplayed fixtures, closure is neutral: neither player is blamed or awarded points, and no played 0–0 is created. Retain a closed fixture state so it cannot reappear as outstanding or masquerade as a result.
- An admin may retrospectively record a genuine result for a closed fixture only if it was played within the allowed deadline-plus-grace period. Require the actual played date, update the original round/season table, and do not reopen general scheduling or treat the result as part of the newer round.
- A result submitted before closure but still awaiting opponent confirmation is not unplayed. Do not auto-close it. It remains unresolved for auto-advance until confirmed or handled by an admin.
- Auto-advance is allowed only after every fixture is resolved (confirmed/directly entered result, appropriate withdrawal award, or neutral closure after grace). It occurs after confirmation, not just submission. It must be server-side and idempotent; opening the dashboard must not be responsible for processing league state.
- Exact local timezone/date-boundary conventions remain to be documented before implementation.

### Result submission and corrections

- League result: exactly three frames are played. The submitted match frame count must agree with the three frame winners.
- At submission, a player may enter all three optional frame-by-frame snooker point scores (e.g. 47–65, 76–38, 65–29), and may enter a highest break for each player. A highest break may be entered even when frame-point detail is omitted. Players cannot add optional details later after submission.
- The opponent may confirm the complete league result/date or send it back to the submitter for correction before approval. After approval, only an admin may change it. A super-admin may directly enter or correct a retrospective result without opponent approval. Record who changed what and when; confirm whether a reason is mandatory.
- Validate non-negative whole-number values, match/frame-winner consistency, and—when frame details exist—that a player’s recorded break does not exceed their best recorded frame score. Do not impose 147 as a cap on a frame’s total points: fouls can award points to the opponent, and a 100–50 frame is plausible. Without a shot/foul log there is no exact mathematical validator for all possible final frame totals. Extreme or surprising input should prompt “is this correct?” rather than be hard-rejected.

### Withdrawal and administrative points

- An admin marks a player withdrawn. Keep the player visible in historical results/tables and retain already-earned points; the player may still win the season. They receive no new points for unplayed fixtures, and future rounds exclude them.
- For the withdrawing player’s remaining unplayed fixtures in the current round, the agreed intended behavior is: when there is a suitable previous-round result against the active opponent, award that opponent the table points they earned against this player in that previous round. This is a table-points-only award, not a played match: it adds no frames, frame difference, match win/loss, or performance metric. Mark it with an asterisk on round and season tables and explain it accessibly.
- **Still proposed:** prefer a genuine previous-round league result as the source, not a prior administrative award. If an admin corrects a source result, flag dependent awards for review instead of silently rewriting a later table.
- If no prior result is available, an admin can initiate a one-time random draw of 0–3 table points for the active opponent (equal odds proposed); the withdrawn player receives none. Record initiator and outcome server-side. An animation may reveal the saved outcome, but no client reroll. Do not label this as a match score.

## 5. Friendlies — V2 feature, informal rules

- Friendlies remain available in V2, only between registered league players. **Do not migrate any V1 friendly history.** Friendlies remain separate from league standings, league statistics, knockout records, and league performance highlights.
- Friendly format is informal: flexible frame count and draws are allowed. A 0–0 means no result and is not saved as a played result. Require actual date played for any saved result. No opponent approval and no reminders/nagging.
- Either participant may correct a saved friendly. Admin override is expected to be possible for support but should be included in the final permission matrix.
- If a scheduled friendly has no result five days after its current scheduled date, remove the empty entry even if the players rearranged offline; they can create another later. Never auto-delete a saved result. If in-app rescheduling is supported, the five-day window should follow the newest scheduled date (recommended).
- A very unusual score (e.g. 34–3 frames) can prompt for confirmation, not be rejected outright. 100–50 frame points are possible; there is no simple final-score-only formula to rule them out.
- **Open:** confirm whether optional per-frame point scores and highest-break fields are also offered for friendly results. Keep any such details out of league stats.

## 6. Optional concurrent knockout — agreed core rules

- Knockout is separate from the year-long round robin and season title. Only already-active league players can enter; no additional Cloudflare identities.
- An admin announces an in-app invitation and reply deadline. Six to eight entrants are required. If fewer than six respond by the deadline, abandon the attempt and try again later; do not extend the deadline or run a smaller event.
- If more than eight opt in, randomly select eight and create a randomly ordered waiting list. Before the first fixture draw, an admin may record a consensual selected-player/waiting-list swap; do not rerun the selection.
- The admin initiates the random first-stage draw. With six entrants, two randomly assigned opening byes leave four semifinalists; with seven, one bye; with eight, none. Draw fresh random pairings at every later stage, rather than pre-seeding a full bracket.
- Each competition fixes its match length before it begins: first to 2, 3, or 4 frames (best of 3, 5, or 7), stopping once a player reaches the target. Keep the same format through the final.
- No fixed stage deadlines. Players arrange matches and may nudge one another. Later-stage draws/progression wait until the prior stage is resolved; do not invent a played result to unblock it.
- If a paired player drops out after the draw, their opponent advances without a played result. **Accepted recommendation for a bye-holder dropout:** after the first draw, do not replace the player from the waiting list; remove them and draw/byes afresh from remaining players at the next stage. Keep this state visible and auditable.
- Knockout results never add league points or league-performance metrics.
- The current prototype’s six-player draw is a fixed example only. It does not opt players in, randomize, persist a draw, or progress a tournament.

## 7. Player stats and highlights

- Retain stats and useful graphs players already like, while correcting league/friendly/knockout eligibility. **The current Stats page is only a visual sample; the owner expects additional release stats. Do not treat it as a complete inventory.** First identify and confirm the useful V1 stats/graphs with the owner using safe read-only inspection or owner-provided descriptions.
- Graph average **snooker points scored per frame** over time only for matches with optional frame-point detail. Explicitly show coverage (e.g. 12 of 20 eligible league matches). Highest break may be recorded even when point details are absent.
- Most Improved compares each player’s average frames won per genuinely played league match in **two consecutive closed rounds within the same season**. Example: 1.2 to 1.8 = +0.6 frames per match. Exclude friendlies, knockouts, neutral closures, and awards.
- The award is frozen for an entire current round to avoid it changing as that round progresses. With no historical data, first show it when Round 3 opens, based on Round 1 → Round 2; keep it for Round 3. At Round 4, compare Round 2 → Round 3, and so on. Label the comparison rounds so the current round is not implied to be part of the calculation. Put the winner’s avatar and improvement figure on the round view.
- Similar round highlights can show the highest recorded break and highest recorded score in a single frame, using avatars; never invent a winner if optional data was not entered. State optional-data coverage. Recompute after authorised corrections with an appropriate change record.
- **Open:** the suggested qualifying safeguard of completing at least half of eligible fixtures in each compared round was not explicitly confirmed. Joint-highlight display and whether high-break/high-frame highlights update during an open round or only after closure also need a final decision.

## 8. Migration and cutover

- Develop V2 in its own private repository, with separate host mount, hostname, and app. Use fictional data in Arena previews. Never let V2 write to the V1 database.
- **Owner’s migration decision:** import historical **league results only**. Do not migrate past friendlies, knockout data, pending bookings/invitations, or other in-flight scheduling; the owner will tell players to re-book in V2. Do not migrate V1 chat history. Create/map only the minimum player, season, round, result, and rule metadata needed to display league history; confirm account/profile migration separately before any import.
- V1 `confirmed_date` is a scheduled/confirmed date and is not reliable proof of actual play. Do not silently copy it into V2’s actual-played-date field. Flag missing/unverified historical actual dates; do not invent dates.
- The V1 repository schema/migrations do not fully describe the live schema. Inspect the actual schema and scoring settings read-only when the owner authorizes migration. The visible V1 scoring settings are global/current rather than versioned per season; verify what can be reconstructed for historical seasons. Do not silently recalculate official historical tables with today’s settings.
- Rehearse a repeatable export/import on safely isolated data. Reconcile counts and standings under confirmed rules. At cutover, announce a short V1 result-entry pause, take a consistent final export/backup, import/check V2, switch Cloudflare routing, smoke-test, and retain V1 for rollback. After V2 accepts writes, rollback requires a reconciliation plan.

## 9. Technical direction — recommendation, not final specification

- Current V1 is Go/PostgreSQL with a large vanilla-JavaScript PWA and Docker on Unraid. Do not port its SQL or business logic as the V2 foundation.
- **Owner leans toward SQLite 3** for easier backups and container maintainability on Unraid. Recommended provisional direction: one SvelteKit + TypeScript Node application, one SQLite database file on a local persistent Unraid pool/appdata mount, one application instance. The owner plans a separate V2 appdata location (name suggested: `snooker-league-v2`); verify the exact mount/filesystem before deployment.
- Enable foreign keys and WAL with a suitable busy timeout; use tested migrations, SQLite’s online backup mechanism or equivalent consistent backup, off-machine copies, and a practiced restore. Do not use a network share or ephemeral image layer for the database, or naive copying of a live SQLite file as the sole backup.
- Chat and push remain possible, but define and test them deliberately. Do not cache authenticated HTML/API responses as public PWA assets.
- Cloudflare Access protects production and the separate V2 test hostname. V2 should validate `Cf-Access-Jwt-Assertion` cryptographically (issuer, audience, signature, expiry) and enforce an explicit approved-email allowlist. Fail closed on missing/invalid production configuration. Use database roles checked server-side; never infer admin status from Access success. A development identity/bypass must never work in production.
- Default contact visibility for this family league may be visible to league members, per owner; provide a profile setting for a player to hide contact details. Final UX should make that option understandable and easy to find.
- V2 should start with tests for scoring, season snapshots, dates, closure/auto-advance, withdrawals/awards, tie positions, corrections, knockout progression, SQLite migrations, and authorization, followed by mobile player/opponent/admin journeys and staged-image smoke tests. V1 has no automated test suite or CI visible in the inspected checkout.

## 10. V1 inspection findings — reference only, not requirements to copy

These were read-only findings from the earlier V1 discovery; they are not evidence that this V2 checkout can access the live server/database:

- V1 synthesizes round opponents from the current `is_player` list rather than storing a round-specific roster and fixtures. A member change can therefore alter the apparent historical fixture set. Some fixture lookups also do not exclude friendly matches. V2 should store each round’s roster and pairings explicitly.
- League fixtures are currently created through booking-oriented match flows; the duplicate check is application-level rather than a robust database uniqueness guarantee. V2 should create fixtures independently from bookings and prevent duplicate pairings atomically.
- Standings, dashboard, stats, and end-round calculations do not consistently use the same scoring or eligibility rules. Some calculations include friendly results; a submitted winner may affect standings before the opponent confirms it; dashboard/end-round logic contains fixed two-points-per-win assumptions. V2 needs one canonical eligibility/scoring path.
- V1 overloads the booked/confirmed match date and does not collect an independent actual played date. V2 must keep the two separate.
- V1 closure is derived from a global duration/grace setting and is initiated by dashboard loading; it can close awaiting-confirmation matches as completed 0–0. V2 must use the defined state transitions, snapshots, and server-side scheduler.
- Existing knockout code has draw/bracket display but does not provide the new opt-in/waitlist and full winner-progression flow. Treat knockout as a new end-to-end feature.
- V1’s current interface uses a basic green/brown treatment, emoji navigation, a very crowded fixed bottom bar, compact tables, and a viewport setting that disables zoom. Use it for feature inventory only; do not reuse its look or accessibility limitations.
- V1 Access middleware can auto-create a player from a valid Access email and lacks the proposed explicit allowlist/issuer enforcement. User endpoints also expose contact/role fields to authenticated league users; V2 must use explicit identity, role, and contact-visibility rules.
- V1 contains tracked secret material. Do not copy it, quote it, or use it in the V2 environment. Coordinate rotation separately.

## 11. Remaining discovery questions

These remain open before the final specification and/or implementation plan:

1. Most Improved qualifying threshold: confirm or reject the proposed minimum of half of eligible fixtures completed in each compared round.
2. Withdrawal award source: confirm that only a genuine previous-round league result—not a previous administrative award—can supply the automatic award value; confirm equal odds for the fallback 0–3 draw.
3. Friendly optional details: confirm whether to offer optional frame-by-frame points/highest-break fields in V2 friendlies; confirm admin override in addition to either participant’s correction permission.
4. Historical tables: if earlier V1 scoring rules cannot be reconstructed, should V2 show recalculated standings with a legacy caveat, preserve a separately verified historical table, or show only imported result history?
5. Confirm date/timezone conventions, backup cadence/destination/retention and restore expectations, push/in-app notification events, and detailed chat/calendar acceptance criteria.
6. Confirm result-correction audit reason requirements and exact permission matrix, including friendly admin overrides.
7. Confirm complete player-stat/graph inventory from V1 and the open Most Improved/high-break/high-frame qualification/display decisions above.

## 12. Recommended next-session plan

1. Read this handoff, `README.md`, and the current prototype. Treat the visual direction and first set of screens as approved; the Stats page is explicitly incomplete as a release feature inventory.
2. Keep the next work in **design/discovery and phased delivery**. Agree the production journeys and acceptance criteria (including the full stats inventory and open questions); write/approve the specification and implementation plan before treating any static prototype code as production architecture.
3. Plan an incremental build with early automated tests around the domain invariants and authorization. Proposed phases: foundation/auth/schema/migrations; seasons/round snapshots/fixtures/standings; booking/result/confirmation/corrections/deadlines; stats/history; knockout; then chat, calendar, notifications, PWA, admin and migration/cutover work according to the agreed scope.
4. Preserve the V1 service/database throughout development. Use only fictional data in the new session until an owner-authorized, isolated migration rehearsal.

> Suggested new-session instruction: “Read `HANDOFF.md` and `README.md` first. The current round-table and fixtures/result/stats/knockout screens are visual-only and use fictional data. The owner approved the UXdirection1-inspired green, table-first direction, but the release stats inventory is incomplete. Do not connect to or modify V1. Start by reviewing the mockup and proposing a specification and phased implementation plan, resolve the listed open decisions with the owner, then build the actual V2 incrementally with tests. Never reuse mock data as real league data or mistake mock interactions for implemented logic.”
