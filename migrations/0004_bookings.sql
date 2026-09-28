-- Phase 5: planned dates (bookings) as first-class rows.
--
-- Rules this table exists to protect (HANDOFF §4 "Fixture resolution",
-- «Save planned/booked date separately from actual date played»):
--
--   * A booking is a PLAN between the two players. It is never a result and is
--     never used as the actual date played — `results.actual_played_date` is
--     entered with the result and confirmed by the opponent.
--   * Either player in the fixture may propose, change or cancel the planned
--     date. Changes keep history: the previous proposal is superseded rather
--     than overwritten, so nobody can silently rewrite a plan.
--   * At most one proposal is active per fixture, enforced by a partial unique
--     index (SQLite supports them) rather than an application-level check.
--   * Proposed dates are league-local calendar dates. An optional time is a
--     local wall-clock value ('HH:MM', 24-hour) with no timezone stored: the
--     league timezone already lives on the season.
--
-- `fixtures.booked_date` (from 0002_league.sql) remains as a mirror of the
-- single active proposal: NULL when there is no active proposal. It exists so
-- simple fixture listings can show the next arranged date without a join, and
-- it is still never a played date.

CREATE TABLE bookings (
	id INTEGER PRIMARY KEY,
	fixture_id INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
	-- YYYY-MM-DD, interpreted in the season's league timezone.
	proposed_date TEXT NOT NULL CHECK (proposed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	-- Optional local wall-clock time, 'HH:MM' 24-hour.
	proposed_time TEXT CHECK (proposed_time IS NULL OR proposed_time GLOB '[0-2][0-9]:[0-5][0-9]'),
	-- proposed: the active plan for this fixture.
	-- cancelled: superseded by a newer proposal, or cancelled outright.
	status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'cancelled')),
	note TEXT,
	proposed_by_player_id INTEGER NOT NULL REFERENCES players(id),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT,
	cancelled_at TEXT,
	cancelled_by_player_id INTEGER REFERENCES players(id),
	cancel_reason TEXT
);

-- One active proposal per fixture, atomically.
CREATE UNIQUE INDEX idx_bookings_one_active
	ON bookings(fixture_id)
	WHERE status = 'proposed';

CREATE INDEX idx_bookings_fixture ON bookings(fixture_id);
CREATE INDEX idx_bookings_date ON bookings(proposed_date);

-- Carry forward any planned date that predates this table.
--
-- The Phase 2 seed wrote `fixtures.booked_date` directly for fixtures that
-- already had a result: a played match's plan is superseded by its recorded
-- actual date, so those legacy values are cleared. A planned date on an
-- unplayed fixture is still meaningful, so it is converted into a real active
-- proposal (attributed to the fixture's first player, marked as carried over).
UPDATE fixtures
SET booked_date = NULL
WHERE booked_date IS NOT NULL
	AND EXISTS (SELECT 1 FROM results r WHERE r.fixture_id = fixtures.id);

INSERT INTO bookings (fixture_id, proposed_date, proposed_time, status, note, proposed_by_player_id)
SELECT f.id, f.booked_date, NULL, 'proposed', 'Carried over from the previous planned-date field', f.player_low_id
FROM fixtures f
WHERE f.booked_date IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM results r WHERE r.fixture_id = f.id)
	AND NOT EXISTS (
		SELECT 1 FROM bookings b WHERE b.fixture_id = f.id AND b.status = 'proposed'
	);
