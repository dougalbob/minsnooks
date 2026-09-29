# Minsnooks V2 — Discovery and Prototype Handoff

**Updated:** 29 September 2026 (Phase 13 chat criteria confirmed and implemented)
**Status:** Approved visual-prototype baseline; living discovery handoff. This is **not** an approved `SPEC.md`, database schema, or production implementation plan.
**Purpose:** Carry the discovery decisions and safety constraints into a fresh agent session, record what the current session prototyped and what the owner approved, and give the next agent a safe starting point for phased planning and implementation.

## 1. Start here: repository and safety

- This Arena session is attached to the **new, private V2 repository** `dougalbob/minsnooks`. It is separate from V1 and has no V1 files or history in the checkout. Continue on the session's fixed branch; do not copy V1 history into this repository.
- The owner intends to start a fresh Arena session from the merged V2 work. Read this file and review the approved prototype before making production changes.
- **Docs-freshness is a default pre-PR gate (owner standing rule, 2026-09-29):** before opening any pull request, audit `PLAN.md`, `HANDOFF.md`, `README.md`, `docs/schema.md`, `docs/security.md` and `SANDBOX.md` against the implementation and update everything the phase changed. A PR with known-stale docs is not ready for review.
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

**Chat, confirmed 2026-09-29 (Q5):** one league channel plus 1:1 direct messages; admins never read a DM they are not part of and see a reported message only (hide with a mandatory audited reason, or keep); **no blocking** — the owner's call for a family league; no editing, with an author delete that leaves a placeholder; withdrawn members keep full chat access. The full acceptance criteria are `docs/spec/chat.md` §10.

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
- The owner confirmed `Europe/London` for the initial league timezone before Phase 4. A deadline date means 23:59:59 on that date in league-local time. Grace is added as calendar days in that timezone (not fixed 24-hour blocks), including across daylight-saving transitions; neutral closure runs strictly after the resulting instant. The recorded actual played date may be no later than the final local calendar day of that deadline-plus-grace window.

### Result submission and corrections

- League result: exactly three frames are played. The submitted match frame count must agree with the three frame winners.
- At submission, a player may enter all three optional frame-by-frame snooker point scores (e.g. 47–65, 76–38, 65–29), and may enter a highest break for each player. A highest break may be entered even when frame-point detail is omitted. Players cannot add optional details later after submission.
- The opponent may confirm the complete league result/date or send it back to the submitter for correction before approval. After approval, only an admin may change it. A super-admin may directly enter or correct a retrospective result without opponent approval. Record who changed what and when; confirm whether a reason is mandatory.
- Validate non-negative whole-number values, match/frame-winner consistency, and—when frame details exist—that a player’s recorded break does not exceed their best recorded frame score. Do not impose 147 as a cap on a frame’s total points: fouls can award points to the opponent, and a 100–50 frame is plausible. Without a shot/foul log there is no exact mathematical validator for all possible final frame totals. Extreme or surprising input should prompt “is this correct?” rather than be hard-rejected.

### Withdrawal and administrative points

- An admin marks a player withdrawn. Keep the player visible in historical results/tables and retain already-earned points; the player may still win the season. They receive no new points for unplayed fixtures, and future rounds exclude them.
- For the withdrawing player’s remaining unplayed fixtures in the current round, the agreed intended behavior is: when there is a suitable previous-round result against the active opponent, award that opponent the table points they earned against this player in that previous round. This is a table-points-only award, not a played match: it adds no frames, frame difference, match win/loss, or performance metric. Mark it with an asterisk on round and season tables and explain it accessibly.
- **Phase 7 provisional policy (Q2, implemented):** prefer the latest genuine confirmed previous-round league result against the same opponent as the award source; never use an earlier administrative award or an unconfirmed/sent-back result. If an admin corrects a source result, flag dependent awards for explicit review rather than silently rewriting a later table.
- If no suitable prior result is available, the withdrawal transaction makes a one-time server-side random draw of 0–3 table points for the active opponent with equal odds; the withdrawn player receives none. Record initiator and outcome before revealing it. An animation may reveal the saved outcome, but cannot reroll it. Do not label this as a match score.

## 5. Friendlies — V2 feature, informal rules

