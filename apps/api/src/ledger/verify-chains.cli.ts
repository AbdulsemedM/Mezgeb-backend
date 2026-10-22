import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { parseEnv } from '../config/env.schema.js';
import * as schema from '../db/schema.js';
import { accountsChangedSince, verifyAccountChain } from './chain.js';

/**
 * Verifies the chain of every account that received entries since a time (default: the last
 * 24 hours). `pnpm --filter @mezgeb/api db:verify-chains [ISO time]`. Exits 1 if any chain is
 * broken. Scheduled nightly from M10 (ADR-008).
 */
async function main(): Promise<void> {
  const config = parseEnv(process.env);
  const since = process.argv[2] ? new Date(process.argv[2]) : new Date(Date.now() - 86_400_000);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  const db = drizzle(pool, { schema });
  let broken = 0;
  try {
    const accounts = await accountsChangedSince(db, since);
    for (const id of accounts) {
      const result = await verifyAccountChain(db, id);
      if (!result.ok) {
        broken++;
        console.error(`BROKEN ${id}: seq ${result.first_bad_seq} (${result.reason})`);
      }
    }
    console.log(
      `checked ${accounts.length} account(s) since ${since.toISOString()}, ${broken} broken`,
    );
  } finally {
    await pool.end();
  }
  process.exitCode = broken > 0 ? 1 : 0;
}

void main();
