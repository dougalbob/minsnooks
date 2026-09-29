import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default async function globalTeardown() {
	const databasePath = path.join(os.tmpdir(), 'minsnooks-phase15-smoke.db');
	const fixtureInfo = path.join(os.tmpdir(), 'minsnooks-phase15-smoke.json');
	for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
	fs.rmSync(fixtureInfo, { force: true });
}
