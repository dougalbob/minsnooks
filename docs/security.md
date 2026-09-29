# Security Architecture & Authorization

The consolidated security baseline was established in Phase 8 and extended for Phase 11 knockout entry, Phase 12 knockout progression and Phase 13 chat & direct messages.
Read [`HANDOFF.md`](../HANDOFF.md) §§6, 9 and 10 for the product rules and safety boundaries.

---

## 1. Threat Model & Boundaries

Minsnooks V2 is a self-hosted family snooker league web application. In production, it runs as a
single Node instance behind **Cloudflare Access**.

### Trust Boundaries
1. **The Client (Browser):** Completely untrusted. Form inputs, headers, cookies, and local state
   can be crafted or manipulated by an attacker.
2. **Cloudflare Access:** The authentication reverse proxy. Cloudflare Access verifies operator
   credentials and issues a cryptographically signed assertion token in the
   `Cf-Access-Jwt-Assertion` HTTP header.
3. **Application Server (Node/SvelteKit):** Cryptographically verifies the Access JWT assertion.
   It never trusts unverified headers or client claims.
4. **Database (SQLite with WAL & FKs):** Roles (`player`, `admin`, `super_admin`) and contact
   visibility flags are stored solely within the database and queried server-side. Access success
   grants an identity (email), **never** a role.

---

## 2. Cloudflare Access Cryptographic Validation

In production (`AUTH_MODE=access`), every incoming request is evaluated in `src/hooks.server.ts`
via `src/lib/server/auth.ts`:

- **Token Source:** `request.headers.get('cf-access-jwt-assertion')`.
- **Key Set (JWKS):** Cloudflare public certificates are fetched from
  `https://<teamDomain>/cdn-cgi/access/certs` and cached per team domain.
- **Verification (`jose.jwtVerify`):**
  - **Signature:** RS256 validated against the published key set matching the token's `kid`.
  - **Issuer:** Must strictly equal `https://${config.teamDomain}`.
  - **Audience:** Must strictly equal the configured `CF_AUD` application tag.
  - **Temporal validity:** Expiry (`exp`) and not-before (`nbf`) claims are enforced.
- **Explicit Email Allowlist:**
  - `ACCESS_EMAIL_ALLOWLIST` is mandatory for `AUTH_MODE=access`.
  - The JWT's `email` claim is extracted, normalized (lowercased and trimmed), and must be
    present in the explicit allowlist.
- **Fail Closed:**
  - If `AUTH_MODE` is missing or invalid: throws `AuthConfigError` (refusing to boot/authenticate).
  - If `CF_TEAM_DOMAIN`, `CF_AUD`, or `ACCESS_EMAIL_ALLOWLIST` are missing: throws `AuthConfigError`.
  - If the token is missing, expired, unsigned, signed by an untrusted key, has mismatched issuer/audience,
    or contains an unapproved email: returns `null` (unauthenticated visitor).

---

## 3. Development Identity & Bypass Prevention

Development mode (`AUTH_MODE=dev`) allows local testing with fictional players:

- **Hard-disabled in production:**
  `loadAuthConfig` checks `NODE_ENV === 'production' || process.env.NODE_ENV === 'production'`.
  If `AUTH_MODE=dev` is configured in a production environment, `loadAuthConfig` throws a fatal
  `AuthConfigError` immediately.
- **Preview Identity Chooser (`?as=` / `minsnooks_dev_viewer` cookie):**
  - Works **only** when `AUTH_MODE=dev` and `NODE_ENV !== 'production'`.
  - In production or when `AUTH_MODE=access`, `devIdentitySwitchAllowed()` returns `false`, query
    parameters and cookies are discarded, and any leftover dev cookie is cleared.
  - The preview switcher can only select an active player that already exists in the database;
    it cannot invent an identity or elevate database roles.

---

## 4. Database Roles & Server-Side Enforcement

User privileges come strictly from `players.role` (`'player'`, `'admin'`, `'super_admin'`).

