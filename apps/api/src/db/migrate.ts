import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

/** apps/api/drizzle, resolved from both src/db (tests) and dist/db (built). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Any fixed number; only migration runs take this advisory lock. */
const MIGRATION_LOCK = 72_011_012;

/**
 * Applies pending migrations. Safe to run repeatedly, and from several containers starting at
 * once (M12): they wait on one advisory lock, so only the first applies anything.
 */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
