import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { inject } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { Db } from '../../src/db/db.module.js';
import { TEMPLATE_DB, withDatabase } from './global-setup.js';

export interface TestDb {
  url: string;
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}

/**
 * A fresh database in the shared container.
 * `migrated` (default) clones the migrated template; `empty` starts from template0.
 */
export async function createTestDb(from: 'migrated' | 'empty' = 'migrated'): Promise<TestDb> {
  const adminUri = inject('pgAdminUri');
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  await adminQuery(
    adminUri,
    `CREATE DATABASE ${name} TEMPLATE ${from === 'migrated' ? TEMPLATE_DB : 'template0'}`,
  );
  const url = withDatabase(adminUri, name);
  const pool = new pg.Pool({ connectionString: url });
  return {
    url,
    pool,
    db: drizzle(pool, { schema }),
    async close() {
      await pool.end();
      await adminQuery(adminUri, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
}

async function adminQuery(uri: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: uri });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
