/** CLI: `npm run migrate` — applies pending SQL migrations (idempotent). */
import { getDb, closeDb, migrationsDir } from './db';
import { runMigrations } from './migrate';

const db = getDb();
const applied = runMigrations(db, migrationsDir());
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
closeDb();
