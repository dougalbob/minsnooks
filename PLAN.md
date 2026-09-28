# Minsnooks V2 — Phased Implementation Plan

**Created:** 28 September 2026
**Status:** Active build plan (living document — updated at the end of every session).
**Authority:** This plan operationalises [`HANDOFF.md`](HANDOFF.md). Where the handoff records an owner decision, it is binding. Where the handoff records a *proposal* or open question, this plan adopts the proposal as a **provisional default** (see §5) and names the phase at which the owner should confirm it. `README.md` and the approved prototype in `prototype/` are the visual source of truth.

## 1. Goals, constraints, and how to use this plan

- **Product:** ground-up V2 of Minsnooks, a fun family snooker league app for ~8–10 players plus admins, matching the approved green-baize, table-first UX direction. V1 (`dougalbob/snooker-league`) stays live and untouched; this repo never reads or writes V1 or its database. All dev/preview data is fictional.
- **Build shape:** each phase below is scoped to fit comfortably in **one agent session** (a couple are explicitly split across two). A session reads this file, implements its phase to the exit criteria, keeps tests green, starts a **preview server**, updates §7 Status log, and commits. If a session runs long, cut scope to the exit criteria, move the remainder into the Status log for the next session — never half-land two phases.
- **Preview rule:** whenever the phase has user-visible output, the session ends with the dev server running (bound `0.0.0.0`) so the owner can click through the newest slice. Phases that are purely server-side show a minimal admin/debug page (e.g. round state, scheduler run log) rather than nothing.
- **Quality bar (cross-cutting, from HANDOFF §2):** polished, contemporary, snooker-led UX from the first slice — not a final polish pass. Accessibility baseline: zoom enabled, readable mobile text, large touch targets, contrast, visible focus, keyboard/screen-reader semantics, colour-independent status, reduced-motion support. Tests are written for domain invariants as each phase lands, per HANDOFF §9.
- **Not in scope for any phase:** porting V1 SQL/JS; copying V1 secrets; live data in previews; caching authenticated responses as PWA assets.

## 2. Technical baseline (provisional, per HANDOFF §9)

| Area | Choice | Notes |
| --- | --- | --- |
| App | **SvelteKit 2 + Svelte 5 + TypeScript**, one Node app | Owner-approved "recommended provisional direction". |
| DB | **SQLite 3** (one file), `better-sqlite3` | Owner leans SQLite. WAL + foreign keys + busy timeout. Migrations in `migrations/*.sql`, applied by a tested runner. Backups via SQLite online backup API — never naive file copy alone. |
| Deploy target | Docker on Unraid, appdata mount `snooker-league-v2` (verify at deploy) | `@sveltejs/adapter-node`. DB on persistent pool, never a network share or image layer. |
| Auth | **Cloudflare Access** in production: verify `Cf-Access-Jwt-Assertion` (issuer, audience, signature, expiry) + explicit approved-email allowlist, fail closed; roles from DB checked server-side | Dev-only identity allowed **only** when `AUTH_MODE=dev` and not production. Never infer admin from Access. |
| Tests | Vitest, starting with domain invariants + migrations + authorization | E2E smoke journeys later (staged images). |
| Timezone | **Confirmed: league timezone `Europe/London`** stored per season; all dates rendered and deadline/grace boundaries interpreted as league-local calendar dates | Owner confirmed before Phase 4; grace advances by local calendar days across DST. |

## 3. Phase overview

