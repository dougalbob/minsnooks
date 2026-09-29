import type { Db } from './db';

export interface AdminSettings {
	roundDurationDays: number;
	graceDays: number;
	timezone: string;
	contactVisibilityDefault: boolean;
}

const FALLBACK: AdminSettings = {
	roundDurationDays: 28,
	graceDays: 7,
	timezone: 'Europe/London',
	contactVisibilityDefault: true
};

function readValue(db: Db, key: string): string | null {
	return (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

export function loadAdminSettings(db: Db): AdminSettings {
	const duration = Number(readValue(db, 'round_duration_days'));
	const grace = Number(readValue(db, 'round_grace_days'));
	const visibility = readValue(db, 'contact_visibility_default');
	const timezone = readValue(db, 'league_timezone') ?? FALLBACK.timezone;
	let validTimezone = false;
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
		validTimezone = true;
	} catch {
		// A corrupt setting should not make admin pages unavailable.
	}
	return {
		roundDurationDays: Number.isInteger(duration) && duration >= 1 && duration <= 180 ? duration : FALLBACK.roundDurationDays,
		graceDays: Number.isInteger(grace) && grace >= 0 && grace <= 90 ? grace : FALLBACK.graceDays,
		timezone: validTimezone ? timezone : FALLBACK.timezone,
		contactVisibilityDefault: visibility === '0' ? false : FALLBACK.contactVisibilityDefault
	};
}

export function validateAdminSettings(input: {
	roundDurationDays: number;
	graceDays: number;
	timezone: string;
	contactVisibilityDefault: boolean;
}): AdminSettings {
	if (!Number.isInteger(input.roundDurationDays) || input.roundDurationDays < 1 || input.roundDurationDays > 180) {
		throw new Error('Round duration must be a whole number from 1 to 180 days.');
	}
	if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > 90) {
		throw new Error('Grace period must be a whole number from 0 to 90 days.');
	}
	const timezone = input.timezone.trim();
	if (timezone.length > 64) throw new Error('Enter a valid IANA timezone.');
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
	} catch {
		throw new Error('Enter a valid IANA timezone, such as Europe/London.');
	}
	return { ...input, timezone };
}

export function saveAdminSettings(db: Db, settings: AdminSettings, actorPlayerId: number): void {
	const entries = [
		['round_duration_days', String(settings.roundDurationDays)],
		['round_grace_days', String(settings.graceDays)],
		['league_timezone', settings.timezone],
		['contact_visibility_default', settings.contactVisibilityDefault ? '1' : '0']
	] as const;
	db.transaction(() => {
		const recent = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log
			WHERE entity_type = 'app_settings' AND action = 'updated'
			AND actor_player_id = ? AND created_at >= datetime('now', '-1 minute')`).get(actorPlayerId) as { n: number }).n;
		if (recent >= 10) throw new Error('Settings are being changed too quickly. Try again in a minute.');
		for (const [key, value] of entries) {
			db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
		}
		db.prepare(`INSERT INTO audit_log (entity_type, entity_id, action, actor_player_id, detail)
			VALUES ('app_settings', 1, 'updated', ?, ?)`)
			.run(actorPlayerId, JSON.stringify(settings));
	})();
}
