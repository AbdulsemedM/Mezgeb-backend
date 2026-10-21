import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createTestDb } from './db.js';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  /** Set only with `ownContainer: true`, for tests that need to stop the database. */
  container?: StartedPostgreSqlContainer;
  close(): Promise<void>;
}

/**
 * Boots the full API on a random port against a fresh, migrated database.
 * By default the database lives in the shared container; `ownContainer` starts a dedicated one.
 */
export async function startTestApp(opts: { ownContainer?: boolean } = {}): Promise<TestApp> {
  let databaseUrl: string;
  let container: StartedPostgreSqlContainer | undefined;
  let dropDb: (() => Promise<void>) | undefined;

  if (opts.ownContainer) {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    databaseUrl = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await runMigrations(pool);
    await pool.end();
  } else {
    const testDb = await createTestDb();
    databaseUrl = testDb.url;
    dropDb = () => testDb.close();
  }

  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        PORT: '0',
        DATABASE_URL: databaseUrl,
        S3_ENDPOINT: 'http://localhost:9000',
        S3_BUCKET: 'test',
        S3_ACCESS_KEY: 'test',
        S3_SECRET_KEY: 'test',
      }),
    ],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  let closed = false;
  return {
    app,
    baseUrl,
    container,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await dropDb?.();
      await container?.stop().catch(() => undefined);
    },
  };
}