| # | Phase | Session | Preview checkpoint |
| --- | --- | --- | --- |
| 1 | Foundation, design system & live preview | 1 | App shell + first real standings table (provisional data) |
| 2 | Canonical schema & standings engine | 2 | Seed data in SQLite; standings computed from DB |
| 3 | League table & round views (real) | 3 | Approved round/season table fully wired |
| 4 | Round lifecycle & auto-advance | 4 | Admin: open/close round, auto-advance demo |
| 5 | Fixtures & booking journeys | 5 | Fixtures/results tabs, arrange-a-date flow |
| 6 | Result entry, review & corrections | 6 | Record → review → confirm/send-back journey |
| 7 | Withdrawals & administrative awards | 7 | Award asterisks, random-draw reveal |
| 8 | Identity, roles & permission matrix | 8 | Production Access validation + role gates |
| 9 | Stats & highlights | 9 | Stats page with real Most Improved / breaks / graph |
| 10 | Friendlies | 10 | Friendly booking/result journey |
| 11 | Knockout — core & entry | 11 | Invitation → opt-in → selection → draw |
| 12 | Knockout — progression & display | 12 | Bracket screens, byes, dropout handling |
| 13 | Chat & direct messages | 13 | In-app chat |
| 14 | Calendar, notifications & PWA | 14 | Availability calendar, push, installable app |
| 15 | Admin reports, settings & hardening | 15 | Admin dashboard |
| 16 | Migration & cutover rehearsal | 16 | Import tool + reconciliation report |

Phases 11–12 and 15–16 may each be re-split by the owner if a session feels tight. Every phase below lists **Deliverables · Tests · Preview · Exit criteria · Confirm first**.

## 4. Phase detail

### Phase 1 — Foundation, design system & live preview (session 1)
- **Deliverables:** SvelteKit+TS scaffold at repo root (approved prototype preserved in `prototype/`); Vitest; SQLite plumbing (WAL, FKs, busy timeout) + migration runner + `0001_init.sql` (players + app settings); auth skeleton with fail-closed config and dev-only identity; app shell (baize background, top bar, bottom nav, tokens, focus/reduced-motion) ported from the approved prototype; first standings component (round/season tabs, positional PTS balls, award asterisk + legend) driven by a pure, tested ranking module; provisional fictional data clearly labelled in the UI.
- **Tests:** ranking/ties/ball-colour sequence; auth fail-closed + dev-identity-blocked-in-production; migration runner applies and is idempotent.
- **Preview:** shell + standings table at `/`.
- **Exit criteria:** `npm test` green; dev server running; README updated; PLAN status log written.
- **Confirm first:** nothing (stack already the recorded recommendation).

### Phase 2 — Canonical schema & standings engine (session 2)
- **Deliverables:** `0002_league.sql` — seasons (with scoring config per season), rounds (roster snapshot, deadline + grace snapshot, status, is-final), round_players, fixtures (one per pair, unique atomically), results (actual played date kept separate from booked date; 3 frame winners; optional frame points + highest breaks), admin awards (table-points-only, source + fallback draw), corrections/audit log. Standings engine: table points → frame difference → match wins; shared positions; award asterisks; round and season views. Fictional seed: the 8 prototype players, Rounds 1–6 of 2026 (six-frame three-frame-match scoring), consistent with the approved mockup.
- **Tests:** scoring, tie positions (incl. joint first), awards not inflating frames/wins/diff, seed determinism, migration up on fresh DB.
- **Preview:** `/debug/seed` — seeded round/season tables read from SQLite.
- **Exit criteria:** engine is the single canonical standings path (HANDOFF §10) with test proof; schema documented in `docs/schema.md`.
- **Confirm first:** nothing; 2026 scoring (3 frames, 1 table point per frame, no match-win bonus) taken from HANDOFF §4 pending live-V1 verification at migration.

### Phase 3 — League table & round views (session 3)
- **Deliverables:** standings UI wired to the DB engine (round/season tabs, PTS balls by positional rank with tied players sharing treatment, plain rank numbers, frame difference, P/W columns, award asterisk + accessible legend, progress "N of M results confirmed"); round header with round/season context; avatar highlights area; accessibility and mobile polish pass against the approved prototype.
- **Tests:** route loads with seed data; table semantics (headers, captions, aria) smoke-tested.
- **Preview:** the real table — the visual milestone.
- **Exit criteria:** UI matches approved direction; no provisional arrays remain in the standings path.
- **Confirm first:** nothing.

