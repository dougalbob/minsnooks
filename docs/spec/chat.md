# Chat & direct messages — acceptance criteria (Phase 13)

**Status: ✅ confirmed by the owner on 2026-09-29 (Q5 chat criteria).** The five decisions in §10
were put to the owner in the Phase 13 session; the answers (including **no blocking** and **full
chat access for withdrawn members**) are recorded there and implemented by this phase. Any later
change to a rule in this file is an owner scope change and must be recorded here with its date.

**Authority:** PLAN.md Phase 13 (`league chat + DMs between registered players; message persistence;
block/report minimal controls; deliberately designed and tested; calm UX per HANDOFF §2`), the
HANDOFF §2 tone/accessibility baseline, and the owner decisions recorded in §10.

---

## 1. Purpose and tone

Chat is a small, calm part of a family snooker league app (HANDOFF §2): useful for arranging a
frame, congratulating a win, or saying “that fluke in frame three”. It is **not** a social network
and must never feel like Discord noise.

- One message = one short piece of text. No threads, reactions, attachments, voice notes, typing
  indicators, presence dots or read receipts in V1.
- The league channel reads like a quiet club noticeboard; DMs read like a text conversation.
- Everything is server-rendered first and enhanced progressively — the pages work with JavaScript
  disabled, and no message state lives only in the browser.
- Chat is completely separate from league state: **no chat write can touch standings, results,
  fixtures, awards, friendlies, knockouts or statistics.** Nothing in chat is a result.

## 2. Definitions

| Term | Meaning in this document |
| --- | --- |
| **Registered member** | A `players` row with `is_active = 1`. The only identities that can sign in (see `loadViewerPlayer`). |
| **Active league player** | A registered member with no `player_withdrawals` row — the same “eligible player” definition the admin round screen uses. Relevant to *league* actions, not to chat access (§10 Q5e). |
| **Withdrawn** | A registered member with a `player_withdrawals` row. Still signs in and still chats normally. |
| **League channel** | The single shared channel for everyone in the league. |
| **DM thread** | A private two-member conversation, one row per pair. |
| **Visitor** | Not signed in (`locals.viewer` is null). |

## 3. Surfaces

| Route | Audience | Contents |
| --- | --- | --- |
| `/chat` | Registered members | The league channel: message list, day separators, composer, and a visible switch to the DM list with an unread count. |
| `/chat/direct` | Registered members | DM list: threads with last-message excerpt, unread marker, and a “start a conversation” picker of the other registered members. |
| `/chat/direct/[threadId]` | Thread participants only | The conversation, author delete / report controls, composer. |
| `/chat/feed` | Registered members (thread feed: participants only) | JSON polling endpoint used by the open views. Never returns content to a visitor. |
| `/admin/chat` | Admin / super-admin | The report queue: reported message, reporter, reason, and an audited **hide** or **keep** decision with a mandatory note. |
| Bottom navigation | Registered members | A **Chat** item with a colour-independent unread badge (a number plus a screen-reader label, never colour alone). |

Unread counts are also shown on the DM list rows and exposed to assistive technology (e.g. “3 unread
messages in Chat”).

## 4. Acceptance criteria

Each item is written so a test can assert it. Identifiers are referenced by `tests/chat.test.ts` and
the route-authorization suite.

### A. League channel

- **AC-A1** A visitor sees a calm signed-out state (what chat is, and how to sign in) and **no
  message content at all** — not even a message count.
- **AC-A2** A registered member sees the league channel newest-last in strict chronological order
  (oldest → newest), grouped by league-local day (`Europe/London`) with a
  “Today / Yesterday / Tue 29 Sep 2026” separator.
- **AC-A3** A registered member can post a message of 1–2000 characters (after trimming). Empty,
  whitespace-only and over-length messages are refused with a specific, calm inline error, and the
  typed text is preserved.
- **AC-A4** Withdrawn members keep **full** chat access: they can read and post in the league
  channel, open DM threads, and be messaged (owner decision, §10 Q5e — chat is not a league action).
- **AC-A5** Message order is stable when two messages share a timestamp: ties break by message id
  ascending, so a refresh never reshuffles the conversation.
- **AC-A6** Chat never appears in, and never reads, league data. A test asserts the standings, stats,
  fixtures, friendly and knockout loaders return identical values before and after chat activity.

### B. Direct messages

- **AC-B1** Any registered member can start a DM with any other registered member. Starting a thread
  creates exactly one thread per pair — a second attempt from either side opens the existing thread
  instead of creating a duplicate (`UNIQUE (player_low_id, player_high_id)` plus canonical
  low/high ordering).
- **AC-B2** **Only the two participants can read a thread.** Any other signed-in member, and every
  visitor, gets the same not-found style response as a nonexistent thread (no existence leak). This
  is asserted per role, **including admin** (§10 Q5b).
- **AC-B3** Only the two participants can post into a thread.
- **AC-B4** A DM thread with no messages yet shows an empty state with a gentle prompt and does not
  count as unread.