- Friendlies remain available in V2, only between registered league players. **Do not migrate any V1 friendly history.** Friendlies remain separate from league standings, league statistics, knockout records, and league performance highlights.
- Friendly format is informal: flexible frame count and draws are allowed. A 0–0 means no result and is not saved as a played result. Require actual date played for any saved result. No opponent approval and no reminders/nagging.
- Either participant may correct a saved friendly; an admin override is permitted, audited, and requires a reason. The owner confirmed this permission as part of Q3 and the full permission matrix on 2026-09-29.
- If a scheduled friendly has no result five days after its current scheduled date, remove the empty entry even if the players rearranged offline; they can create another later. Never auto-delete a saved result. If in-app rescheduling is supported, the five-day window should follow the newest scheduled date (recommended).
- A very unusual score (e.g. 34–3 frames) can prompt for confirmation, not be rejected outright. 100–50 frame points are possible; there is no simple final-score-only formula to rule them out.
- **Decided 2026-09-29 (Q3):** friendly results offer optional per-frame point scores and highest-break fields, exactly like league results. All friendly details stay out of league standings, statistics, highlights and knockout. Admin override of participant corrections is allowed, audited, with a mandatory reason.

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

### Owner-described V1 inventory and Phase 9 direction (2026-09-29)

The owner says players enjoy stats and wants a generous, polished Stats experience rather than treating the static prototype as the complete inventory. The confirmed personal-stat items are:

- **Season overview:** played, won, lost, win rate (e.g. 39 played, 17 won, 22 lost, 44%).
- **Current-round overview:** played, won, lost.
- **Recent form:** exactly the latest five confirmed results, displayed oldest-to-newest with unmistakable, colour-independent win/loss symbols and a count.
- **League-position trend** over time.
- **Average frames won per match** trend over time.
- Both trend charts have a horizontally scrollable view of roughly four months at a time. The owner-approved definitions are: one league-position point per confirmed result or table-point award, calculated through the canonical standings engine at that event; average frames won uses a rolling eight-match window updated after each confirmed result, with the season average visible as a reference line.

Use confirmed, genuinely played league results for personal played/won/lost, win rate, recent form and performance averages. Exclude friendlies, knockouts, neutral closures, awards and unconfirmed results. League-position history must match the canonical standings engine (including table-point awards); show ties as shared positions. The approved prototype's average snooker-points-per-frame chart remains an additional graph, based only on matches with optional frame-point detail and with explicit coverage counts. Highest breaks may be entered without frame-point detail, so break and frame-score coverage must be reported separately.

### Most Improved (owner decision, 2026-09-29)

- Compare a player's **latest eight** confirmed, genuinely played league matches in the current season with their **preceding eight** such matches. The windows are consecutive, non-overlapping, contain 16 matches in total, may cross round boundaries and never cross a season boundary. Improvement is the difference between the two averages of frames won per match. Do not use awards, friendlies, knockouts, neutral closures or unconfirmed results.
- Initially unlock the feature only after every active player in the season-opening roster has 16 eligible matches. A later joiner does not delay the initial unlock; they become a candidate once they have their own 16 eligible matches. The feature remains hidden until unlocked. A player who withdraws before reaching 16 does not block the gate and is not an active candidate.
- Freeze the comparison at round open for that round; authorised corrections trigger recomputation, with the result correction retained in the audit trail. Home/round UI should be a simple avatar plus a small “Most Improved” marker, not the comparison figures. Put the window detail on Stats.

### Current-round and season records

- The home/round view shows the **current round's** highest recorded break and best recorded single-frame score, not a season record that can sit unchanged. Reveal them only after each active, non-withdrawn member of the current round roster has at least one confirmed, genuinely played result in that round; refresh as further results are confirmed. Missing optional scores are never inferred.
- Put current-season-to-date highest recorded break and best recorded frame score on the League Stats subpage. Keep optional-data coverage explicit on Stats. Tied records and Most Improved winners are displayed jointly rather than assigned by arbitrary database order.
- Organise Stats into **My Stats** and **League Stats**. Support visible, accessible navigation; swipe may be an additional mobile gesture, not the only way to discover or use the second view.

**Phase 9 decisions (owner-approved 2026-09-29):** five-result form; per-update canonical position points; rolling eight-match frames average with season average; four-month horizontal chart windows; joint tie presentation; visible accessible My Stats / League Stats navigation. The Stats page also includes reliable head-to-head and streak details. Future additional stats remain proposals until reviewed. Never invent detailed frame winners, breaks or point scores when optional data is absent.

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

Items marked resolved are retained for traceability; the others remain open before the final specification and/or implementation plan:

