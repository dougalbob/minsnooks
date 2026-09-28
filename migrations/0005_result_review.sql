-- Phase 6: result entry, opponent review and corrections.
--
-- The `results` table already carried the review states (`submitted`,
-- `confirmed`, `sent_back`) and the correction bookkeeping columns from
-- Phase 2. This migration adds what the real journey needs to be honest about
-- *who* did *what*, *when* and *why* (HANDOFF §4 "Result submission and
-- corrections"):
--
--   * a send-back is a message, not just a status: who sent it back, when, and
--     what they asked the submitter to check;
--   * a post-approval change records the admin who made it;
--   * `revision` counts how many times the row has been written, so a corrected
--     result is visibly not the original submission;
--   * `details_locked_at` marks the moment the optional frame-point detail and
--     highest breaks became locked. HANDOFF §4: "Players cannot add optional
--     details later after submission." A player correction may fix the values
--     they submitted, but may not introduce frame detail or breaks that were
--     not part of the original submission; only an admin change (with a
--     mandatory reason) may.
--   * `result_frame_winners` stores the frame-by-frame winners the submitter
--     entered and the opponent confirmed (see below).
--
-- The detailed who/what/when record itself lives in `audit_log` (append-only,
-- with a JSON before/after snapshot), so no separate history table is added
-- here: one source of truth, queryable by (entity_type, entity_id).

ALTER TABLE results ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE results ADD COLUMN corrected_by_player_id INTEGER REFERENCES players(id);

ALTER TABLE results ADD COLUMN sent_back_by_player_id INTEGER REFERENCES players(id);
ALTER TABLE results ADD COLUMN sent_back_at TEXT;
ALTER TABLE results ADD COLUMN send_back_reason TEXT;

ALTER TABLE results ADD COLUMN details_locked_at TEXT;

-- The frame winners a player actually submitted, one row per frame.
--
-- `results.player_low_frames` / `player_high_frames` hold the match score, and
-- `result_frames` holds the *optional* point detail. HANDOFF §4 makes the frame
-- winners the primary input ("exactly three frames are played; the submitted
-- match frame count must agree with the three frame winners"), and the opponent
-- confirms that frame-by-frame record, so it is stored rather than inferred.
-- Results recorded before Phase 6 (and the aggregated fictional seed) have no
-- rows here; the UI then shows the match score alone rather than inventing a
-- frame order.
CREATE TABLE result_frame_winners (
	result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
	frame_number INTEGER NOT NULL CHECK (frame_number > 0),
	player_id INTEGER NOT NULL REFERENCES players(id),
	PRIMARY KEY (result_id, frame_number)
);

-- Result history is read per (entity_type, entity_id): one result's own story
-- oldest-first, the league-wide feed newest-first. A DESC index serves both
-- (SQLite scans it backwards), and keeps either read off a full audit scan.
CREATE INDEX idx_audit_result_history ON audit_log(entity_type, entity_id, id DESC);