### Phase 4 — Round lifecycle & auto-advance (session 4)
- **Deliverables:** open-round transaction (snapshot roster + create every pairing + snapshot deadline/grace); fixture states incl. neutral closed-unplayed (never 0–0, never reappears); grace/deadline enforcement; admin retrospective result for a closed fixture within deadline+grace (updates original round table, does not reopen scheduling); auto-advance only when every fixture resolved, after confirmation, server-side + idempotent; admin marks season final round; new season created only by admin; withdrawal plumbing (player excluded from future rounds, history kept).
- **Tests:** snapshot immutability under membership/settings changes; closure neutrality; auto-advance idempotency and all-resolved precondition; final-round behaviour; one-open-scheduling-round invariant.
- **Preview:** `/admin/rounds` — open, close, advance a demo league; run log shows scheduler output.
- **Exit criteria:** lifecycle rules from HANDOFF §4 implemented with tests; no client-triggered state processing.
- **Confirm first:** nothing; the owner confirmed `Europe/London` before implementation.

### Phase 5 — Fixtures & booking journeys (session 5)
- **Deliverables:** Fixtures & Results view (separate tabs) matching prototype: fixture cards, your-fixture emphasis, date status, record-result entry points; arrange/change/cancel a **proposed** date (kept separate from actual played date; mock booking-proposal screen preserved as a real flow); results archive with previous/next round navigation; friendly footnote copy from prototype.
- **Tests:** booking CRUD permissions; proposed date never treated as played date; fixture uniqueness.
- **Preview:** full fixtures journey on seed data.
- **Exit criteria:** prototype journeys clickable against real state.
- **Confirm first:** nothing.

### Phase 6 — Result entry, review & corrections (session 6)
- **Deliverables:** league result submission (exactly 3 frames; frame winners consistent with count; optional per-frame point scores + highest break per player; break ≤ best recorded frame score validation; soft "is this correct?" for extreme values — never a hard reject on plausible foul-inflated scores; optional details locked after submission); opponent review: confirm or send back for correction; after approval admin-only changes, super-admin retrospective direct entry; audit record of who/what/when (reason field per §5); confirmation-aware table updates (unconfirmed submissions do not alter standings).
- **Tests:** validation rules from HANDOFF §4; state machine (submitted → confirmed / sent-back / corrected); standings update only on confirmation; audit entries.
- **Preview:** record → review → confirm / send-back → corrected, end to end.
- **Exit criteria:** prototype result screens are real; permission matrix respected for participants vs admin.
- **Confirm first:** correction-reason mandatory? (provisional: yes for post-approval admin changes).

### Phase 7 — Withdrawals & administrative awards (session 7)
- **Deliverables:** admin marks withdrawal (current-round unplayed fixtures resolved by awards); award from a genuine previous-round league result against the same opponent (never from a prior award); table-points-only semantics; fallback one-time random 0–3 draw (equal odds, server-side, audited, reveal animation only — no client reroll); asterisk + accessible explanation on round and season tables; corrected source results flag dependent awards for review rather than silently rewriting tables.
- **Tests:** award source selection; no frames/diff/wins mutation; draw idempotency + audit; review-flag on source correction; withdrawn player can still be champion on earned points.
- **Preview:** withdrawal + award + draw reveal on the demo league.
- **Exit criteria:** HANDOFF §4 "Withdrawal and administrative points" fully implemented.
- **Confirm first:** Q2 (award source + equal odds) — provisional as proposed.

### Phase 8 — Identity, roles & permission matrix (session 8)
- **Deliverables:** production Cloudflare Access validation (JWKS, issuer/audience/signature/expiry, explicit allowlist, fail closed on missing/invalid config); dev identity hard-disabled in production; database roles (player / admin / super-admin) enforced server-side on every write path; contact-visibility profile setting (default: visible to league members) with understandable UX; consolidated permission matrix covering league, friendly, knockout, admin actions.
- **Tests:** JWT verify (valid/invalid/expired/wrong-aud); allowlist; role gates per endpoint; dev bypass impossible in production config.
- **Preview:** sign-in states + role switcher (dev) across admin screens.
- **Exit criteria:** security review checklist in `docs/security.md` signed off in-session.
- **Confirm first:** Q6 (final permission matrix) — provisional per handoff text.

