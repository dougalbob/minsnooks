-- Minsnooks V2 — initial schema: identity & app settings.
-- League domain tables arrive in 0002_league.sql (Phase 2).

CREATE TABLE players (
	id INTEGER PRIMARY KEY,
	email TEXT NOT NULL UNIQUE COLLATE NOCASE,
	display_name TEXT NOT NULL,
	initials TEXT NOT NULL,
	avatar_tone TEXT NOT NULL DEFAULT 'maya',
	-- Roles are stored in the database and checked server-side.
	-- Cloudflare Access success never implies a role.
	role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin', 'super_admin')),
	-- Contact details are visible to league members by default (HANDOFF §9);
	-- a player may hide them.
	contact_visible INTEGER NOT NULL DEFAULT 1 CHECK (contact_visible IN (0, 1)),
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE app_settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
