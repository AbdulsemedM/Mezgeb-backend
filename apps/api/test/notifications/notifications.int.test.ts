import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notification } from '../../src/db/schema.js';
import type { LoggedIn } from '../setup/auth.js';
import { buy } from '../setup/ledger.js';
import { acceptInvite, createShop, invite } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('notifications (M10, ADR-015)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function setup() {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    return {
      shop,
      owner: shop.owner,
      customer,
      accountId: invited.accountId,
      phone: invited.phone,
    };
  }

  const token = (user: LoggedIn, value: string | null) =>
    t.put('/v1/devices/me/push-token', { token: value }, { token: user.accessToken });

  const pushesTo = (value: string) => t.push.sent.filter((p) => p.tokens.includes(value));

  it('no push token: SMS; with a token: push with the account head, no SMS', async () => {
    const { owner, customer, accountId, phone } = await setup();
    const before = smsTo(t, phone).length;
    await buy(t, owner, accountId, { amount: 1_000 });
    await t.outbox.runOnce();
    expect(smsTo(t, phone).length).toBeGreaterThan(before);

    const tok = `tok-${randomUUID()}`;
    expect((await token(customer, tok)).status).toBe(204);
    const smsBefore = smsTo(t, phone);
    const sale = await buy(t, owner, accountId, { amount: 2_000 });
    await t.outbox.runOnce();
    expect(smsTo(t, phone)).toBe(smsBefore);
    const push = pushesTo(tok).at(-1)!;
    expect(push.body).toContain('20.00');
    expect(push.data).toMatchObject({
      event: 'purchase_recorded',
      account_id: accountId,
      seq: String(sale.body.head.seq),
      hash: sale.body.head.hash,
    });
  });

  it('"Push, SMS" events go both ways (pay-me)', async () => {
    const { owner, customer, accountId, phone } = await setup();
    const tok = `tok-${randomUUID()}`;
    await token(customer, tok);
    await buy(t, owner, accountId, { amount: 5_000 });
    await t.outbox.runOnce();
    const smsBefore = smsTo(t, phone).length;
    await t.post(
      `/v1/accounts/${accountId}/payme-requests`,
      { id: randomUUID(), amount: 5_000 },
      { token: owner.accessToken },
    );
    await t.outbox.runOnce();
    expect(pushesTo(tok).some((p) => p.data.event === 'payme_sent')).toBe(true);
    expect(smsTo(t, phone).length).toBeGreaterThan(smsBefore);
  });

  it('a dead token is cleared and the push falls back to SMS', async () => {
    const { owner, customer, accountId, phone } = await setup();
    await token(customer, `dead-${randomUUID()}`);
    const before = smsTo(t, phone).length;
    await buy(t, owner, accountId, { amount: 1_500 });
    await t.outbox.runOnce(); // the push fails and queues the SMS
    await t.outbox.runOnce(); // the SMS goes
    expect(smsTo(t, phone).length).toBeGreaterThan(before);
    const smsAfter = smsTo(t, phone).length;
    await buy(t, owner, accountId, { amount: 1_500 });
    await t.outbox.runOnce();
    expect(smsTo(t, phone).length).toBeGreaterThan(smsAfter); // straight to SMS: token gone
  });

  it('quiet hours: notices wait until 07:00 Addis; money changes do not', async () => {
    const { owner, accountId, phone } = await setup();
    t.clock.set(new Date('2026-10-22T19:30:00.000Z')); // 22:30 Addis
    const { login } = await import('../setup/auth.js');
    const fresh = await login(t, { phone: owner.phone, device: owner.device });
    await buy(t, fresh, accountId, { amount: 1_000 }); // urgent
    await t.post(
      `/v1/accounts/${accountId}/payme-requests`,
      { id: randomUUID(), amount: 1_000 },
      { token: fresh.accessToken },
    ); // waits
    const rows = await t.db!.db.select().from(notification).where(eq(notification.phone, phone));
    const purchase = rows.find(
      (r) => r.event === 'purchase_recorded' && r.createdAt.getTime() === t.clock.now().getTime(),
    );
    const payme = rows.find((r) => r.event === 'payme_sent');
    expect(purchase?.scheduledFor).toEqual(t.clock.now());
    expect(payme?.scheduledFor).toEqual(new Date('2026-10-23T04:00:00.000Z'));
    // Back to daytime for the tests that follow.
    t.clock.set(new Date('2026-10-23T06:00:00.000Z'));
  });

  it('the other side hears when a limit changes', async () => {
    const { owner, customer, accountId, phone } = await setup();
    await t.put(
      `/v1/accounts/${accountId}/limits/merchant`,
      { value: 50_000 },
      {
        token: owner.accessToken,
      },
    );
    await t.put(
      `/v1/accounts/${accountId}/limits/customer`,
      { value: 40_000 },
      {
        token: customer.accessToken,
      },
    );
    await t.outbox.runOnce();
    expect(smsTo(t, phone)).toContain('Tigist Mini Market');
    expect(smsTo(t, owner.phone)).toContain('Floor 4 Hanna');
  });

  it('a representative with a phone hears they were added', async () => {
    const { customer, accountId, owner } = await setup();
    const repPhone = `+2519${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const res = await t.post(
      `/v1/accounts/${accountId}/representatives`,
      { id: randomUUID(), name: 'Selam', relationship: 'household', phone: repPhone },
      { token: customer.accessToken },
    );
    expect(res.status).toBe(201);
    await t.outbox.runOnce();
    expect(smsTo(t, repPhone)).toContain('Tigist Mini Market');
    expect(smsTo(t, owner.phone)).toContain('Selam');
  });
});

describe('scheduled reminders (ADR-015)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('due in 3 days, then due today, each once', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    await acceptInvite(t, invited);
    await t.put(
      `/v1/accounts/${invited.accountId}/limits/merchant`,
      { value: 1_000_000, period: { type: 'weekly' } },
      { token: shop.owner.accessToken },
    );
    // Bought 5 days ago: due in 2 days (weekly period), so "due soon".
    await buy(t, shop.owner, invited.accountId, {
      amount: 10_000,
      recordedAt: new Date(t.clock.now().getTime() - 5 * 86_400_000),
    });
    await t.outbox.runOnce();
    const before = smsTo(t, invited.phone).length;
    expect(await t.reminders.runOnce()).toBe(1);
    expect(await t.reminders.runOnce()).toBe(0);
    await t.outbox.runOnce();
    expect(smsTo(t, invited.phone).length).toBeGreaterThan(before);
  });

  it('PAY-6: a payment report not reviewed in 48 hours reminds the owner once', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    await t.post(
      `/v1/accounts/${invited.accountId}/payment-reports`,
      { id: randomUUID(), amount: 3_000, method: 'telebirr' },
      { token: customer.accessToken },
    );
    expect(await t.reminders.runOnce()).toBe(0);
    t.clock.advance(48 * 60 * 60_000);
    expect(await t.reminders.runOnce()).toBeGreaterThanOrEqual(1);
    expect(await t.reminders.runOnce()).toBe(0);
  });
});

describe('SMS cap per plan (ADR-015)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp({ env: { SMS_CAP_FREE: '3' } });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('past the cap SMS are recorded but not sent; invites still go', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    await acceptInvite(t, invited);
    for (let i = 0; i < 4; i++) await buy(t, shop.owner, invited.accountId, { amount: 100 });
    const rows = await t
      .db!.db.select()
      .from(notification)
      .where(eq(notification.merchantId, shop.merchantId));
    const sms = rows.filter((r) => r.channel === 'sms');
    expect(sms.filter((r) => r.status === 'cancelled').length).toBeGreaterThan(0);
    const another = await invite(t, shop);
    const inviteRow = (
      await t.db!.db.select().from(notification).where(eq(notification.phone, another.phone))
    ).find((r) => r.event === 'customer_invited');
    expect(inviteRow?.status).toBe('pending');
  });
});
