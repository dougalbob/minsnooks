import { getDb } from '$lib/server/db';

export function load() {
	const season = getDb()
		.prepare('SELECT label FROM seasons ORDER BY id DESC LIMIT 1')
		.get() as { label: string } | undefined;

	return { seasonLabel: season?.label ?? null };
}