### Role Capabilities
| Capability | Visitor | Player | Admin | Super-admin |
| --- | :---: | :---: | :---: | :---: |
| View standings, fixtures, results & stats | ✅ | ✅ | ✅ | ✅ |
| Propose / cancel booking for own fixture | ❌ | ✅ | ✅ | ✅ |
| Propose / cancel booking as override | ❌ | ❌ | ✅ | ✅ |
| View member availability / agreed dates | ❌ | ✅ | ✅ | ✅ |
| View pending fixture plan | ❌ | ✅ (participant) | ✅ (participant only) | ✅ (participant only) |
| Mark own availability | ❌ | ✅ | ✅ | ✅ |
| Accept fixture proposal | ❌ | ✅ (other participant) | ✅ (other participant only) | ✅ (other participant only) |
| Read own notifications / manage own push device | ❌ | ✅ | ✅ | ✅ |
| Submit own unplayed league result | ❌ | ✅ | ✅ | ✅ |
| Confirm / send back opponent's result | ❌ | ✅ (opponent) | ✅ (override) | ✅ (override) |
| Confirm own submitted result | ❌ | ❌ | ❌ | ❌ |
| Correct confirmed result (audited) | ❌ | ❌ | ✅ | ✅ |
| Enter result directly without opponent approval | ❌ | ❌ | ❌ | ✅ |
| Enter retrospective result for closed fixture | ❌ | ❌ | ✅ | ✅ |
| Manage round lifecycle & run scheduler | ❌ | ❌ | ✅ | ✅ |
| Withdraw player & generate awards | ❌ | ❌ | ✅ | ✅ |
| Review source-corrected awards | ❌ | ❌ | ✅ | ✅ |
| Create season & configure scoring rules | ❌ | ❌ | ❌ | ✅ |
| View knockout invitations and saved draws | ✅ | ✅ | ✅ | ✅ |
| Opt into a knockout as self (active player, before deadline) | ❌ | ✅ | ✅ | ✅ |
| Announce/close entry, record consensual swaps, save first draw | ❌ | ❌ | ✅ | ✅ |
| Record own knockout result, arrange own tie, nudge opponent | ❌ | ✅ (participant) | ✅ | ✅ |
| Knockout dropouts, later-stage draws, result corrections | ❌ | ❌ | ✅ (correction reason mandatory when overriding a participant's result) | ✅ |
| Edit own profile & contact visibility | ❌ | ✅ | ✅ | ✅ |
| View hidden contact details | ❌ | ❌ | ✅ | ✅ |
| Read / post in the league chat channel | ❌ | ✅ | ✅ | ✅ |
| Read / post in a DM thread | ❌ | ✅ (participants only) | ✅ (participants only) | ✅ (participants only) |
| Report a message they can read | ❌ | ✅ | ✅ | ✅ |
| Hide / keep a reported message (reason mandatory, audited) | ❌ | ❌ | ✅ | ✅ |
| Read a DM thread they are not part of | ❌ | ❌ | ❌ (never — owner decision Q5b) | ❌ (never — owner decision Q5b) |

### Server-Side Enforcement on Every Write Path
Every form action and API endpoint executes server-side role validation before inspecting or mutating state:
- If a regular player or unauthenticated visitor submits an administrative action (`openRound`, `markFinal`,
  `runScheduler`, `withdrawPlayer`, `createSeason`, `reviewAward`), the endpoint immediately halts and returns
  `fail(403, { message: '...' })`.
- If an admin attempts super-admin-only operations (e.g. `createSeason`), it halts and returns `fail(403)`.
- If a player attempts to confirm their own submitted result, `resultPermissions` rejects the operation with 403.
- All operations log the authenticated `actor_player_id` to the `audit_log` table.

---

## 5. Contact Visibility & Privacy Model

In this family league, players coordinate match dates:
- **Default:** `contact_visible = 1` (visible to authenticated league members).
- **Player Privacy Setting:** Any player can toggle `contact_visible` to `0` from their profile page (`/profile`).
- **Data Filtering:**
  - An authenticated player can always see their own email and phone number.
  - Administrators can see contact details (flagged as `adminViewOnly`) so they can coordinate matches.
  - Fellow league members can view contact details only if `contact_visible = 1`. If `0`, email and phone
    are returned as `null` by `filterContactDetails`.
  - Unauthenticated visitors never receive email or phone data.

---

## 6. Consolidated Permission Matrix

The authorization rules are implemented in `src/lib/server/permissions.ts`,
`src/lib/server/results.ts`, `src/lib/server/friendlies.ts`, `src/lib/server/knockout.ts`,
`src/lib/server/knockout-progression.ts`, `src/lib/server/chat.ts` and the corresponding SvelteKit
server actions. The
`/knockout` response action always targets the authenticated active player; the Phase 8 permission
helper also supports an admin override for a specified target, but Phase 11 exposes no on-behalf
response form. Phase 12 reuses the same helpers: participants may act on their own ties, and the
admin override paths (corrections with a reason, dropouts, later-stage draws) are audited.

```
Domain          Action                  Allowed Roles / Rules
────────────────────────────────────────────────────────────────────────────────
League          proposeBooking          playerLow, playerHigh, or Admin/Super-admin
League          cancelBooking           Proposer, playerLow, playerHigh, or Admin/Super-admin
League          submitResult            playerLow or playerHigh (fixture unplayed, round open)
League          confirmResult           Reviewing opponent only (Admin override permitted; submitter self-confirm FORBIDDEN)
League          sendBackResult          Reviewing opponent only (Admin override permitted)
League          resubmitResult          Original submitter or Admin/Super-admin (status: sent_back)
League          correctResult           Admin or Super-admin (status: confirmed; reason mandatory)
League          directEntry             Super-admin only (bypasses opponent approval)
League          retrospectiveEntry      Admin or Super-admin (fixture state: closed_unplayed)
Admin           runScheduler            Admin or Super-admin
Admin           openRound               Admin or Super-admin
Admin           markFinal               Admin or Super-admin
Admin           withdrawPlayer          Admin or Super-admin (generates audited awards)
Admin           reviewAward             Admin or Super-admin (apply_source or keep)
Admin           createSeason            Super-admin only (frozen mid-season; season start only)
Admin           viewAdminQueue          Admin or Super-admin (all fixtures); Players see only self
Friendlies      scheduleFriendly        Any registered active player
Friendlies      recordFriendly          Either participant or Admin/Super-admin (reason optional)
Friendlies      correctFriendly         Either participant (no reason) or Admin/Super-admin override (reason mandatory)
Friendlies      rescheduleFriendly      Either participant or Admin/Super-admin; unsaved plan only
Friendlies      cancelFriendly          Either participant or Admin/Super-admin; unsaved plan only; saved results never removed
Knockout        announceCompetition    Admin or Super-admin; format/deadline fixed at creation
Knockout        optInKnockout           Self (active player; before deadline); admin target override helper is not exposed in Phase 11 UI
Knockout        finaliseEntry           Admin or Super-admin; only after deadline; <6 abandoned
Knockout        recordConsentedSwap     Admin or Super-admin; both-player consent; before first draw
Knockout        drawOpeningStage       Admin or Super-admin; server-randomized and saved once
Knockout        recordKnockoutResult    Either tie participant or Admin/Super-admin; first-to-N
                                        enforced server-side; played date bounded by today
Knockout        correctKnockoutResult   Participant (no reason) or Admin/Super-admin override
                                        (reason mandatory); latest stage only; frozen once the
                                        competition completes or a later stage is drawn
Knockout        recordKnockoutDropout   Admin or Super-admin; reason mandatory; unresolved match
                                        -> audited walkover, live bye -> void; waiting list never used
Knockout        drawKnockoutNextStage   Admin or Super-admin; only when every tie in the latest
                                        stage is resolved and at least two live players remain
Knockout        arrangeKnockoutTie      Either tie participant or Admin/Super-admin; one active
                                        plan per tie (new plan supersedes, never stacks)
Knockout        nudgeKnockoutOpponent   Either tie participant; one nudge per sender and tie
                                        per 24 hours
Profile         updateProfile           Self only (playerId == viewer.playerId) or Super-admin
Profile         viewContactDetails      Self, Admin, or League Member (if contact_visible == 1)
Chat            viewLeagueChannel       Any registered member (visitor: no content at all)
Chat            postLeagueChannel       Any registered member (withdrawn members included — Q5e)
Chat            openDirectThread        Registered member to registered member (not self)
Chat            viewDirectThread        The two participants only; everyone else gets not-found
Chat            postDirectThread        The two participants only
Chat            reportMessage           Anyone who can read that message; reason mandatory
Calendar         setAvailability         Self only; no member can mark another member's day
Bookings         acceptBooking           Other fixture participant only, even for admins
Notifications    read/subscribe/remove   Self only; no endpoint ownership transfer
Chat            reviewReport           Admin or Super-admin; hide/keep note mandatory and audited
```

---

## Phase 14 notification and offline privacy

`/calendar` denies visitors all availability and plans. Pending fixture proposals and histories, friendly schedules and knockout arrangements are limited to participants; agreed league dates are member-visible. Availability is self-editable, visible to signed-in members and contains no notes. Acceptance cannot be performed by the proposer or an unrelated admin.

In-app events are scoped by recipient, and their title/href never contains a DM body. Device opt-in is per browser; subscription writes require authenticated identity and same-origin requests, and push endpoints are limited to known browser providers (prevent server-side requests to arbitrary URLs). VAPID keys stay in deployment environment variables, never in Git. Failed push does not block match writes. The service worker caches only a non-personal offline fallback; all SvelteKit responses carry `Cache-Control: private, no-store` so authenticated HTML/API cannot be stored as a public PWA asset. An installed device may continue receiving generic alerts until it opts out or its push endpoint expires; members should disable push on shared devices.

## 7. Security Review Checklist (Phase 8 baseline; Phase 11/12 coverage added)

- [x] **Cloudflare Access validation:** Cryptographic RS256 signature verification against Cloudflare remote JWKS.
- [x] **Issuer & Audience verification:** Tokens are checked against `https://${CF_TEAM_DOMAIN}` and `CF_AUD`.
- [x] **Temporal claims:** Token expiration (`exp`) and not-before (`nbf`) verified.
- [x] **Email Allowlist:** Explicit `ACCESS_EMAIL_ALLOWLIST` required and enforced fail-closed.
- [x] **Dev bypass prevention:** `AUTH_MODE=dev` throws fatal configuration error when `NODE_ENV=production`.
- [x] **Preview switcher disabled in production:** `devIdentitySwitchAllowed()` strictly fails closed in production.
- [x] **Database roles:** Stored in SQLite (`players.role`) and checked server-side; never inferred from identity provider.
- [x] **Endpoint role gates:** All administrative write paths return HTTP 403 when invoked by non-admins.
- [x] **Self-confirmation forbidden:** Submitter cannot confirm their own result submission.
- [x] **Contact visibility setting:** Players can hide contact details via `/profile`; data is masked for regular members.
- [x] **Audit logging:** All administrative actions, chat moderation decisions and profile updates record the authenticated actor in `audit_log`.
- [x] **Chat privacy:** Direct messages are readable only by their two participants — the same not-found answer for every other role, admins included. Admins see a DM message only when it is reported, and hiding one requires a written, audited reason. There is no blocking (owner decision 2026-09-29) and no edit path; an author's own delete is a soft delete that leaves a placeholder.
- [x] **Automated test suite:** Comprehensive unit and integration tests covering JWT verification, role gates, dev bypass prevention, permission matrix, knockout entry/draw/progression invariants and route gates (153 at Phase 8 sign-off; 189 after Phase 10; 204 after Phase 11; 218 after Phase 12; 249 after Phase 13).

**Owner confirmation:** HANDOFF §11 item 6 was explicitly closed by the owner on 2026-09-29, confirming the correction-reason rules and full permission matrix based on Phases 6/8 and Q3. Preserve these rules unless the owner approves a later scope change.


## 7. Phase 15 hardening and administrative access

The `/admin` dashboard, `/admin/reports` and `/admin/settings` are server-gated through `canViewAdminDashboard()` / `canManageRounds()` using the database role, never a client flag. Non-admin requests receive HTTP 403 before report data is queried or rendered. Reports are read-only; result/award moderation stays on its existing separately permission-checked routes. The audit viewer is newest-first and bounded to 100 rows; fixture reports are bounded to 250 rows.

`/admin/settings` is restricted to admins. Every successful settings change is transactional and creates an `app_settings/updated` audit row with actor and a JSON snapshot. The same actor is limited to ten changes per minute. Inputs are bounded and timezone names are validated by `Intl.DateTimeFormat`. The settings are defaults only: opened rounds preserve deadline/grace snapshots; a created season keeps its scoring and timezone; hidden contact choices for existing members are never rewritten. `createSeason()` now refuses changed scoring/timezone for an existing season label, even if reached outside the route.

### Response headers and error hygiene

`src/lib/server/security.ts` applies `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, strict-origin referrer policy, a restrictive Permissions Policy and same-origin resource policy to every response. Production responses additionally receive HSTS and a CSP that restricts default sources, objects, base, forms, framing, images, fonts, workers and manifests. The current `script-src` and `style-src` include `'unsafe-inline'` to preserve SvelteKit hydration/component styling; this is a documented CSP limitation to review against the actual production build before release, not a strict nonce-based CSP. HSTS assumes production is reached only through HTTPS.

The `handleError` hook emits server-side diagnostics with a random incident ID and returns a generic message for server failures; stack traces, SQLite details and auth verification internals are not sent to the client. Authenticated POST requests use `request_rate_limits`, an atomic SQLite-backed fixed-window throttle of 30 requests per identity email and route per minute. It does not trust client-supplied forwarding headers. Chat's lower message/thread/report limits remain independently enforced. SvelteKit's origin/CSRF validation for form actions remains enabled; the application does not implement cross-origin write APIs.

`tests/admin-settings.test.ts` covers CSP/security response headers, per-route write limits, settings audit/ranges, future-only snapshots and season scoring immutability. The Playwright smoke suite lives under `e2e/`, builds a fresh isolated fictional database, and does not confirm or otherwise mutate its pending result. All three journeys passed locally using the documented `@sparticuz/chromium` fallback after the official CDN failed. Standard environments should run `npm run test:e2e` after `npx playwright install chromium`; CI now installs Chromium and runs this suite. Exact staging-image/hostname execution remains outstanding. See [`release-checklist.md`](release-checklist.md) for production and staging gates.
