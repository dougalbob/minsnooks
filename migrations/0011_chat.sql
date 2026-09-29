-- Phase 13: chat & direct messages.
--
-- Rules this schema exists to protect (docs/spec/chat.md, owner-confirmed
-- 2026-09-29 as the Q5 chat acceptance criteria):
--
--   * One league channel plus one-to-one DM threads. A message belongs to
--     exactly one destination — the CHECK below makes "a channel message that
--     is also a DM" impossible atomically. `chat_channels.kind` keeps room for
--     a future topic channel without a rewrite.
--   * Chat is completely separate from league state: nothing here is read by
--     the standings engine, the stats loaders, fixtures, awards, friendlies or
--     knockout. No chat write can move a table or create a result.
--   * A DM thread is one row per pair (canonical low/high ordering plus
--     UNIQUE), so two players can never end up with duplicate conversations.
--   * A message is append-only. There is no edit column: an author may
--     soft-delete their own message (placeholder in place, order intact) and an
--     admin may hide a reported message with a mandatory reason. Retirement is
--     never automatic — no scheduled job touches this schema.
--   * Bodies are plain text between 1 and 2000 characters, stored verbatim and
--     rendered escaped; no HTML or markdown is interpreted anywhere.
--   * Read cursors are per member and per destination, so unread badges are
--     computed server-side and never from client state.
--   * Reports are the minimal moderation control (owner decision: no blocking
--     in this family league). One open report per reporter per message.
--
-- Timestamps are ISO-8601 UTC strings (`YYYY-MM-DDTHH:MM:SS.sssZ`), matching
-- the audit log; they sort lexicographically, which the rate-limit window
-- queries rely on. Display converts to the league timezone (Europe/London).

CREATE TABLE chat_channels (
	id INTEGER PRIMARY KEY,
	key TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	kind TEXT NOT NULL DEFAULT 'league' CHECK (kind IN ('league', 'topic')),
	created_at TEXT NOT NULL
);

CREATE TABLE chat_threads (
	id INTEGER PRIMARY KEY,
	player_low_id INTEGER NOT NULL REFERENCES players(id),
	player_high_id INTEGER NOT NULL REFERENCES players(id),
	created_by_player_id INTEGER NOT NULL REFERENCES players(id),
	created_at TEXT NOT NULL,
	CHECK (player_low_id < player_high_id)
);

-- One conversation per pair, in either direction.
CREATE UNIQUE INDEX idx_chat_threads_pair ON chat_threads (player_low_id, player_high_id);

CREATE TABLE chat_messages (
	id INTEGER PRIMARY KEY,
	-- Exactly one destination: a league/topic channel or a DM thread.
	channel_id INTEGER REFERENCES chat_channels(id),
	thread_id INTEGER REFERENCES chat_threads(id),
	author_player_id INTEGER NOT NULL REFERENCES players(id),
	body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
	created_at TEXT NOT NULL,
	-- Author deletion: the row stays, the text stops being rendered.
	deleted_at TEXT,
	deleted_by_player_id INTEGER REFERENCES players(id),
	-- Admin moderation after a report: hides the text from everyone, but the
	-- original stays readable in the admin report view so the decision is
	-- reviewable. A reason is mandatory at the write path.
	hidden_at TEXT,
	hidden_by_player_id INTEGER REFERENCES players(id),
	hidden_reason TEXT,
	CHECK ((channel_id IS NULL) <> (thread_id IS NULL)),
	CHECK (deleted_at IS NULL OR deleted_by_player_id IS NOT NULL),
	CHECK (hidden_at IS NULL OR (hidden_by_player_id IS NOT NULL AND hidden_reason IS NOT NULL))
);

CREATE INDEX idx_chat_messages_channel ON chat_messages (channel_id, id);
CREATE INDEX idx_chat_messages_thread ON chat_messages (thread_id, id);
-- Rate limiting: count a member's messages inside a rolling window.
CREATE INDEX idx_chat_messages_author_time ON chat_messages (author_player_id, created_at);
-- The report queue and the "was this already reported by me?" lookup.
CREATE INDEX idx_chat_messages_hidden ON chat_messages (hidden_at, id);

CREATE TABLE chat_read_state (
	player_id INTEGER NOT NULL REFERENCES players(id),
	scope TEXT NOT NULL CHECK (scope IN ('channel', 'thread')),
	scope_id INTEGER NOT NULL,
	last_read_message_id INTEGER NOT NULL DEFAULT 0,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (player_id, scope, scope_id)
);

CREATE TABLE chat_reports (
	id INTEGER PRIMARY KEY,
	message_id INTEGER NOT NULL REFERENCES chat_messages(id),
	reporter_player_id INTEGER NOT NULL REFERENCES players(id),
	reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
	created_at TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
	reviewed_by_player_id INTEGER REFERENCES players(id),
	reviewed_at TEXT,
	resolution TEXT CHECK (resolution IS NULL OR resolution IN ('hidden', 'kept')),
	review_note TEXT,
	CHECK (
		(status = 'open' AND reviewed_by_player_id IS NULL AND reviewed_at IS NULL AND resolution IS NULL)
		OR (status = 'resolved' AND reviewed_by_player_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution IS NOT NULL)
	)
);

-- A member cannot stack open reports on the same message; resolved history is
-- still allowed to accumulate for the audit trail.
CREATE UNIQUE INDEX idx_chat_reports_open_per_reporter
	ON chat_reports (message_id, reporter_player_id)
	WHERE status = 'open';

CREATE INDEX idx_chat_reports_queue ON chat_reports (status, created_at);

-- The league channel is structural (every database has exactly one), not
-- seeded fiction, so its row ships with the migration.
INSERT INTO chat_channels (key, name, kind, created_at)
VALUES ('league', 'League chat', 'league', '2026-09-01T00:00:00.000Z');
