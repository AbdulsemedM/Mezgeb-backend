import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

export interface TestApp {
  app: INestApplication;
  pg: StartedPostgreSqlContainer;
  baseUrl: string;
  close(): Promise<void>;
}

/** Starts a real Postgres 16 container and boots the full API against it on a random port. */
export async function startTestApp(): Promise<TestApp> {
  const pg = await new PostgreSqlContainer('postgres:16-alpine').start();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        PORT: '0',
        DATABASE_URL: pg.getConnectionUri(),
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
    pg,
    baseUrl,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await pg.stop().catch(() => undefined);
    },
  };
}
