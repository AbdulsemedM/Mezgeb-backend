import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entry } from '../../src/db/schema.js';
import { buy, postEntry, purchaseBody } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('limits (LIM-1..4, ADR-007, ADR-008)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function activeAccount() {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    return { shop, owner: shop.owner, accountId: invited.accountId, customer, invited };
  }

  const limitPath = (accountId: string, side: string) => `/v1/accounts/${accountId}/limits/${side}`;

  describe('setting limits', () => {
    it('each side sets its own; both see both and the effective (stricter) limit', async () => {
      const { owner, customer, accountId } = await activeAccount();
      const merchantSide = await t.put(
        limitPath(accountId, 'merchant'),
        { value: 500_000, period: { type: 'monthly' } },
        { token: owner.accessToken },
      );
      expect(merchantSide.status).toBe(200);
      await t.put(
        limitPath(accountId, 'customer'),
        { value: 400_000, period: { type: 'biweekly' } },
        { token: customer.accessToken },
      );

      for (const user of [owner, customer]) {
        const res = await t.get(`/v1/accounts/${accountId}/limits`, { token: user.accessToken });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          merchant: { value: 500_000, period: { type: 'monthly' }, mode: 'alert' },
          customer: { value: 400_000, period: { type: 'biweekly' }, mode: 'alert' },
          state: { value: { effective_limit: 400_000, projected_balance: 0 } },
        });
      }
    });

    it('a monthly limit takes the setter’s calendar (ADR-004)', async () => {
      const { owner, accountId } = await activeAccount();
      await t.patch('/v1/me', { calendar_pref: 'gregorian' }, { token: owner.accessToken });
      const res = await t.put(
        limitPath(accountId, 'merchant'),
        { period: { type: 'monthly' } },
        { token: owner.accessToken },
      );
      expect(res.body.period).toEqual({ type: 'monthly', days: null, calendar: 'gregorian' });
    });

    it('each side only sets its own; staff neither set nor see limits', async () => {
      const { shop, owner, customer, accountId } = await activeAccount();
      const staff = await addStaff(t, shop);
      expect(
        (await t.put(limitPath(accountId, 'customer'), { value: 1 }, { token: owner.accessToken }))
          .status,
      ).toBe(403);
      expect(
        (
          await t.put(
            limitPath(accountId, 'merchant'),
            { value: 1 },
            { token: customer.accessToken },
          )
        ).status,
      ).toBe(403);
      expect(
        (await t.get(`/v1/accounts/${accountId}/limits`, { token: staff.accessToken })).status,
      ).toBe(403);
    });

    it('hard stop is for the customer’s own limit only', async () => {
      const { owner, accountId } = await activeAccount();
      const res = await t.put(
        limitPath(accountId, 'merchant'),
        { value: 100_000, mode: 'hard_stop' },
        { token: owner.accessToken },
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_limit');
    });

    it('DELETE removes a side', async () => {
      const { owner, accountId } = await activeAccount();
      await t.put(
        limitPath(accountId, 'merchant'),
        { value: 100_000 },
        { token: owner.accessToken },
      );
      expect(
        (await t.delete(limitPath(accountId, 'merchant'), { token: owner.accessToken })).status,
      ).toBe(204);
      const res = await t.get(`/v1/accounts/${accountId}/limits`, { token: owner.accessToken });
      expect(res.body.merchant).toBeNull();
    });
  });

  describe('US-08: warned before passing a limit', () => {
    it('80% is a warning: the entry posts and reports the crossing once', async () => {
      const { owner, accountId } = await activeAccount();
      await t.put(
        limitPath(accountId, 'merchant'),
        { value: 10_000 },
        { token: owner.accessToken },
      );
      const first = await buy(t, owner, accountId, { amount: 8_000 });
      expect(first.body.limits.value).toMatchObject({ status: 'warn80', crossed: ['80'] });
      const second = await buy(t, owner, accountId, { amount: 500 });
      expect(second.body.limits.value).toMatchObject({ status: 'warn80', crossed: [] });
    });

    it('exactly at the limit posts (ADR-007)', async () => {
      const { owner, accountId } = await activeAccount();
      await t.put(
        limitPath(accountId, 'merchant'),
        { value: 10_000 },
        { token: owner.accessToken },
      );
      const res = await buy(t, owner, accountId, { amount: 10_000 });
      expect(res.body.limits.value.crossed).toEqual(['80', '100']);
    });

    it('over the limit needs a reason; with one it posts, is flagged and the customer told', async () => {
      const { owner, accountId, invited } = await activeAccount();
      await t.put(
        limitPath(accountId, 'merchant'),
        { value: 10_000 },
        { token: owner.accessToken },
      );

      const refused = await postEntry(
        t,
        owner,
        accountId,
        purchaseBody(t, owner, accountId, { amount: 10_001 }),
      );
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'limit_override_required',
        details: { status: 'block100', value: { effective_limit: 10_000 } },
      });

      const res = await buy(t, owner, accountId, {
        amount: 10_001,
        reason: 'Family emergency, pays Friday',
      });
      expect(res.body.entry.flags).toEqual(['over_limit_override']);
      await t.outbox.runOnce();
      expect(smsTo(t, invited.phone)).toContain('Family emergency, pays Friday');
    });

    it('the customer’s hard stop refuses the entry online', async () => {
      const { owner, customer, accountId } = await activeAccount();
      await t.put(
        limitPath(accountId, 'customer'),
        { value: 10_000, mode: 'hard_stop' },
        { token: customer.accessToken },
      );
      const res = await postEntry(
        t,
        owner,
        accountId,
        purchaseBody(t, owner, accountId, { amount: 10_001, reason: 'Please' }),
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('limit_hard_stop');
      const rows = await t.db!.db.select().from(entry).where(eq(entry.accountId, accountId));
      expect(rows).toHaveLength(0);
    });

    it('the customer is alerted at 80% and at 100%', async () => {
      const { owner, accountId, invited } = await activeAccount();
      await t.put(
        limitPath(accountId, 'merchant'),
        { value: 10_000 },
        { token: owner.accessToken },
      );
      await buy(t, owner, accountId, { amount: 8_000 });
      await t.outbox.runOnce();
      expect(smsTo(t, invited.phone)).toContain('80%');
      await buy(t, owner, accountId, { amount: 2_000 });
      await t.outbox.runOnce();
      expect(smsTo(t, invited.phone)).toContain('100%');
    });
  });

  it('corrections are not limit-checked', async () => {
    const { owner, accountId } = await activeAccount();
    await t.put(limitPath(accountId, 'merchant'), { value: 10_000 }, { token: owner.accessToken });
    const sale = await buy(t, owner, accountId, { amount: 9_000 });
    const { correctionBody } = await import('../setup/ledger.js');
    const res = await postEntry(
      t,
      owner,
      accountId,
      correctionBody(t, owner, accountId, sale.body.entry.id, 5_000, 'Missed a sack of flour'),
    );
    expect(res.status).toBe(201);
    expect(res.body.limits).toBeNull();
  });
});
