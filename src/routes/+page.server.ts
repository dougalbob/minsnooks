import { getDb } from '$lib/server/db';
import { loadHomePageData } from '$lib/server/home-page';

export function load() {
	return loadHomePageData(getDb());
}
