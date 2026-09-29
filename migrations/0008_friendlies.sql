-- Phase 10: friendlies — informal matches between registered league players.
--
-- Rules this schema exists to protect (HANDOFF §5 "Friendlies"):
--
--   * A friendly is between two registered league players only. It lives in
--     its own tables and is never read by the standings engine, the stats
--     loaders, the highlights, or knockout: separation is by construction.
--   * A friendly is either a scheduled plan with no result yet, or a saved
--     result. A scheduled entry with no result is removed five days after its
--     current scheduled date; a saved result is never auto-deleted.
--   * Frame counts are flexible and a drawn match is allowed, but a 0–0 is not
--     a result: the CHECK below rejects it atomically. Every saved result
--     carries the actual date played, never inferred from the scheduled date.
--   * There is no opponent approval and no reminder machinery: a saved result
--     is final, and either participant (or an admin override, audited) may
--     correct it.
--   * Optional per-frame point scores and highest breaks (Q3, decided
--     2026-09-29) are stored here when offered. They stay out of every league
--     statistic, exactly like the friendly itself.
--
-- Dates are league-local calendar dates (YYYY-MM-DD); an optional time is a
-- local wall-clock value ('HH:MM', 24-hour) with no timezone stored, mirroring
-- `bookings`. The league timezone already lives on the season.

CREATE TABLE friendlies (
	id INTEGER PRIMARY KEY,
	player_low_id INTEGER NOT NULL REFERENCES players(id),
	player_high_id INTEGER NOT NULL REFERENCES players(id),
	created_by_player_id INTEGER NOT NULL REFERENCES players(id),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	-- The current scheduled date. Rescheduling overwrites it, so the five-day
	-- expiry window always follows the newest date. NULL only for a friendly
	-- recorded directly as played, which was never a scheduled plan.
	scheduled_date TEXT CHECK (scheduled_date IS NULL OR scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	scheduled_time TEXT CHECK (scheduled_time IS NULL OR scheduled_time GLOB '[0-2][0-9]:[0-5][0-9]'),
	note TEXT,
	-- scheduled: a plan with no result yet (may expire). played: a saved
	-- result exists (never auto-deleted).
	status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'played')),
	CHECK (player_low_id < player_high_id)
);

CREATE TABLE friendly_results (
	id INTEGER PRIMARY KEY,
	friendly_id INTEGER NOT NULL UNIQUE REFERENCES friendlies(id) ON DELETE CASCADE,
	player_low_frames INTEGER NOT NULL CHECK (player_low_frames >= 0),
	player_high_frames INTEGER NOT NULL CHECK (player_high_frames >= 0),
	-- Required for every saved result; never inferred from `scheduled_date`.
	actual_played_date TEXT NOT NULL CHECK (actual_played_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	submitted_by_player_id INTEGER NOT NULL REFERENCES players(id),
	submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
	revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
	corrected_by_player_id INTEGER REFERENCES players(id),
	corrected_at TEXT,
	correction_reason TEXT,
	-- Flexible counts and drawn matches are allowed, but a 0–0 means no
	-- result and can never be saved.
	CHECK ((player_low_frames + player_high_frames) >= 1)
);

-- Optional per-frame snooker point scores: all played frames or none, mirroring
-- `result_frames`. Each frame's winner (the higher score) must agree with the
-- saved match totals.
CREATE TABLE friendly_result_frames (
	result_id INTEGER NOT NULL REFERENCES friendly_results(id) ON DELETE CASCADE,
	frame_number INTEGER NOT NULL CHECK (frame_number >= 1),
	player_low_points INTEGER NOT NULL CHECK (player_low_points >= 0),
	player_high_points INTEGER NOT NULL CHECK (player_high_points >= 0),
	PRIMARY KEY (result_id, frame_number)
);

-- Optional highest break per player, mirroring `result_breaks`. May be
-- recorded even when frame-point detail is omitted.
CREATE TABLE friendly_result_breaks (
	result_id INTEGER NOT NULL REFERENCES friendly_results(id) ON DELETE CASCADE,
	player_id INTEGER NOT NULL REFERENCES players(id),
	break_points INTEGER NOT NULL CHECK (break_points >= 0),
	PRIMARY KEY (result_id, player_id)
);

CREATE INDEX idx_friendlies_players ON friendlies(player_low_id, player_high_id);
CREATE INDEX idx_friendlies_scheduled ON friendlies(status, scheduled_date);
CREATE INDEX idx_friendly_results_friendly ON friendly_results(friendly_id);
CREATE INDEX idx_friendly_results_played ON friendly_results(actual_played_date);
