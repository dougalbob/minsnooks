-- Phase 12: knockout progression — match results, later-stage draws, dropouts,
-- arrangements (planned dates), nudges and competition completion.
--
-- Knockout stays a separate competition: none of these rows feed league
-- fixtures, results, standings or statistics, and the separation is asserted
-- in tests. Two schema notes:
--
--   * The existing tables are extended with ADD COLUMN rather than rebuilt:
--     foreign keys are enforced during migrations, so a parent-table rebuild
--     would take the whole knockout family with it. Completion is therefore
--     carried by nullable `completed_at` / `winner_player_id` columns and the
--     entry lifecycle status keeps its original CHECK values.
--   * A walkover is **not** a played result: it resolves a tie
--     (`knockout_ties.resolved_type = 'walkover'`) but never writes a row to
--     `knockout_tie_results`, so no result is invented for an unplayed match.

ALTER TABLE knockout_competitions ADD COLUMN winner_player_id INTEGER NULL REFERENCES players(id);
ALTER TABLE knockout_competitions ADD COLUMN completed_at TEXT NULL;

ALTER TABLE knockout_ties ADD COLUMN resolved_type TEXT NULL
	CHECK (resolved_type IS NULL OR resolved_type IN ('played', 'walkover', 'void', 'bye'));
ALTER TABLE knockout_ties ADD COLUMN winner_player_id INTEGER NULL REFERENCES players(id);
ALTER TABLE knockout_ties ADD COLUMN resolved_at TEXT NULL;

-- Byes saved by the Phase 11 opening draw were created before resolutions
-- existed; their holders went straight through, so they are resolved 'bye'.
UPDATE knockout_ties SET resolved_type = 'bye' WHERE tie_type = 'bye' AND resolved_type IS NULL;

-- The played result of a match tie (first to N frames). One at most, by
-- tie_id UNIQUE. No opponent-approval state machine: recording is final the
-- moment it is written, and a correction supersedes in place with an audit
-- trail (participants correct freely; an admin override carries a reason).
CREATE TABLE knockout_tie_results (
	id INTEGER PRIMARY KEY,
	tie_id INTEGER NOT NULL UNIQUE REFERENCES knockout_ties(id) ON DELETE CASCADE,
	low_frames INTEGER NOT NULL CHECK (low_frames >= 0),
	high_frames INTEGER NOT NULL CHECK (high_frames >= 0),
	-- Actual date played, league-local calendar date. Never inferred from an
	-- arrangement (a knockout plan is never proof of play).
	actual_played_date TEXT NOT NULL
		CHECK (actual_played_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	recorded_by_player_id INTEGER NOT NULL REFERENCES players(id),
	recorded_at TEXT NOT NULL,
	revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
	corrected_by_player_id INTEGER REFERENCES players(id),
	corrected_at TEXT,
	correction_reason TEXT
);

-- Frame-by-frame winners as entered: the primary input of a first-to-N match.
-- Play stops once a player reaches the competition target, so a match has at
-- most 2N-1 frames; the stopping rule itself is enforced by the shared
-- validation (`src/lib/knockout-progression.ts`) and covered by tests, like
-- the league's frame-sum rule.
CREATE TABLE knockout_frame_winners (
	tie_id INTEGER NOT NULL REFERENCES knockout_ties(id) ON DELETE CASCADE,
	frame_number INTEGER NOT NULL CHECK (frame_number >= 1),
	winner_player_id INTEGER NOT NULL REFERENCES players(id),
	PRIMARY KEY (tie_id, frame_number)
);

CREATE INDEX idx_knockout_frame_winners_tie ON knockout_frame_winners(tie_id, frame_number);

-- One dropout per player per competition. A paired dropout advances the
-- opponent without a played result (walkover); a bye-holder dropout voids the
-- bye and the next stage is drawn afresh from the remaining players — the
-- waiting list is never used to replace them. Visible and auditable either way.
CREATE TABLE knockout_dropouts (
	id INTEGER PRIMARY KEY,
	competition_id INTEGER NOT NULL REFERENCES knockout_competitions(id) ON DELETE CASCADE,
	player_id INTEGER NOT NULL REFERENCES players(id),
	-- The stage the player dropped out of (the competition's latest at the time).
	stage_number INTEGER NOT NULL CHECK (stage_number >= 1),
	-- 'paired' (opponent advances on a walkover), 'bye' (bye voided) or
	-- 'between_stages' (no unresolved tie to resolve; exclusion happens at the
	-- next draw, or the competition completes by attrition).
	dropout_kind TEXT NOT NULL CHECK (dropout_kind IN ('paired', 'bye', 'between_stages')),
	recorded_by_player_id INTEGER NOT NULL REFERENCES players(id),
	recorded_at TEXT NOT NULL,
	reason TEXT NOT NULL,
	UNIQUE (competition_id, player_id)
);

-- A planned date for a knockout tie: a promise between two players, never a
-- result. Same shape and honesty rules as league bookings — the previous
-- active plan is superseded rather than overwritten, so the history stays.
CREATE TABLE knockout_arrangements (
	id INTEGER PRIMARY KEY,
	tie_id INTEGER NOT NULL REFERENCES knockout_ties(id) ON DELETE CASCADE,
	proposed_by_player_id INTEGER NOT NULL REFERENCES players(id),
	proposed_date TEXT NOT NULL
		CHECK (proposed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	proposed_time TEXT CHECK (proposed_time IS NULL OR proposed_time GLOB '[0-9][0-9]:[0-9][0-9]'),
	note TEXT CHECK (note IS NULL OR length(note) <= 200),
	status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'cancelled')),
	created_at TEXT NOT NULL,
	cancelled_at TEXT,
	cancelled_by_player_id INTEGER REFERENCES players(id),
	cancel_reason TEXT
);

CREATE UNIQUE INDEX idx_knockout_arrangements_one_active
	ON knockout_arrangements(tie_id) WHERE status = 'proposed';

CREATE INDEX idx_knockout_arrangements_tie ON knockout_arrangements(tie_id, status);

-- A lightweight "fancy playing?" ping for an unresolved tie. Recorded so the
-- tie can show the last nudge; rate-limited in the server module.
CREATE TABLE knockout_nudges (
	id INTEGER PRIMARY KEY,
	tie_id INTEGER NOT NULL REFERENCES knockout_ties(id) ON DELETE CASCADE,
	sent_by_player_id INTEGER NOT NULL REFERENCES players(id),
	sent_at TEXT NOT NULL
);

CREATE INDEX idx_knockout_nudges_tie ON knockout_nudges(tie_id, sent_by_player_id, sent_at);
