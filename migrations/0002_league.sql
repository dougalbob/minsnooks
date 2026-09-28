-- Minsnooks V2 — canonical league schema (Phase 2).
--
-- Design notes (HANDOFF §4, §10):
--   * Scoring rules are stored per season and are never edited mid-season.
--   * A round snapshots its roster (round_players), its deadline and its grace
--     period when it opens. Later membership or settings changes must not
--     silently change an existing round.
--   * Fixtures exist independently of bookings: one fixture per pair per round,
--     enforced atomically by UNIQUE(round_id, player_low_id, player_high_id)
--     together with CHECK (player_low_id < player_high_id), which also makes a
--     mirrored duplicate (b, a) impossible.
--   * The actual date played is stored on the result and is never derived from
--     the booked date on the fixture.
--   * Awards are table points only: they live in their own table and can never
--     contribute frames, frame difference or match wins to the standings.

CREATE TABLE seasons (
	id INTEGER PRIMARY KEY,
	label TEXT NOT NULL UNIQUE,
	-- League scoring for this season, selected when the season starts.
	-- No mid-season recalculation (HANDOFF §4 "2026 scoring and future scoring").
	frames_per_match INTEGER NOT NULL DEFAULT 3 CHECK (frames_per_match > 0),
	points_per_frame INTEGER NOT NULL DEFAULT 1 CHECK (points_per_frame >= 0),
	match_win_bonus INTEGER NOT NULL DEFAULT 0 CHECK (match_win_bonus >= 0),
	-- League-local timezone used to render calendar dates.
	timezone TEXT NOT NULL DEFAULT 'Europe/London',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rounds (
	id INTEGER PRIMARY KEY,
	season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
	-- 1-based round index inside the season.
	number INTEGER NOT NULL CHECK (number > 0),
	-- 'open' accepts scheduling; 'closed' is final for that round.
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
	-- Admin explicitly marks the season's final round (HANDOFF §4).
	is_final INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0, 1)),
	-- Snapshots captured when the round opens.
	deadline_at TEXT,
	grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
	opened_at TEXT NOT NULL DEFAULT (datetime('now')),
	closed_at TEXT,
	UNIQUE (season_id, number)
);

CREATE INDEX idx_rounds_season ON rounds(season_id);

-- Roster snapshot: exactly the players included in this round. A player who
-- joins later appears from the next round; a withdrawn player stays visible
-- here (history and earned points are retained).
CREATE TABLE round_players (
	round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
	player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
	-- Snapshot flag: set when the player is withdrawn during/after this round.
	-- Withdrawal plumbing itself is Phase 7; the column exists so snapshots and
	-- awards can already be represented.
	withdrawn INTEGER NOT NULL DEFAULT 0 CHECK (withdrawn IN (0, 1)),
	PRIMARY KEY (round_id, player_id)
);

CREATE TABLE fixtures (
	id INTEGER PRIMARY KEY,
	round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
	-- Canonical ordering: low < high. This plus the UNIQUE index below is what
	-- makes "one fixture per pair per round" a database guarantee rather than an
	-- application-level check (HANDOFF §10).
	player_low_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
	player_high_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
	-- unplayed: open, awaiting play
	-- awaiting_confirmation: a result is submitted but not yet confirmed
	-- confirmed: an approved league result exists
	-- closed_unplayed: neutral closure after grace — never a 0–0 result, never
	--                  reappears as outstanding
	-- awarded: resolved by an administrative award (table points only)
	state TEXT NOT NULL DEFAULT 'unplayed'
		CHECK (state IN ('unplayed', 'awaiting_confirmation', 'confirmed', 'closed_unplayed', 'awarded')),
	-- Proposed/booked date. Deliberately separate from the actual played date.
	booked_date TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	CHECK (player_low_id < player_high_id),
	UNIQUE (round_id, player_low_id, player_high_id)
);

CREATE INDEX idx_fixtures_round ON fixtures(round_id);
CREATE INDEX idx_fixtures_low ON fixtures(player_low_id);
CREATE INDEX idx_fixtures_high ON fixtures(player_high_id);

