import { RemindersService } from '../../src/ledger/reminders.service.js';
import { FakePushSender, PushSender } from '../../src/push/push-sender.js';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { Clock, FakeClock } from '../../src/common/clock.js';
import { runMigrations } from '../../src/db/migrate.js';
import { OutboxDispatcher } from '../../src/outbox/outbox.dispatcher.js';
import { ConsoleSmsGateway, SmsGateway } from '../../src/sms/sms-gateway.js';
import { createTestDb, type TestDb } from './db.js';

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export interface RequestOptions {
  token?: string;
  /** Sent as X-Forwarded-For; the test app trusts the proxy header. */
  ip?: string;
}

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  clock: FakeClock;
  sms: ConsoleSmsGateway;
  /** The outbox dispatcher; polling is off in tests, call `runOnce()`. */
  outbox: OutboxDispatcher;
  /** In-memory push (ADR-015): pushes go here once a device has a token. */
  push: FakePushSender;
  /** Scheduled reminders; the timer is off in tests, call `runOnce()`. */
  reminders: RemindersService;
  /** Direct DB access; unset with `ownContainer`. */
  db?: TestDb;
  /** Set only with `ownContainer: true`, for tests that need to stop the database. */
  container?: StartedPostgreSqlContainer;
  get<T = any>(path: string, opts?: RequestOptions): Promise<ApiResponse<T>>;
  post<T = any>(path: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  patch<T = any>(path: string, body: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  put<T = any>(path: string, body: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  delete<T = any>(path: string, opts?: RequestOptions): Promise<ApiResponse<T>>;
  close(): Promise<void>;
}

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: '0',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test',
  S3_SECRET_KEY: 'test',
  JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123',
  OTP_PEPPER: 'test-otp-pepper-0123456789abcdef0123',
  TRUST_PROXY: 'true',
  PUBLIC_WEB_URL: 'http://localhost:5173',
  OUTBOX_POLL_MS: '0',
  REMINDERS_INTERVAL_MS: '0',
};

/**
 * Boots the full API on a random port against a fresh, migrated database, with a FakeClock
 * and the in-memory SMS gateway. `ownContainer` starts a dedicated Postgres instead.
 */
export async function startTestApp(
  opts: { ownContainer?: boolean; imports?: any[]; env?: Record<string, string> } = {},
): Promise<TestApp> {
  let databaseUrl: string;
  let container: StartedPostgreSqlContainer | undefined;
  let testDb: TestDb | undefined;

  if (opts.ownContainer) {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    databaseUrl = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await runMigrations(pool);
    await pool.end();
  } else {
    testDb = await createTestDb();
    databaseUrl = testDb.url;
  }

  const clock = new FakeClock();
  const sms = new ConsoleSmsGateway();
  const push = new FakePushSender();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({ ...TEST_ENV, ...opts.env, DATABASE_URL: databaseUrl }),
      ...(opts.imports ?? []),
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(SmsGateway)
    .useValue(sms)
    .overrideProvider(PushSender)
    .useValue(push)
    .compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  const call = async (method: string, path: string, body: unknown, o: RequestOptions = {}) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.ip) headers['x-forwarded-for'] = o.ip;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  let closed = false;
  return {
    app,
    baseUrl,
    clock,
    sms,
    outbox: app.get(OutboxDispatcher),
    push,
    reminders: app.get(RemindersService),
    db: testDb,
    container,
    get: (path, o) => call('GET', path, undefined, o),
    post: (path, body, o) => call('POST', path, body ?? {}, o),
    patch: (path, body, o) => call('PATCH', path, body, o),
    put: (path, body, o) => call('PUT', path, body, o),
    delete: (path, o) => call('DELETE', path, undefined, o),
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await testDb?.close();
      await container?.stop().catch(() => undefined);
    },
  };
}

/** Every SMS sent to `phone` so far, joined; the order within one outbox run is not defined. */
export function smsTo(t: TestApp, phone: string): string {
  return t.sms.sent
    .filter((m) => m.to === phone)
    .map((m) => m.text)
    .join('\n');
}
