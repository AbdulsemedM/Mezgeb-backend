import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './setup/test-app.js';

describe('GET /v1/health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('returns ok when the database answers', async () => {
    const res = await fetch(`${t.baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('returns 404 in the error shape for unknown routes', async () => {
    const res = await fetch(`${t.baseUrl}/v1/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found', message: expect.any(String) });
  });

  // Runs last: it stops the database.
  it('returns 503 db_unavailable when the database is down', async () => {
    await t.pg.stop();
    const res = await fetch(`${t.baseUrl}/v1/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: 'db_unavailable',
      message: 'Database is unavailable',
    });
  });
});