1. **Resolved 2026-09-29 — Most Improved:** adjacent windows of the latest eight and preceding eight confirmed, genuinely played league matches in the same season; initial unlock after the active season-opening roster has 16 each; later joiners qualify after their own 16; snapshot at round open.
2. Withdrawal award source: Phase 7 implements the provisional default (latest genuine confirmed earlier-round league result only; equal odds for a server-side 0–3 fallback). Owner confirmation is still welcome before live use; awards remain auditable and reviewable.
3. **Resolved 2026-09-29 — Friendly optional details (Q3):** offer optional frame-by-frame points/highest-break fields in friendlies, excluded from all league stats; either participant may correct, with audited admin override (reason mandatory for the override).
4. Historical tables: if earlier V1 scoring rules cannot be reconstructed, should V2 show recalculated standings with a legacy caveat, preserve a separately verified historical table, or show only imported result history?
5. **Partly resolved 2026-09-29 — chat acceptance criteria (Q5, Phase 13).** One league channel + 1:1 DMs; admins never read DMs they are not part of (a reported message is the only exception, and hiding requires a written audited reason); **no blocking** (owner: a family league does not need it); no editing — an author delete leaves a placeholder; withdrawn members keep full chat access. Recorded in `docs/spec/chat.md` §10 and implemented in Phase 13. Still open in this item: backup cadence/destination/retention and restore expectations (Phase 16), and push/in-app notification events plus detailed calendar acceptance criteria (Phase 14). Timezone was confirmed as `Europe/London` before Phase 4.
6. **Resolved 2026-09-29 — correction reasons and full permission matrix (owner confirmed).** Post-approval league corrections require an audit reason; participant friendly corrections need no reason, while an admin override requires one and is audited. The owner confirmed the existing matrix across league, friendly, knockout, admin and profile actions, based on Phases 6/8 and Q3.
7. **Resolved 2026-09-29 — Phase 9:** five-result recent form; league-position points per confirmed result/table update from canonical standings; rolling eight-match frames-won average plus season average; four-month horizontal chart view; joint highlights; visible accessible My Stats / League Stats navigation.

## 12. Recommended next-session plan

1. **Phase 13 (Chat & direct messages) is implemented on the session branch and awaits its own explicit owner approval before any PR/merge.** The owner confirmed the Q5 acceptance criteria in-session on 2026-09-29 (recorded in `docs/spec/chat.md` §10), and the implementation matches them: a league channel plus 1:1 DMs, participant-only privacy with no admin DM access, no blocking, no editing (author delete leaves a placeholder), an audited admin hide/keep on reported messages, withdrawn members keeping full chat access, server-side rate limits, unread badges, and quiet polling. `npm test` 249 green and `npm run check` 0/0; the preview is `/chat`.
2. **Phase 12 (Knockout — progression & display) is merged to `main` in PR #15.** PR head `595305b` merged at `2318cab51059d29080353597c133c4eb95be7164` with the owner's explicit approval on 2026-09-29; the CI test job was green on the PR and on the post-merge `main` push. `0010_knockout_progression.sql`, the progression write paths, the dynamic `/knockout` bracket, `/knockout/tie/[id]/record`, two progression seed previews and 14 new tests (218 green, check 0/0) cover HANDOFF §6 end-to-end: arrange + nudge with no deadlines, first-to-N stopping at the target, fresh later-stage draws only after full resolution, walkover on paired dropout, void-and-redraw on bye dropout, visible auditable state, and league isolation. Bring the dev-server preview up fresh in the next session (SANDBOX §0/§2) for UX review of `/knockout`.
3. **Every merge needs its own explicit owner approval; approval for PR #15 does not carry forward.**
4. **Phase 14 (Calendar, notifications & PWA) is the next implementation phase once Phase 13 is approved.** Its confirm-first item is the remaining part of Q5: notification events (with the Phase 13 proposal of DM-only push for chat), calendar acceptance criteria and backup cadence (Phase 16).
5. HANDOFF §6 remains the binding knockout rulebook; the Phase 12 implementation is its complete realization, including the accepted bye-holder-dropout recommendation (remove and redraw afresh; never the waiting list). Do not weaken these rules without a scope change.
6. Preserve all standing safety constraints: never connect to or modify the V1 service/database, never copy V1 secrets, and use fictional data in previews.
7. **Mandatory docs-freshness gate:** before any PR, audit `PLAN.md`, `HANDOFF.md`, `README.md`, `docs/schema.md`, `docs/security.md` and `SANDBOX.md` against the implementation and update every document changed by the phase. The six-document Phase 13 audit was completed on 2026-09-29 (chat tables and invariants in schema, chat privacy/matrix rows in security, the `/chat` checkpoint in README, the re-seed/dev-server gotcha in SANDBOX). A PR with known-stale docs is not ready for review.

> Suggested new-session instruction (Phase 13 implemented): “Read `HANDOFF.md` and `README.md` first. Phases 1–12 are merged to `main`; do not redo them. Phase 13 (Chat & direct messages) is implemented with the owner-confirmed criteria in `docs/spec/chat.md` (owner decisions 2026-09-29: one league channel + 1:1 DMs, no blocking, no editing, admins never read unrelated DMs, withdrawn members keep full chat access) — review it at `/chat` and `/admin/chat`, then get explicit owner approval before opening or merging its PR; approval for earlier PRs does not carry forward. After that, Phase 14 (calendar, notifications & PWA) starts by confirming the rest of Q5. Repeat the six-document audit before any PR.”
