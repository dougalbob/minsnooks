-- Phase 11: knockout invitation, opt-in, entry selection, swaps and opening draw.
--
-- Knockouts are a separate competition: none of these rows feed league
-- fixtures, results, standings or statistics. Selection and first-stage draws
-- are committed server-side and have matching audit_log snapshots.

CREATE TABLE knockout_competitions (
	id INTEGER PRIMARY KEY,
	title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
	announcement TEXT NOT NULL DEFAULT '' CHECK (length(announcement) <= 500),
	created_by_player_id INTEGER NOT NULL REFERENCES players(id),
	created_at TEXT NOT NULL,
	-- Absolute instant converted from a league-local datetime by the server.
	reply_deadline_at TEXT NOT NULL,
	-- Fixed once, at announcement. Phase 12 uses the same target in every stage.
	frames_to_win INTEGER NOT NULL CHECK (frames_to_win IN (2, 3, 4)),
	status TEXT NOT NULL DEFAULT 'inviting'
		CHECK (status IN ('inviting', 'abandoned', 'selected', 'drawn')),
	selection_closed_at TEXT,
	drawn_at TEXT
);

CREATE INDEX idx_knockout_competitions_status_deadline
	ON knockout_competitions(status, reply_deadline_at);

CREATE TABLE knockout_responses (
	competition_id INTEGER NOT NULL REFERENCES knockout_competitions(id) ON DELETE CASCADE,
	player_id INTEGER NOT NULL REFERENCES players(id),
	opted_in INTEGER NOT NULL CHECK (opted_in IN (0, 1)),
	responded_at TEXT NOT NULL,
	PRIMARY KEY (competition_id, player_id)
);

CREATE INDEX idx_knockout_responses_entrant
	ON knockout_responses(competition_id, opted_in, player_id);

CREATE TABLE knockout_entries (
	competition_id INTEGER NOT NULL REFERENCES knockout_competitions(id) ON DELETE CASCADE,
	player_id INTEGER NOT NULL REFERENCES players(id),
	entry_status TEXT NOT NULL CHECK (entry_status IN ('selected', 'waiting')),
	-- Random order produced by the original selection. Swaps change membership,
	-- not this historical ordering, and never trigger a new selection.
	selection_order INTEGER NOT NULL CHECK (selection_order >= 1),
	selected_at TEXT NOT NULL,
	PRIMARY KEY (competition_id, player_id),
	UNIQUE (competition_id, selection_order)
);

CREATE INDEX idx_knockout_entries_status_order
	ON knockout_entries(competition_id, entry_status, selection_order);

CREATE TABLE knockout_swaps (
	id INTEGER PRIMARY KEY,
	competition_id INTEGER NOT NULL REFERENCES knockout_competitions(id) ON DELETE CASCADE,
	selected_player_id INTEGER NOT NULL,
	waiting_player_id INTEGER NOT NULL,
	recorded_by_player_id INTEGER NOT NULL REFERENCES players(id),
	recorded_at TEXT NOT NULL,
	reason TEXT,
	consent_confirmed INTEGER NOT NULL CHECK (consent_confirmed = 1),
	CHECK (selected_player_id <> waiting_player_id),
	FOREIGN KEY (competition_id, selected_player_id)
		REFERENCES knockout_entries(competition_id, player_id),
	FOREIGN KEY (competition_id, waiting_player_id)
		REFERENCES knockout_entries(competition_id, player_id)
);

CREATE TABLE knockout_stages (
	id INTEGER PRIMARY KEY,
	competition_id INTEGER NOT NULL REFERENCES knockout_competitions(id) ON DELETE CASCADE,
	stage_number INTEGER NOT NULL CHECK (stage_number >= 1),
	drawn_by_player_id INTEGER NOT NULL REFERENCES players(id),
	drawn_at TEXT NOT NULL,
	UNIQUE (competition_id, stage_number)
);

CREATE TABLE knockout_ties (
	id INTEGER PRIMARY KEY,
	stage_id INTEGER NOT NULL REFERENCES knockout_stages(id) ON DELETE CASCADE,
	tie_number INTEGER NOT NULL CHECK (tie_number >= 1),
	tie_type TEXT NOT NULL CHECK (tie_type IN ('match', 'bye')),
	player_low_id INTEGER REFERENCES players(id),
	player_high_id INTEGER REFERENCES players(id),
	bye_player_id INTEGER REFERENCES players(id),
	CHECK (
		(tie_type = 'match' AND player_low_id IS NOT NULL AND player_high_id IS NOT NULL
			AND player_low_id < player_high_id AND bye_player_id IS NULL)
		OR
		(tie_type = 'bye' AND player_low_id IS NULL AND player_high_id IS NULL
			AND bye_player_id IS NOT NULL)
	),
	UNIQUE (stage_id, tie_number)
);

CREATE INDEX idx_knockout_ties_stage ON knockout_ties(stage_id, tie_number);
