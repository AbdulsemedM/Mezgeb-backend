import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buy } from './setup/ledger.js';
import { acceptInvite, createShop, invite } from './setup/shop.js';
import { smsTo, startTestApp, type TestApp } from './setup/test-app.js';

const CRON_SECRET = 'test-cron-secret-0123456789';

describe('GET /v1/cron/daily (ADR-017)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp({ env: { CRON_SECRET } });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('refuses a missing or wrong secret', async () => {
    expect((await t.get('/v1/cron/daily')).status).toBe(401);
    const wrong = await t.get('/v1/cron/daily', {
      headers: { authorization: 'Bearer not-the-secret-0123456789' },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ code: 'unauthorized' });
  });

  it('queues due reminders and sends the outbox', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    await acceptInvite(t, invited);
    await t.put(
      `/v1/accounts/${invited.accountId}/limits/merchant`,
      { value: 1_000_000, period: { type: 'weekly' } },
      { token: shop.owner.accessToken },
    );
    await buy(t, shop.owner, invited.accountId, {
      amount: 10_000,
      recordedAt: new Date(t.clock.now().getTime() - 5 * 86_400_000),
    });
    const before = smsTo(t, invited.phone).length;

    const res = await t.get('/v1/cron/daily', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.reminders).toBe(1);
    expect(res.body.sent).toBeGreaterThanOrEqual(2);
    expect(smsTo(t, invited.phone).length).toBeGreaterThan(before);
    expect(await t.outbox.runOnce()).toBe(0);
  });
});

describe('without CRON_SECRET', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('the route does not exist', async () => {
    expect((await t.get('/v1/cron/daily')).status).toBe(404);
  });
});