- **AC-B5** The DM list shows threads newest-activity-first with the last-message excerpt, its
  author, and a colour-independent unread marker. A thread with a deleted or hidden last message
  shows the placeholder text instead of the removed body.
- **AC-B6** You cannot DM yourself, and the picker never lists you.

### C. Reports and admin moderation

- **AC-C1** Any member who can read a message can report it with a mandatory short reason. Repeated
  reports of the same message by the same reporter do not stack (one open report per reporter per
  message).
- **AC-C2** A report never deletes anything by itself and never notifies the reported member.
- **AC-C3** `/admin/chat` shows open reports oldest-first: the message text, author, reporter and
  reason, with the two audited decisions **hide message** (mandatory note) and **keep message**
  (mandatory note). Both write `audit_log` rows naming the admin.
- **AC-C4** A hidden message is rendered to everyone (author included) as a calm placeholder — “This
  message was hidden by an admin.” — with its author, time and position in the conversation intact.
  Its original text remains visible **only** in the admin report view, so the decision stays
  reviewable.
- **AC-C5** Only admins and super-admins can hide or keep messages; every other role is refused with
  no state change.
- **AC-C6** Admins gain **no general read access to DMs** (owner decision, §10 Q5b): the report view
  exposes the reported message only, and nothing lets an admin open another pair's thread.

### D. Message lifecycle and retention

- **AC-D1** Messages cannot be edited — there is no update path for `body` anywhere in the server
  code, and a test asserts a second write cannot change stored text.
- **AC-D2** An author may delete their own message (and only their own). Deletion is a soft delete
  that leaves a calm “This message was deleted.” placeholder in position, so the conversation order
  stays honest.
- **AC-D3** No message is ever auto-deleted or expired, and no scheduled job touches chat. Chat
  retention is “keep everything, minus what the author or an admin removed”.
- **AC-D4** Message bodies are stored and rendered as plain text: whitespace collapsed, line breaks
  preserved, no HTML/markdown interpretation, no link auto-linking in V1. A test posts
  `<script>alert(1)</script>` and `**bold**` and asserts they appear literally.

### E. Rate limiting and abuse basics

- **AC-E1** A member may send at most **20 messages per rolling minute** across all destinations.
  Further sends are refused with a calm message that says to try again shortly; the limit is
  enforced server-side (never in the browser only) and covered by a boundary test.
- **AC-E2** A member may start at most **5 new DM threads per rolling hour**; opening an existing
  thread does not count.
- **AC-E3** A member may file at most **5 reports per rolling hour** (AC-C1 still de-duplicates).
- **AC-E4** Rate-limit refusals create no message row and no audit noise; they are ordinary,
  expected user-facing outcomes, not logged failures.

### F. Unread state

- **AC-F1** Each member has one read cursor per destination (league channel, each DM thread), stored
  server-side, updated when they open that destination.
- **AC-F2** Unread counts exclude the member's own messages and any deleted or admin-hidden
  messages. A hidden message cannot inflate a badge.
- **AC-F3** The Chat nav badge and DM row markers update after navigation without a full reload and
  are exposed to assistive technology as text, never colour alone.

### G. Accessibility and feel (HANDOFF §2 baseline)

- **AC-G1** Chat is usable at 320 px width, keeps browser zoom, uses comfortably large touch targets
  (≥44 px), and respects `prefers-reduced-motion` — new messages appear without animation for
  reduced-motion users.
- **AC-G2** The message list is a real list with an accessible name; each message exposes author,
  league-local time and body in a sensible reading order; day separators are headings.
- **AC-G3** Composer, send, delete and report are keyboard reachable with visible focus; the report
  control has a visible label, a cancel path, and does not submit accidentally.
- **AC-G4** Every failure state (rate limit, over-length, offline, not permitted) is a plain sentence
  next to the composer — never a toast that disappears before it can be read, and never a
  colour-only cue.

### H. Live updates (calm, not chat-app frantic)

- **AC-H1** An open chat view refreshes quietly: the page re-reads the newest messages at a modest
  interval (~10 s) and when the window regains focus; manual refresh always works.
- **AC-H2** New messages append without stealing the reader's scroll position; if the reader has
  scrolled up in history, no automatic jump occurs.
- **AC-H3** Sending is optimistic-free: the message appears once the server has saved it. A failed
  send keeps the typed text and explains why.

## 5. Data model (migration `0011_chat.sql`)

Forward-only, matching the existing schema style (HANDOFF §9).

```sql
chat_channels    id, key UNIQUE ('league'), name, kind CHECK IN ('league','topic'), created_at
chat_threads     id, player_low_id < player_high_id, UNIQUE(low, high),
                 created_by_player_id, created_at
chat_messages    id, channel_id XOR thread_id (CHECK), author_player_id,
                 body (length 1..2000), created_at,
                 deleted_at, deleted_by_player_id,
                 hidden_at, hidden_by_player_id, hidden_reason
chat_read_state  player_id, scope CHECK IN ('channel','thread'), scope_id,
                 last_read_message_id, PRIMARY KEY (player_id, scope, scope_id)
chat_reports     id, message_id, reporter_player_id, reason, created_at,
                 status CHECK IN ('open','resolved'), reviewed_by_player_id,
                 reviewed_at, resolution CHECK IN ('hidden','kept'), review_note
                 + partial UNIQUE INDEX (message_id, reporter_player_id) WHERE status = 'open'
```

