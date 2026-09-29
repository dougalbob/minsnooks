-- Lightweight shared-process-independent throttle for authenticated form/API writes.
CREATE TABLE request_rate_limits (
	identity_email TEXT NOT NULL COLLATE NOCASE,
	route_key TEXT NOT NULL,
	window_started_at INTEGER NOT NULL,
	hit_count INTEGER NOT NULL CHECK (hit_count >= 1),
	PRIMARY KEY (identity_email, route_key)
);
