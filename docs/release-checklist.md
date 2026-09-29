# Release-candidate checklist

**Status:** In progress — Phase 15 implementation has started; this checklist is not signed off for release. Items marked complete are code/test evidence only, not deployment approval.

## Admin reports and settings

- [x] Admin dashboard and role-gated reports for unresolved fixtures, awaiting confirmations, current-season awards ledger, and bounded audit trail.
- [x] Settings form persists future round duration/grace, future-season timezone default, and new-member contact visibility default; each save is audited and rate-limited.
- [x] Existing round deadline/grace snapshots, season timezone/scoring, and individual profile privacy choices are not silently rewritten by defaults changes.
- [x] Season scoring/timezone are immutable once a season label is created; a change requires a new season (super-admin only).
- [x] Unit tests cover settings validation, audit, rate limiting, frozen scoring and future-only round defaults.

## Security and privacy

- [x] All SSR/API responses are private/no-store; service worker remains limited to its static offline fallback.
- [x] Production security headers include CSP, frame denial, nosniff, strict referrer policy, restricted permissions and HSTS.
- [x] Authenticated POST writes have a SQLite-backed per-identity/per-route throttle; chat retains stricter domain-specific rate limits.
- [x] Unexpected server errors are logged server-side with an incident ID and sanitized in the client response.
- [x] Admin reports/settings enforce server-side admin role gates; contact visibility defaults do not reveal existing hidden contact data.
- [ ] Review the deployed CSP against the production browser build, PWA install, Cloudflare Access, and push behaviour; adjust directives only with security review.
- [ ] Confirm Cloudflare Access issuer/audience/allowlist and HTTPS-only routing on the staging hostname; verify development identity remains unavailable in production.

## Browser journeys and deployment verification

- [x] Playwright smoke specs exist for player, opponent-review and admin read-only journeys, using an isolated fictional SQLite database.
- [x] Run all three local Playwright journeys green on the isolated fictional database (Chromium 153 via the SANDBOX §6 `@sparticuz/chromium` fallback).
- [ ] Run the same smoke suite against the exact staging image/artifact and staging hostname after its deployment.
- [ ] Real-device push delivery and PWA installation/offline behaviour verified on an Access-protected secure origin (Phase 14 carry-over).
- [ ] Confirm backup destination before deployment; implement and rehearse the Phase 16 online backup, encrypted off-machine copy and restore drill.
- [x] Owner explicitly authorized Phase 15 PR #21 and its merge to `main`; PR and post-merge CI passed.
- [ ] Owner reviews the mobile admin dashboard/reports/settings experience for UX sign-off.

## Release decision

Do not deploy or cut over while any unchecked item above remains, unless the owner records a narrow, explicit exception and the unresolved risk is documented in the runbook.