- `chat_messages` is append-only except for the two explicit soft-delete column groups. There is no
  edit column and no `updated_at`.
- Message bodies are never rendered as HTML; Svelte escaping plus server-side plain-text storage is
  the whole defence.
- Indexes: `(channel_id, id)` and `(thread_id, id)` for paging, `(author_player_id, created_at)` for
  rate limiting, `(status, created_at)` for the report queue.

## 6. Permissions (extends `src/lib/server/permissions.ts`)

```
Domain   Action                Allowed
──────── ───────────────────── ──────────────────────────────────────────────────────
Chat     viewLeagueChannel     registered member (visitor: no content at all)
Chat     postLeagueChannel     registered member (withdrawn members included — Q5e)
Chat     openDirectThread      registered member ↔ registered member (not self)
Chat     viewDirectThread      the two participants only, otherwise not-found
Chat     postDirectThread      the two participants only
Chat     reportMessage         anyone who can read that message
Chat     reviewReport          admin or super-admin; hide/keep require a note (audited)
```

Chat is deliberately **not** covered by any admin override that would let an admin post as another
member, read a DM they are not part of, or delete a thread. No blocking: owner decision 2026-09-29
(§10 Q5c).

## 7. Non-goals for Phase 13

Attachments, images, voice notes, video; message editing; reactions; blocking; group DMs; multiple
league channels; message search; read receipts; typing indicators; presence; email notifications and push delivery (Phase 14 adds opt-in DM-only push — see §8); websockets; chat history import from V1 (HANDOFF §8
explicitly excludes V1 chat); any chat action that touches league state.

## 8. Interfaces with other phases

- **Phase 14 (notifications/PWA):** Phase 13 added only in-app unread badges. Phase 14 (owner-confirmed 2026-09-29) adds **DM-only opt-in push** (“New direct message”,
  never the body), leaving the league channel silent so a busy channel cannot spam phones. Does not block
  Phase 13.
- **Phase 15 (admin reports):** the chat report queue lives at `/admin/chat`; the Phase 15 admin
  dashboard should link to it, and the audit-trail browser will include chat moderation rows.
- **Phase 8 security:** chat reuses the existing viewer/role resolution; no new identity path.
- **Phase 16:** no chat data is migrated from V1.

## 9. Test plan

`tests/chat.test.ts` (new) covering, on isolated databases:

1. **Authorization:** visitor sees nothing; a non-participant (player *and* admin) cannot open or
   post into a DM thread (identical result to a nonexistent thread); participants can.
2. **Persistence & ordering:** messages survive reopen; same-timestamp ordering is stable;
   channel/thread separation.
3. **Validation:** empty, whitespace-only, 1-char, 2000-char and 2001-char bodies; HTML/literal text.
4. **Lifecycle:** author delete leaves a placeholder and keeps order; another member cannot delete;
   no edit path.
5. **Reports & moderation:** one open report per reporter/message; hide/keep require an admin and a
   note; a hidden message shows the placeholder while keeping admin-visible detail; hidden messages
   are excluded from unread counts.
6. **Rate limits:** 20/minute messages, 5/hour new threads, 5/hour reports — tested at the boundary
   and one past it, asserted to leave no rows behind.
7. **Unread state:** counts exclude own/deleted/hidden messages; opening marks read; badges match.
8. **Separation invariant:** standings and stats fixtures identical before and after chat activity.

Route-level authorization (`tests/chat-routes.test.ts`, mirroring the knockout route suite): every
`/chat` and `/admin/chat` action refuses visitors, refuses non-participants where applicable, and
refuses non-admins for moderation.

`npm test`, `npm run check` and `npm run build` must pass.

## 10. Owner decisions (Q5 — confirmed 2026-09-29)

| # | Question | Owner decision |
| --- | --- | --- |
| **Q5a** | Scope of channels | **One league channel plus 1:1 DMs.** No group DMs, no per-fixture threads, no admin-created topic channels in V1; the schema keeps a `topic` kind for a later phase without a rewrite. |
| **Q5b** | Admin visibility of DMs | **Admins never read DMs they are not part of.** They see a DM message only when a player reports it, and may hide it (mandatory audited note) or keep it. |
| **Q5c** | Blocking | **No blocking at all** — owner: “I don't need any blocking, it's a family league so not really relevant.” Removed from scope: no `chat_blocks` table, no block UI, no block permission. Reporting is retained as the minimal abuse control. |
| **Q5d** | Editing and deleting | **No editing ever.** An author may delete their own message, leaving a calm “This message was deleted.” placeholder in place. |
| **Q5e** | Withdrawn members | **Full chat access.** Withdrawal is a league-table matter: a withdrawn member can still read and post in the league channel, use their DM threads, and be messaged. |

Anything not listed here is a proposed default recorded in §4; the owner reviewed those defaults with
the preview and may amend them at any time by recording the change in this section.