### Phase 9 — Stats & highlights (session 9)
- **Deliverables:** Most Improved (average frames won per genuinely played league match across two consecutive closed rounds in-season; frozen for the whole current round; shown from Round 3 onward; labelled comparison rounds; excludes friendlies/knockouts/closures/awards); highest recorded break; best single-frame score; snooker points-per-frame graph **with explicit coverage counts**; avatars on highlights; recompute after authorised corrections with change record; release stats inventory beyond the prototype (owner-specified).
- **Tests:** Most Improved maths + freezing + labels; coverage denominators; correction recomputation; no invented winners when optional data missing.
- **Preview:** stats page backed by real data.
- **Exit criteria:** agreed stats inventory delivered (not just the prototype's sample).
- **Confirm first:** **Q1** (Most Improved ≥ half fixtures safeguard), **Q7** (complete stats/graph inventory; joint-highlight display; update timing during open rounds) — provisional: safeguard on, joint highlights share the card, highlights freeze at round open.

### Phase 10 — Friendlies (session 10)
- **Deliverables:** friendly scheduling + results between registered players only (flexible frames, draws allowed, 0–0 = no result, actual played date required); no opponent approval or reminders; either participant may correct (admin override per matrix); scheduled-with-no-result entries removed 5 days after the **latest** scheduled date; saved results never auto-deleted; friendlies excluded from all league stats/standings/highlights/knockout; optional-details fields per Q3.
- **Tests:** expiry job (idempotent); separation invariants; correction permissions; unusual-score confirm prompt.
- **Preview:** friendly journey + expiry demo.
- **Exit criteria:** HANDOFF §5 implemented.
- **Confirm first:** Q3 (optional frame points/breaks in friendlies) — provisional: yes, but excluded from league stats.

### Phase 11 — Knockout: core & entry (session 11)
- **Deliverables:** admin announcement + opt-in with reply deadline; 6–8 entrants else abandon (no extension, no smaller event); >8: random select 8 + random waiting list; consensual swap recording before first draw (no re-selection); first-stage random draw with byes (6→2 byes, 7→1, 8→0); fixed match format per competition (first to 2/3/4 frames) chosen at creation; all draws random and server-side with audit.
- **Tests:** entry/selection rules; bye assignment maths; draw randomness determinism via seeded RNG for tests; audit records.
- **Preview:** invitation → opt-ins → selection → first draw, animated reveal of the draw.
- **Exit criteria:** HANDOFF §6 entry/draw rules implemented.
- **Confirm first:** nothing (rules agreed).

### Phase 12 — Knockout: progression & display (session 12)
- **Deliverables:** players arrange matches (no fixed deadlines; nudge); result entry first-to-N stopping at target; later-stage draws made fresh only when prior stage resolved; paired-player dropout → opponent advances without result; bye-holder dropout → removed, next stage drawn afresh from remaining players (no waitlist replacement); visible auditable state; knockout display screens (prototype's six-entrant draw as the visual reference, now dynamic); knockout never touches league points/metrics.
- **Tests:** progression matrix incl. dropouts and byes; no-invented-results invariant; format enforcement.
- **Preview:** full knockout through to a final on demo data.
- **Exit criteria:** HANDOFF §6 complete.
- **Confirm first:** nothing.

### Phase 13 — Chat & direct messages (session 13)
- **Deliverables:** league chat + DMs between registered players; message persistence; block/report minimal controls; deliberately designed and tested (not bolted on); calm UX per HANDOFF §2 (no Discord-like noise).
- **Tests:** authorization on threads; persistence; rate limiting basics.
- **Preview:** chat screens.
- **Exit criteria:** detailed acceptance criteria written to `docs/spec/chat.md` and met.
- **Confirm first:** Q5 (detailed chat acceptance criteria).

### Phase 14 — Calendar, notifications & PWA (session 14)
- **Deliverables:** availability/calendar view of proposed + confirmed dates; notification events (result submitted/confirmed/sent back, date proposals, round opened/closing, knockout draws) via in-app + web push (VAPID), each event tested; PWA (installable, offline shell) that **never** caches authenticated HTML/API as public assets; graceful degradation without push permission.
- **Tests:** notification triggers per event; push subscription lifecycle; cache policy (auth'd responses uncacheable).
- **Preview:** calendar + push opt-in + installable app.
- **Exit criteria:** Q5 events agreed and delivered.
- **Confirm first:** Q5 (notification events, calendar criteria, backup cadence — backup ops land in Phase 16).

### Phase 15 — Admin reports, settings & hardening (session 15)
- **Deliverables:** admin reports (unresolved fixtures, awaiting confirmations, awards ledger, audit trail browser); settings screens (season scoring selection at season start only, deadline/grace defaults for future rounds, league timezone, contact-visibility defaults); security/privacy pass (headers, CSP, rate limits, error hygiene); staging-image smoke journey tests (player + opponent + admin) with Playwright.
- **Tests:** scoring frozen mid-season; settings apply to later rounds only; smoke journeys green.
- **Preview:** admin dashboard.
- **Exit criteria:** release-candidate checklist in `docs/release-checklist.md` complete.

### Phase 16 — Migration & cutover rehearsal (session 16)
- **Deliverables:** owner-authorized read-only V1 schema/settings inspection (never secrets); import tool for **league results only** (minimum player/season/round/result/rule metadata; `confirmed_date` never copied to actual-played; missing dates flagged, never invented); reconciliation report (counts + standings under confirmed rules); historical-table policy per Q4; repeatable export/import on isolated data; backup/restore practice (online backup API + off-machine copy); cutover runbook (result-entry pause → final export → import/check → CF routing switch → smoke → V1 retained for rollback + post-cutover reconciliation plan).
- **Tests:** import idempotency; flagged-date handling; reconciliation diffing.
- **Preview:** `/admin/migration` dry-run report.
- **Exit criteria:** owner signs off rehearsal numbers before any real cutover.
- **Confirm first:** **Q4** (historical tables policy), migration scope already decided (league results only).

## 5. Open questions register (HANDOFF §11) — provisional defaults

| # | Question | Provisional default | Confirm by |
| --- | --- | --- | --- |
| Q1 | Most Improved qualifying safeguard (≥ half eligible fixtures in each compared round) | **On** | Phase 9 |
| Q2 | Award source = genuine previous-round league result only; fallback 0–3 draw equal odds | **As proposed** | Phase 7 |
| Q3 | Friendly optional frame points / highest break; admin override | **Offer fields; exclude from league stats; admin override yes** | Phase 10 |
| Q4 | Historical tables if legacy rules unrecoverable | **Show imported results + recalculated table with legacy caveat; preserve any owner-verified historical table** | Phase 16 |
| Q5 | Timezone, backups, push events, chat/calendar criteria | **Europe/London; daily online backup + weekly off-machine; events as Phase 14 lists** | Phases 4 / 13 / 14 |
| Q6 | Correction audit reason + permission matrix | **Reason mandatory post-approval; matrix per handoff text** | Phase 6 / 8 |
| Q7 | Full stats inventory; joint highlights; update timing | **Safeguard on; joint highlights share; freeze highlights at round open (Most Improved always frozen)** | Phase 9 |

No provisional default is baked into irreversible data: each is a policy flag or display choice that can change after owner review.

## 6. Session protocol

1. **Open:** read §7 Status log and this plan; if the environment misbehaves (missing `node_modules`, dead preview link, npm build errors), check [`SANDBOX.md`](SANDBOX.md) first. Run `npm install` (node_modules is not persisted), `cp .env.example .env && npm run seed` if needed, run `npm test`, then start the dev server (`npm run dev -- --host 0.0.0.0`) so the previous session's checkpoint is visible — use the **new** preview link, never an old one.
2. **Scope:** implement exactly one phase; note any carry-over in §7 rather than stretching the session.
3. **Safety:** fictional data only; never touch V1; never commit secrets, `.env`, or database files (`.gitignore` enforces).
4. **Close:** `npm test` green → preview running → update §7 (phase status, preview path, decisions made, carry-over) → commit on the session's Arena branch **and push** (`git push origin <session-branch>`) — local commits alone are not durable across sandbox recreations (see `SANDBOX.md`).

## 7. Status log

| Date | Session | Phase | Status | Notes |
| --- | --- | --- | --- | --- |
| 2026-09-28 | 1 | Plan + Phase 1 | ✅ done (PR #2) | PLAN.md written; SvelteKit 5 + TS + Vitest + better-sqlite3 scaffold at repo root (approved prototype preserved in `prototype/`); SQLite WAL/FK + migration runner + `0001_init` (players, settings, dev seed of the 8 fictional players); auth skeleton (fail-closed config, dev identity disabled in production); app shell + standings table (round/season tabs, positional PTS balls, award asterisk + legend) via pure `rankRows` engine; `/fixtures /stats /knockout /admin` placeholders mark phase boundaries. Tests green. Preview at `/`. Carry-over to Phase 2: canonical league schema + real standings engine replacing `preview-data.ts`. |
| 2026-09-28 | 2 | Phase 2 — canonical schema & standings engine | ✅ done (PR #3) | `migrations/0002_league.sql`: seasons (per-season scoring), rounds (roster/deadline/grace snapshots, status, is-final), round_players, fixtures (one per pair, `UNIQUE` + `CHECK (low < high)` so duplicates and mirrored duplicates are impossible atomically), results (actual played date kept separate from booked date; 3 frame winners; optional frame points + highest breaks), awards (table-points-only with source + fallback draw), audit_log. `src/lib/server/standings.ts` is the single canonical standings path (SQL aggregation + `rankRows`); only confirmed results count, awards add points without frames/diff/wins. Deterministic fictional seed: 8 prototype players, Rounds 1–6 of 2026 (3 frames, 1 point per frame, no win bonus) — 168 fixtures, 138 confirmed results, 2 awards, which is exactly the approved mockup's "138 of 168". Round 6 and the season table both reproduce the prototype's numbers from the database. Preview at `/debug/seed`. 42 tests green. Schema documented in `docs/schema.md`. **Merged to `main` in PR #3** (merge commit `0cc3419`, CI green on the PR and on `main`). Carry-over to Phase 3: wire `/` to the engine and delete `preview-data.ts`. |
| 2026-09-28 | 1b | Maintenance | ✅ done | SANDBOX.md expanded with owner-supplied sibling-project notes, applicability triaged: verified `npm ci --ignore-scripts` + `svelte-kit sync` bootstrap (bundled better-sqlite3 prebuild, no compile), turn-boundary sandbox recycling + git restore recipe (push is the only durable save), network reachability map, GitHub CI-annotation & connector guidance, Playwright-via-@sparticuz/chromium recipe for Phase 15, edit-tool safety habits. `db.ts` now resolves an absolute DB path. Not applicable (documented in SANDBOX.md §9): Next.js/Turbopack-specific traps. |
| 2026-09-28 | 3 | Phase 3 — league table & round views | ✅ done | `/` now loads the latest season, open (or latest) round, both canonical standings, round roster, and progress from SQLite via `loadHomePageData`; the provisional arrays/file are removed. Round/season controls update the table and confirmed-results meter from `roundProgress`; season header context is database-backed. The table consumes engine-ranked rows, preserves shared positions/ball treatment, and now has a real caption, scoped headers, and accessible award/progress explanations. Added an avatar-led top-of-table snapshot based on the same ranked rows (no invented Phase 9 highlights), seeded and empty-state loader tests, and corrected player IDs to stay attached to rows through ranking. `npm test` (44), `npm run check`, and `npm run build` pass; live preview at `/`. Phase 3 carry-over cleared. |
| 2026-09-28 | 4 | Phase 4 — round lifecycle & auto-advance | ✅ done (PR #4) | Europe/London calendar-day deadlines/grace, neutral fixture closure, date-validated retrospective results, idempotent server timer and resolved-only auto-advance; final-round and withdrawal safeguards; `/admin/rounds` preview and scheduler log. `npm test` (53), `npm run check`, and `npm run build` pass. |
| 2026-09-28 | 5 | Phase 5 — fixtures & booking journeys | ✅ done (PR #5) | `0004_bookings.sql` adds planned dates as first-class rows (`bookings`, one active plan per fixture enforced by a partial unique index; `fixtures.booked_date` is now only a mirror). `src/lib/server/bookings.ts` implements propose / change / cancel with participant-only permission (admin override allowed and audited in `audit_log`), league-local date validation, and an "after the round window" flag; nothing in the module can create a result or move the standings. `/fixtures` is the player-facing journey: Fixtures tab (your fixtures first, planned-date status, arrange/change, record-result entry point, resolved fixtures collapsed, round deadline/grace note) and Results tab (confirmed results only, newest actual date first, previous/next round navigation, counts of awards and neutral closures). `/fixtures/[fixtureId]` shows the plan, plan history and cancel; `/fixtures/[fixtureId]/arrange` is the prototype's proposal screen as a real form; `/fixtures/[fixtureId]/record` is the Phase 6 entry point. `src/lib/server/viewer.ts` resolves the verified email (`$env/dynamic/private`) to a player row — provisional until Phase 8. Seed now writes the prototype's one arranged fixture (Leon–Owen, Sat 3 Oct 4:00 pm) through `proposeBooking`, so it is idempotent. `npm test` 72 green (14 new fixtures tests + 5 formatting), `npm run check` 0/0, `npm run build` passes. Preview at `/fixtures`. |

### Carry-over into Phase 3 — cleared 2026-09-28
- ✅ `/` now uses SQLite-backed `computeStandings` data for both the round and season views; `src/lib/preview-data.ts` has been removed.
- ✅ Round/season context, roster-led table snapshot, and confirmed-results progress come from `loadSeason` / `roundProgress` through `loadHomePageData`.
- ✅ The route data is covered by seeded and empty-state tests; table caption, column headers, and progress semantics were smoke-checked in the rendered page.

### Carry-over into Phase 4 — cleared 2026-09-28
- ✅ The owner confirmed `Europe/London`; deadline and grace boundaries use local calendar dates, including daylight-saving transitions.
- ✅ Phase 4 lifecycle rules and `/admin/rounds` preview are implemented and covered by tests.

### Carry-over into Phase 6 — open 2026-09-28
- Record-result entry points exist on the fixture cards and at `/fixtures/[fixtureId]/record`, but the form itself is Phase 6 (the screen says so). Phase 6 adds the three-frame entry, opponent review, confirm/send-back and corrections, and must confirm the result (not just submit it) before standings move.
- `fixtures.booked_date` is a mirror of the active plan only; Phase 6 must never read it as an actual date, and must keep `results.actual_played_date` the single source of truth.
- Phase 5 permissions are provisional (two participants, or an admin override, enforced server-side and audited). Phase 8 replaces them with the confirmed permission matrix and the hardened Access/role pipeline; `src/lib/server/viewer.ts` is the seam.
- A plan may be saved with `afterWindow` when it falls past deadline + grace; the UI warns. Phase 6/7 should decide whether an after-window plan influences the neutral-closure or retrospective-result flows (currently it does not).

### Carry-over rules
- Anything not meeting its phase exit criteria is listed here verbatim for the next session.
- The next session starts by clearing carry-over before new scope if it blocks the phase; otherwise it proceeds and keeps carry-over visible.
