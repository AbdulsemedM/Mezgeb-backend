import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notification } from '../../src/db/schema.js';
import type { SmsMessage } from '../../src/sms/sms-gateway.js';
import { createShop, invite, type Shop } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

describe('outbox dispatcher (ADR-006)', () => {
  let t: TestApp;
  let shop: Shop;
  const realSend = (m: SmsMessage) => ConsoleSend.call(t.sms, m);
  let ConsoleSend: (m: SmsMessage) => Promise<void>;

  beforeAll(async () => {
    t = await startTestApp();
    ConsoleSend = t.sms.send;
    shop = await createShop(t);
    await t.outbox.runOnce();
  });

  beforeEach(() => {
    t.sms.send = realSend;
  });

  afterAll(async () => {
    await t?.close();
  });

  const row = async (phone: string) =>
    (await t.db!.db.select().from(notification).where(eq(notification.phone, phone)))[0]!;

  it('retries a failed send after a backoff', async () => {
    const invited = await invite(t, shop);
    t.sms.send = async () => {
      throw new Error('gateway down');
    };
    expect(await t.outbox.runOnce()).toBe(0);
    expect(await row(invited.phone)).toMatchObject({ status: 'pending', attempts: 1 });

    t.sms.send = realSend;
    expect(await t.outbox.runOnce()).toBe(0); // not due yet
    t.clock.advance(30_000);
    expect(await t.outbox.runOnce()).toBe(1);
    expect(await row(invited.phone)).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('gives up after 5 attempts', async () => {
    const invited = await invite(t, shop);
    t.sms.send = async () => {
      throw new Error('gateway down');
    };
    for (let i = 0; i < 5; i++) {
      await t.outbox.runOnce();
      t.clock.advance(5 * 60_000);
    }
    expect(await row(invited.phone)).toMatchObject({ status: 'failed', attempts: 5 });
    t.sms.send = realSend;
    expect(await t.outbox.runOnce()).toBe(0);
  });

  it('never sends a row twice when dispatchers run in parallel', async () => {
    // A fresh shop: the previous test moved the clock past the owner's access-token lifetime.
    const fresh = await createShop(t, 'Parallel Shop');
    const phones = [];
    for (let i = 0; i < 10; i++) phones.push((await invite(t, fresh)).phone);
    const before = t.sms.sent.length;
    const results = await Promise.all([t.outbox.runOnce(), t.outbox.runOnce(), t.outbox.runOnce()]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(10);
    const sentNow = t.sms.sent.slice(before).map((m) => m.to);
    expect(sentNow.sort()).toEqual(phones.sort());
  });

  it('does not send anything for a rolled-back write', async () => {
    const fresh = await createShop(t, 'Rollback Shop');
    const invited = await invite(t, fresh);
    await t.outbox.runOnce();
    const before = t.sms.sent.length;
    // A duplicate invite fails inside the transaction (account_exists) and must queue nothing.
    const res = await t.post(
      '/v1/accounts',
      { id: crypto.randomUUID(), merchant_id: fresh.merchantId, phone: invited.phone },
      { token: fresh.owner.accessToken },
    );
    expect(res.body.code).toBe('account_exists');
    expect(await t.outbox.runOnce()).toBe(0);
    expect(t.sms.sent.length).toBe(before);
    const rows = await t
      .db!.db.select()
      .from(notification)
      .where(eq(notification.phone, invited.phone));
    expect(rows).toHaveLength(1);
  });
});
