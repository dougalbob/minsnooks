-- Phase 15: global defaults for future seasons/rounds and new member profiles.
-- Existing season and round snapshots are intentionally never rewritten.
INSERT OR IGNORE INTO app_settings (key, value) VALUES
	('round_duration_days', '28'),
	('round_grace_days', '7'),
	('league_timezone', 'Europe/London'),
	('contact_visibility_default', '1');
