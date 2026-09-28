-- Phase 4: round deadlines, withdrawals and lifecycle auditability.
-- Keep defaults in app_settings so newly auto-opened rounds snapshot them;
-- an existing round always retains its own deadline/grace values.

INSERT INTO app_settings (key, value) VALUES
	('round_duration_days', '28'),
	('round_grace_days', '7')
ON CONFLICT (key) DO NOTHING;

-- A season has at most one round open for scheduling at any time.
CREATE UNIQUE INDEX idx_rounds_one_open_globally
	ON rounds(status)
	WHERE status = 'open';

CREATE TABLE player_withdrawals (
	player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
	effective_from_season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
	-- The player remains in earlier/current snapshots, then is excluded from
	-- every subsequent league round unless an admin explicitly reinstates them.
	effective_from_round INTEGER NOT NULL CHECK (effective_from_round > 0),
	actor_player_id INTEGER REFERENCES players(id),
	reason TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Carry forward the existing fictional Round 6 withdrawal snapshot, if present.
INSERT OR IGNORE INTO player_withdrawals (
	player_id, effective_from_season_id, effective_from_round, reason
)
SELECT player_id, season_id, effective_from_round, 'Existing withdrawn-round snapshot'
FROM (
	SELECT rp.player_id, ro.season_id, ro.number + 1 AS effective_from_round,
		ROW_NUMBER() OVER (PARTITION BY rp.player_id ORDER BY ro.season_id, ro.number) AS occurrence
	FROM round_players rp
	JOIN rounds ro ON ro.id = rp.round_id
	WHERE rp.withdrawn = 1
)
WHERE occurrence = 1;

CREATE TABLE lifecycle_runs (
	id INTEGER PRIMARY KEY,
	trigger TEXT NOT NULL CHECK (trigger IN ('timer', 'admin')),
	-- `evaluated_at` is the scheduler's effective clock, which may be advanced
	-- deliberately in a fictional preview to demonstrate deadline transitions.
	evaluated_at TEXT NOT NULL,
	completed_at TEXT NOT NULL,
	events_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_lifecycle_runs_completed ON lifecycle_runs(completed_at DESC);
