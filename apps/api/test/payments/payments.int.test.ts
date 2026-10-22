import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoggedIn } from '../setup/auth.js';
import { buy, nextDeviceSeq, postEntry, signEntry } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('payments and pay-me (M8, ADR-013)', () => {
  let t: TestApp;

  // Own Postgres: one test pulls changes (ADR-010).
  beforeAll(async () => {
    t = await startTestApp({ ownContainer: true });
  });

  afterAll(async () => {
    await t?.close();
  });

  async function owing(amount = 10_000) {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    await buy(t, shop.owner, invited.accountId, { amount });
    return {
      shop,
      owner: shop.owner,
      customer,
      accountId: invited.accountId,
      phone: invited.phone,
    };
  }

  const cash = (user: LoggedIn, accountId: string, amount: number, method = 'cash') =>
    signEntry(user.device, accountId, {
      id: randomUUID(),
      type: 'payment',
      amount,
      lines: [],
      taken_by_type: null,
      representative_id: null,
      ref_entry_id: null,
      reason: null,
      method: method as 'cash',
      device_id: user.device.id,
      device_seq: nextDeviceSeq(user.device),
      recorded_at: t.clock.now().toISOString(),
    });

  const balance = async (user: LoggedIn, accountId: string) =>
    (await t.get(`/v1/accounts/${accountId}`, { token: user.accessToken })).body
      .balance_santim as number;

  describe('cash at the counter (PAY-4)', () => {
    it('the owner records it signed; it posts as confirmed and the customer is told', async () => {
      const { owner, accountId, phone } = await owing();
      const res = await postEntry(t, owner, accountId, cash(owner, accountId, 4_000));
      expect(res.status).toBe(201);
      expect(res.body.entry).toMatchObject({ type: 'payment', payment_method: 'cash' });
      expect(await balance(owner, accountId)).toBe(6_000);
      await t.outbox.runOnce();
      expect(smsTo(t, phone)).toContain('60.00');
      const chain = await t.get(`/v1/accounts/${accountId}/chain/verify`, {
        token: owner.accessToken,
      });
      expect(chain.body.ok).toBe(true);
    });

    it('works offline through sync', async () => {
      const { owner, accountId } = await owing();
      const body = cash(owner, accountId, 2_500, 'telebirr');
      const res = await t.post(
        '/v1/sync',
        { writes: [{ op: 'entry.create', body: { ...body, account_id: accountId } }] },
        { token: owner.accessToken },
      );
      expect(res.body.results[0]).toMatchObject({ status: 'ok' });
      expect(await balance(owner, accountId)).toBe(7_500);
    });

    it('staff cannot record payments (ADR-006)', async () => {
      const { shop, accountId } = await owing();
      const staff = await addStaff(t, shop);
      const res = await postEntry(t, staff, accountId, cash(staff, accountId, 1_000));
      expect(res.status).toBe(403);
    });

    it('a payment needs a method and has no lines', async () => {
      const { owner, accountId } = await owing();
      const noMethod = cash(owner, accountId, 1_000);
      delete (noMethod as { method?: string }).method;
      expect((await postEntry(t, owner, accountId, noMethod)).status).toBe(400);
    });
  });

  describe('pay-me (PAY-1, PAY-5, PAY-7)', () => {
    it('carries the shop’s payment details; payments move it to partly paid, then paid', async () => {
      const { shop, owner, accountId, phone } = await owing();
      await t.patch(
        `/v1/merchants/${shop.merchantId}`,
        { payment_details: 'telebirr 0911 000 111' },
        { token: owner.accessToken },
      );
      const id = randomUUID();
      const sent = await t.post(
        `/v1/accounts/${accountId}/payme-requests`,
        { id, amount: 10_000, message: 'Please pay this week', due_date: '2026-10-28' },
        { token: owner.accessToken },
      );
      expect(sent.status).toBe(201);
      expect(sent.body).toMatchObject({ status: 'sent', payment_details: 'telebirr 0911 000 111' });
      await t.outbox.runOnce();
      const sms = smsTo(t, phone);
      expect(sms).toContain('telebirr 0911 000 111');
      expect(sms).toContain('Please pay this week');

      await postEntry(t, owner, accountId, cash(owner, accountId, 4_000));
      const list = async () =>
        (await t.get(`/v1/accounts/${accountId}/payme-requests`, { token: owner.accessToken })).body
          .payme_requests[0].status;
      expect(await list()).toBe('partially_paid');
      await postEntry(t, owner, accountId, cash(owner, accountId, 6_000));
      expect(await list()).toBe('paid');
    });

    it('staff cannot send pay-me (ADR-003)', async () => {
      const { shop, accountId } = await owing();
      const staff = await addStaff(t, shop);
      const res = await t.post(
        `/v1/accounts/${accountId}/payme-requests`,
        { id: randomUUID(), amount: 100 },
        { token: staff.accessToken },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('payment reports (PAY-2, PAY-3; US-10 merchant side)', () => {
    const report = (customer: LoggedIn, accountId: string, extra: object = {}) =>
      t.post(
        `/v1/accounts/${accountId}/payment-reports`,
        { id: randomUUID(), amount: 3_000, method: 'telebirr', reference: 'TX123', ...extra },
        { token: customer.accessToken },
      );

    it('confirming records a server payment entry; the chain stays valid', async () => {
      const { owner, customer, accountId } = await owing();
      const reported = await report(customer, accountId);
      expect(reported.status).toBe(201);
      await t.outbox.runOnce();
      expect(smsTo(t, owner.phone)).toContain('30.00');
      expect(await balance(owner, accountId)).toBe(10_000);

      const confirmed = await t.post(
        `/v1/payment-reports/${reported.body.id}/confirm`,
        {},
        { token: owner.accessToken },
      );
      expect(confirmed.body).toMatchObject({ status: 'confirmed' });
      expect(await balance(owner, accountId)).toBe(7_000);
      const entries = (
        await t.get(`/v1/accounts/${accountId}/entries`, { token: owner.accessToken })
      ).body.entries;
      expect(entries.at(-1)).toMatchObject({ type: 'payment', origin: 'server', amount: 3_000 });
      const chain = await t.get(`/v1/accounts/${accountId}/chain/verify`, {
        token: owner.accessToken,
      });
      expect(chain.body.ok).toBe(true);

      // Again is the same answer, not a second payment.
      await t.post(
        `/v1/payment-reports/${reported.body.id}/confirm`,
        {},
        { token: owner.accessToken },
      );
      expect(await balance(owner, accountId)).toBe(7_000);
    });

    it('rejecting tells the customer why; they can report again', async () => {
      const { owner, customer, accountId, phone } = await owing();
      const reported = await report(customer, accountId);
      const rejected = await t.post(
        `/v1/payment-reports/${reported.body.id}/reject`,
        { reason: 'No telebirr payment arrived' },
        { token: owner.accessToken },
      );
      expect(rejected.body).toMatchObject({ status: 'rejected' });
      await t.outbox.runOnce();
      expect(smsTo(t, phone)).toContain('No telebirr payment arrived');
      const again = await report(customer, accountId, { resubmitted_from_id: reported.body.id });
      expect(again.status).toBe(201);
      const late = await t.post(
        `/v1/payment-reports/${reported.body.id}/confirm`,
        {},
        { token: owner.accessToken },
      );
      expect(late.body.code).toBe('payment_report_reviewed');
    });

    it('only the owner reviews; only the customer reports', async () => {
      const { shop, owner, customer, accountId } = await owing();
      const staff = await addStaff(t, shop);
      expect((await report(owner as LoggedIn, accountId)).status).toBe(403);
      const reported = await report(customer, accountId);
      const byStaff = await t.post(
        `/v1/payment-reports/${reported.body.id}/confirm`,
        {},
        { token: staff.accessToken },
      );
      expect(byStaff.status).toBe(403);
    });

    it('sync: the owner gets reports and pay-me; staff get neither (ADR-003)', async () => {
      const { shop, owner, customer, accountId } = await owing();
      const staff = await addStaff(t, shop);
      await report(customer, accountId);
      await t.post(
        `/v1/accounts/${accountId}/payme-requests`,
        { id: randomUUID(), amount: 1_000 },
        { token: owner.accessToken },
      );
      const ownerPull = await t.post('/v1/sync', { cursor: '0' }, { token: owner.accessToken });
      expect(ownerPull.body.changes.payment_reports).toHaveLength(1);
      expect(ownerPull.body.changes.payme_requests).toHaveLength(1);
      const staffPull = await t.post('/v1/sync', { cursor: '0' }, { token: staff.accessToken });
      expect(staffPull.body.changes.payment_reports).toEqual([]);
      expect(staffPull.body.changes.payme_requests).toEqual([]);
    });
  });
});
