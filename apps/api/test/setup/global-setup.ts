import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate.js';

export const TEMPLATE_DB = 'mezgeb_template';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection URI of the shared container's maintenance DB (`postgres`). */
    pgAdminUri: string;
  }
}

/**
 * One Postgres 16 container per test run. Migrations are applied once to a template DB;
 * each test file clones it (see db.ts), which is fast and keeps files isolated.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const adminUri = withDatabase(container.getConnectionUri(), 'postgres');

  const admin = new pg.Client({ connectionString: adminUri });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: withDatabase(adminUri, TEMPLATE_DB) });
  await runMigrations(pool);
  await pool.end();

  project.provide('pgAdminUri', adminUri);
  return async () => {
    await container.stop();
  };
}

export function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}
