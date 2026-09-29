# Security Architecture & Authorization

The consolidated security baseline was established in Phase 8 and extended for Phase 11 knockout entry.
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
| Edit own profile & contact visibility | ❌ | ✅ | ✅ | ✅ |
| View hidden contact details | ❌ | ❌ | ✅ | ✅ |

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
`src/lib/server/results.ts`, `src/lib/server/friendlies.ts`, `src/lib/server/knockout.ts`
and the corresponding SvelteKit server actions. The `/knockout` response action always targets the
authenticated active player; the Phase 8 permission helper also supports an admin override for a
specified target, but Phase 11 exposes no on-behalf response form.

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
Knockout        recordKnockoutMatch     Phase 12 scope (participant or Admin/Super-admin)
Profile         updateProfile           Self only (playerId == viewer.playerId) or Super-admin
Profile         viewContactDetails      Self, Admin, or League Member (if contact_visible == 1)
```

---

## 7. Security Review Checklist (Phase 8 baseline; Phase 11 coverage added)

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
- [x] **Audit logging:** All administrative actions and profile updates record the authenticated actor in `audit_log`.
- [x] **Automated test suite:** Comprehensive unit and integration tests covering JWT verification, role gates, dev bypass prevention, permission matrix, knockout entry/draw invariants and route gates (153 at Phase 8 sign-off; 189 after Phase 10; 204 after Phase 11).

**Owner confirmation:** HANDOFF §11 item 6 was explicitly closed by the owner on 2026-09-29, confirming the correction-reason rules and full permission matrix based on Phases 6/8 and Q3. Preserve these rules unless the owner approves a later scope change.
