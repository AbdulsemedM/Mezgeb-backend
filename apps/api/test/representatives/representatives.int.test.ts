import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessService } from '../../src/access/access.service.js';
import { EntriesService } from '../../src/ledger/entries.service.js';
import type { LoggedIn } from '../setup/auth.js';
import { buy, postEntry, purchaseBody } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite, type Shop } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('representatives (REP, M6)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  interface Household {
    shop: Shop;
    owner: LoggedIn;
    customer: LoggedIn;
    accountId: string;
    customerPhone: string;
  }

  async function household(): Promise<Household> {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    return {
      shop,
      owner: shop.owner,
      customer,
      accountId: invited.accountId,
      customerPhone: invited.phone,
    };
  }

  async function addRep(h: Household, body: Record<string, unknown> = {}) {
    const res = await t.post(
      `/v1/accounts/${h.accountId}/representatives`,
      { id: randomUUID(), name: 'Almaz', relationship: 'maid', ...body },
      { token: h.customer.accessToken },
    );
    if (res.status !== 201) throw new Error(`add rep failed: ${JSON.stringify(res.body)}`);
    return res.body as { id: string; status: string };
  }

  const picker = (h: Household, who: LoggedIn = h.owner) =>
    t.get(`/v1/accounts/${h.accountId}/representatives`, { token: who.accessToken });

  const setStatus = (h: Household, repId: string, status: string) =>
    t.post(`/v1/representatives/${repId}/status`, { status }, { token: h.customer.accessToken });

  describe('US-06: the customer adds the maid with a monthly limit and can revoke her', () => {
    it('she appears in the merchant’s picker at once, without private details', async () => {
      const h = await household();
      const rep = await addRep(h, {
        phone: '0911 00 00 01',
        limit: { value: 150_000, period: { type: 'monthly' } },
        pin: '1234',
      });
      expect(rep).toMatchObject({
        name: 'Almaz',
        relationship: 'maid',
        status: 'active',
        phone: '+251911000001',
        has_pin: true,
        limit: { value: 150_000, period: { type: 'monthly', calendar: 'ethiopian' } },
      });
      expect(rep).not.toHaveProperty('pin');

      const list = await picker(h);
      expect(list.status).toBe(200);
      expect(list.body.representatives).toEqual([
        expect.objectContaining({ id: rep.id, name: 'Almaz', has_pin: true }),
      ]);
      expect(list.body.representatives[0]).not.toHaveProperty('phone');
      expect(list.body.representatives[0].limit).toMatchObject({ value: 150_000 });
    });

    it('entries past her own limit warn at 80% and need a reason above 100%', async () => {
      const h = await household();
      const rep = await addRep(h, { limit: { value: 10_000, period: { type: 'weekly' } } });
      const near = await buy(t, h.owner, h.accountId, {
        amount: 8_000,
        takenBy: 'representative',
        representativeId: rep.id,
      });
      expect(near.body.limits.representative).toMatchObject({
        status: 'warn80',
        limit: 10_000,
        projected_spend: 8_000,
        crossed: ['80'],
      });

      const over = await postEntry(
        t,
        h.owner,
        h.accountId,
        purchaseBody(t, h.owner, h.accountId, {
          amount: 3_000,
          takenBy: 'representative',
          representativeId: rep.id,
        }),
      );
      expect(over.status).toBe(409);
      expect(over.body.code).toBe('limit_override_required');

      const allowed = await buy(t, h.owner, h.accountId, {
        amount: 3_000,
        takenBy: 'representative',
        representativeId: rep.id,
        reason: 'Customer called to allow it',
      });
      expect(allowed.body.entry.flags).toEqual(['over_limit_override']);
      // Purchases taken by the customer herself do not count against the maid.
      const own = await buy(t, h.owner, h.accountId, { amount: 50_000 });
      expect(own.body.limits.representative).toBeNull();
    });

    it('after revoke she disappears from the picker and cannot take goods online', async () => {
      const h = await household();
      const rep = await addRep(h);
      expect((await setStatus(h, rep.id, 'revoked')).status).toBe(200);
      expect((await picker(h)).body.representatives).toEqual([]);

      const res = await postEntry(
        t,
        h.owner,
        h.accountId,
        purchaseBody(t, h.owner, h.accountId, {
          takenBy: 'representative',
          representativeId: rep.id,
        }),
      );
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'representative_inactive',
        details: { status: 'revoked' },
      });
    });

    it('the customer still sees her, as revoked; revoked is final', async () => {
      const h = await household();
      const rep = await addRep(h);
      await setStatus(h, rep.id, 'revoked');
      const own = await picker(h, h.customer);
      expect(own.body.representatives).toEqual([
        expect.objectContaining({ id: rep.id, status: 'revoked' }),
      ]);
      const back = await setStatus(h, rep.id, 'active');
      expect(back.status).toBe(409);
      expect(back.body.code).toBe('representative_revoked');
    });
  });

  it('pause hides her from the picker; resume brings her back', async () => {
    const h = await household();
    const rep = await addRep(h);
    await setStatus(h, rep.id, 'paused');
    expect((await picker(h)).body.representatives).toEqual([]);
    await setStatus(h, rep.id, 'active');
    expect((await picker(h)).body.representatives).toHaveLength(1);
  });

  describe('offline entries are never refused (ADR-003), only flagged', () => {
    async function recordOffline(h: Household, repId: string) {
      const access = await t.app
        .get(AccessService)
        .requireAccount(h.owner.userId, h.accountId, 'view_account');
      return t.app.get(EntriesService).record(
        access,
        { userId: h.owner.userId, deviceId: h.owner.device.id },
        purchaseBody(t, h.owner, h.accountId, {
          takenBy: 'representative',
          representativeId: repId,
        }),
        'offline',
      );
    }

    it('revoked: posted with rep_revoked and the customer is alerted', async () => {
      const h = await household();
      const rep = await addRep(h);
      await setStatus(h, rep.id, 'revoked');
      const { result } = await recordOffline(h, rep.id);
      expect(result.entry.flags).toEqual(['rep_revoked']);
      await t.outbox.runOnce();
      expect(smsTo(t, h.customerPhone)).toContain('Almaz');
      expect(smsTo(t, h.customerPhone)).toMatch(/removed|ተሰርዟል|haqame/);
    });

    it('paused: posted with rep_paused', async () => {
      const h = await household();
      const rep = await addRep(h);
      await setStatus(h, rep.id, 'paused');
      const { result } = await recordOffline(h, rep.id);
      expect(result.entry.flags).toEqual(['rep_paused']);
    });
  });

  describe('own limit periods roll from the day it was set (ADR-007)', () => {
    it('purchases before the current window do not count', async () => {
      const h = await household();
      const rep = await addRep(h, { limit: { value: 10_000, period: { type: 'weekly' } } });
      await buy(t, h.owner, h.accountId, {
        amount: 9_000,
        takenBy: 'representative',
        representativeId: rep.id,
      });
      t.clock.advance(8 * 86_400_000);
      // The access token expired with the clock; sign in again.
      const { login } = await import('../setup/auth.js');
      const owner = await login(t, { phone: h.owner.phone, device: h.owner.device });
      const next = await buy(t, owner, h.accountId, {
        amount: 1_000,
        takenBy: 'representative',
        representativeId: rep.id,
      });
      expect(next.body.limits.representative).toMatchObject({
        projected_spend: 1_000,
        status: 'ok',
      });
    });

    it('changing the limit moves the anchor to today', async () => {
      const h = await household();
      const rep = await addRep(h, { limit: { value: 10_000, period: { type: 'monthly' } } });
      const before = (await picker(h, h.customer)).body.representatives[0].limit.set_at;
      t.clock.advance(3 * 86_400_000);
      const { login } = await import('../setup/auth.js');
      const customer = await login(t, { phone: h.customer.phone, device: h.customer.device });
      const res = await t.patch(
        `/v1/representatives/${rep.id}`,
        { limit: { value: 20_000, period: { type: 'monthly' } } },
        { token: customer.accessToken },
      );
      expect(res.status).toBe(200);
      expect(res.body.limit.set_at).not.toBe(before);
      expect(res.body.limit.value).toBe(20_000);
    });
  });

  describe('PIN (REP-6), checked online at the counter', () => {
    const verify = (who: LoggedIn, repId: string, pin: string) =>
      t.post(`/v1/representatives/${repId}/verify-pin`, { pin }, { token: who.accessToken });

    it('right and wrong PIN', async () => {
      const h = await household();
      const rep = await addRep(h, { pin: '4321' });
      expect((await verify(h.owner, rep.id, '4321')).body).toEqual({ ok: true });
      expect((await verify(h.owner, rep.id, '0000')).body).toEqual({ ok: false, attempts_left: 4 });
    });

    it('5 wrong tries lock it until the customer sets a new PIN', async () => {
      const h = await household();
      const rep = await addRep(h, { pin: '4321' });
      for (let i = 0; i < 5; i++) await verify(h.owner, rep.id, '0000');
      const locked = await verify(h.owner, rep.id, '4321');
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe('pin_locked');
      await t.patch(
        `/v1/representatives/${rep.id}`,
        { pin: '5555' },
        { token: h.customer.accessToken },
      );
      expect((await verify(h.owner, rep.id, '5555')).body).toEqual({ ok: true });
    });

    it('staff may check; the customer may not', async () => {
      const h = await household();
      const staff = await addStaff(t, h.shop);
      const rep = await addRep(h, { pin: '4321' });
      expect((await verify(staff, rep.id, '4321')).body.ok).toBe(true);
      expect((await verify(h.customer, rep.id, '4321')).status).toBe(403);
    });

    it('no PIN set: 400 no_pin', async () => {
      const h = await household();
      const rep = await addRep(h);
      const res = await verify(h.owner, rep.id, '1234');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('no_pin');
    });
  });

  describe('who may do what', () => {
    it('only the customer adds, edits and revokes', async () => {
      const h = await household();
      const staff = await addStaff(t, h.shop);
      for (const who of [h.owner, staff]) {
        const res = await t.post(
          `/v1/accounts/${h.accountId}/representatives`,
          { id: randomUUID(), name: 'X', relationship: 'guard' },
          { token: who.accessToken },
        );
        expect(res.status).toBe(403);
      }
      const rep = await addRep(h);
      expect(
        (
          await t.post(
            `/v1/representatives/${rep.id}/status`,
            { status: 'revoked' },
            { token: h.owner.accessToken },
          )
        ).status,
      ).toBe(403);
    });

    it('a stranger gets 404', async () => {
      const h = await household();
      const rep = await addRep(h);
      const stranger = (await createShop(t, 'Far away')).owner;
      expect((await picker(h, stranger)).status).toBe(404);
      expect(
        (
          await t.patch(
            `/v1/representatives/${rep.id}`,
            { name: 'Y' },
            { token: stranger.accessToken },
          )
        ).status,
      ).toBe(404);
    });
  });

  it('create is idempotent on id', async () => {
    const h = await household();
    const body = { id: randomUUID(), name: 'Kebede', relationship: 'guard' };
    const first = await t.post(`/v1/accounts/${h.accountId}/representatives`, body, {
      token: h.customer.accessToken,
    });
    const again = await t.post(`/v1/accounts/${h.accountId}/representatives`, body, {
      token: h.customer.accessToken,
    });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });

  it('an invalid phone is refused', async () => {
    const h = await household();
    const res = await t.post(
      `/v1/accounts/${h.accountId}/representatives`,
      { id: randomUUID(), name: 'Abebe', relationship: 'driver', phone: '0111234567' },
      { token: h.customer.accessToken },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_phone');
  });

  describe('SMS', () => {
    it('the shop owner hears when a representative is added or revoked', async () => {
      const h = await household();
      const rep = await addRep(h, { name: 'Tsehay' });
      await setStatus(h, rep.id, 'revoked');
      await t.outbox.runOnce();
      const toOwner = t.sms.sent.filter((m) => m.to === h.owner.phone && m.text.includes('Tsehay'));
      expect(toOwner).toHaveLength(2);
    });

    it('a representative who opted in gets a receipt; the customer’s receipt names her', async () => {
      const h = await household();
      const rep = await addRep(h, { name: 'Almaz', phone: '0911000077', sms_receipt: true });
      await buy(t, h.owner, h.accountId, {
        amount: 4_500,
        takenBy: 'representative',
        representativeId: rep.id,
        lines: [{ name: 'Bread', amount: 4_500 }],
      });
      await t.outbox.runOnce();
      expect(smsTo(t, '+251911000077')).toContain('45.00');
      expect(smsTo(t, h.customerPhone)).toContain('Almaz');
    });
  });
});