CREATE TABLE results (
	id INTEGER PRIMARY KEY,
	-- One result per fixture. Enforced by the UNIQUE index.
	fixture_id INTEGER NOT NULL UNIQUE REFERENCES fixtures(id) ON DELETE CASCADE,
	-- Frame winners. Exactly frames_per_match frames are played in a league
	-- match, so low + high must equal the season's frames_per_match; that value
	-- lives on the season, so the sum is validated in the engine (and tested)
	-- rather than by a table CHECK that cannot see the parent season.
	player_low_frames INTEGER NOT NULL CHECK (player_low_frames >= 0),
	player_high_frames INTEGER NOT NULL CHECK (player_high_frames >= 0),
	-- Required for every saved result, including friendlies. Never inferred
	-- from a stale booking.
	actual_played_date TEXT NOT NULL,
	-- submitted: awaiting opponent confirmation (does NOT affect standings)
	-- confirmed: approved (the only state that feeds standings)
	-- sent_back: returned to the submitter for correction
	status TEXT NOT NULL DEFAULT 'submitted'
		CHECK (status IN ('submitted', 'confirmed', 'sent_back')),
	-- player: submitted by a participant, needs opponent confirmation
	-- admin_direct: super-admin retrospective entry, no opponent approval
	-- admin_retrospective: admin entered a genuine result for a closed fixture
	entry_source TEXT NOT NULL DEFAULT 'player'
		CHECK (entry_source IN ('player', 'admin_direct', 'admin_retrospective')),
	submitted_by_player_id INTEGER NOT NULL REFERENCES players(id),
	submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
	confirmed_by_player_id INTEGER REFERENCES players(id),
	confirmed_at TEXT,
	-- Correction bookkeeping (Phase 6 fills the audit trail in detail).
	corrected_at TEXT,
	correction_reason TEXT
);

CREATE INDEX idx_results_status ON results(status);

-- Optional frame-by-frame snooker point scores (HANDOFF §4: all three may be
-- entered at submission; they cannot be added later).
CREATE TABLE result_frames (
	result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
	frame_number INTEGER NOT NULL CHECK (frame_number > 0),
	player_low_points INTEGER NOT NULL CHECK (player_low_points >= 0),
	player_high_points INTEGER NOT NULL CHECK (player_high_points >= 0),
	PRIMARY KEY (result_id, frame_number)
);

-- Optional highest break per player for a result. May be recorded even when
-- frame-point detail is omitted.
CREATE TABLE result_breaks (
	result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
	player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
	break_points INTEGER NOT NULL CHECK (break_points >= 0),
	PRIMARY KEY (result_id, player_id)
);

-- Administrative awards. Table points only: no frames, no frame difference, no
-- match win, no performance metric.
CREATE TABLE awards (
	id INTEGER PRIMARY KEY,
	fixture_id INTEGER NOT NULL UNIQUE REFERENCES fixtures(id) ON DELETE CASCADE,
	-- Recipient of the table points (the active opponent of a withdrawn player).
	player_id INTEGER NOT NULL REFERENCES players(id),
	table_points INTEGER NOT NULL CHECK (table_points >= 0),
	-- previous_round_result: taken from a genuine previous-round league result
	--   against the same opponent (never from a previous award)
	-- random_draw: one-time 0–3 draw when no prior result is available
	-- manual: explicit admin decision, recorded with a reason
	source_type TEXT NOT NULL
		CHECK (source_type IN ('previous_round_result', 'random_draw', 'manual')),
	source_result_id INTEGER REFERENCES results(id),
	draw_value INTEGER CHECK (draw_value IS NULL OR draw_value BETWEEN 0 AND 3),
	created_by_player_id INTEGER NOT NULL REFERENCES players(id),
	reason TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	CHECK (
		(source_type = 'previous_round_result' AND source_result_id IS NOT NULL)
		OR (source_type = 'random_draw' AND draw_value IS NOT NULL)
		OR source_type = 'manual'
	)
);

CREATE INDEX idx_awards_player ON awards(player_id);

-- Append-only audit trail for corrections and administrative actions.
CREATE TABLE audit_log (
	id INTEGER PRIMARY KEY,
	entity_type TEXT NOT NULL,
	entity_id INTEGER NOT NULL,
	action TEXT NOT NULL,
	actor_player_id INTEGER REFERENCES players(id),
	reason TEXT,
	-- JSON snapshot of what changed (before/after), for the admin browser.
	detail TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
