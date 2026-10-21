import { randomUUID } from 'node:crypto';
import { CURRENT_TERMS_VERSION } from '@mezgeb/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notification } from '../../src/db/schema.js';
import { lastOtp, login, newDevice, nextIp } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { acceptInvite, addStaff, createShop, invite, type Shop } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

describe('accounts', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  const inviteBody = (shop: Shop, phone = nextPhone()) => ({
    id: randomUUID(),
    merchant_id: shop.merchantId,
    phone,
    nickname: 'Floor 6 Betty',
    location_note: 'Block 3, floor 6',
  });

  describe('US-01: invite a customer by phone', () => {
    it('creates a pending account and sends the invite SMS on the next outbox run', async () => {
      const shop = await createShop(t);
      const body = inviteBody(shop, '0911 22 33 44');
      const res = await t.post(
        '/v1/accounts',
        { ...body, language: 'en' },
        { token: shop.owner.accessToken },
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: body.id,
        status: 'pending',
        nickname: 'Floor 6 Betty',
        location_note: 'Block 3, floor 6',
        customer: { phone: '+251911223344', name: null },
        balance_santim: 0,
        head: { seq: 0, hash: '0'.repeat(64) },
      });

      expect(t.sms.lastTo('+251911223344')).toBeUndefined();
      expect(await t.outbox.runOnce()).toBeGreaterThanOrEqual(1);
      expect(t.sms.lastTo('+251911223344')?.text).toBe(
        `Tigist Mini Market added you to Mezgeb, your shared dube book. See every purchase and your balance: http://localhost:5173/a/${body.id}`,
      );
      const [row] = await t
        .db!.db.select()
        .from(notification)
        .where(eq(notification.phone, '+251911223344'));
      expect(row).toMatchObject({ event: 'customer_invited', status: 'sent', channel: 'sms' });
    });

    it('lets staff invite too', async () => {
      const shop = await createShop(t);
      const staff = await addStaff(t, shop);
      const res = await t.post('/v1/accounts', inviteBody(shop), { token: staff.accessToken });
      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty('balance_santim');
    });

    it("sends the SMS in an existing user's own language", async () => {
      const shop = await createShop(t);
      const user = await login(t);
      await t.patch('/v1/me', { language: 'om' }, { token: user.accessToken });
      // The merchant's guess (en) does not override the user's own choice.
      const phone = user.phone;
      await t.post(
        '/v1/accounts',
        { ...inviteBody(shop, phone), language: 'en' },
        { token: shop.owner.accessToken },
      );
      await t.outbox.runOnce();
      expect(t.sms.lastTo(phone)?.text).toMatch(/^Tigist Mini Market Mezgeb irratti/);
    });

    it('defaults the SMS to Amharic for a new phone', async () => {
      const shop = await createShop(t);
      const phone = nextPhone();
      await t.post('/v1/accounts', inviteBody(shop, phone), { token: shop.owner.accessToken });
      await t.outbox.runOnce();
      expect(t.sms.lastTo(phone)?.text).toContain('በመዝገብ');
    });

    it('is idempotent: a retry returns the original and queues no second SMS', async () => {
      const shop = await createShop(t);
      const body = inviteBody(shop);
      const first = await t.post('/v1/accounts', body, { token: shop.owner.accessToken });
      const retry = await t.post(
        '/v1/accounts',
        { ...body, nickname: 'Other' },
        { token: shop.owner.accessToken },
      );
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);
      const rows = await t
        .db!.db.select()
        .from(notification)
        .where(eq(notification.phone, first.body.customer.phone));
      expect(rows).toHaveLength(1);
    });

    it('rejects a second account for the same customer', async () => {
      const shop = await createShop(t);
      const phone = nextPhone();
      const first = await t.post('/v1/accounts', inviteBody(shop, phone), {
        token: shop.owner.accessToken,
      });
      const res = await t.post('/v1/accounts', inviteBody(shop, phone), {
        token: shop.owner.accessToken,
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'account_exists',
        details: { account_id: first.body.id },
      });
    });

    it('rejects an account id already used at another shop', async () => {
      const a = await createShop(t);
      const b = await createShop(t, 'Shop B');
      const body = inviteBody(a);
      await t.post('/v1/accounts', body, { token: a.owner.accessToken });
      const res = await t.post(
        '/v1/accounts',
        { ...body, merchant_id: b.merchantId },
        { token: b.owner.accessToken },
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('id_conflict');
    });

    it("rejects the shop's own owner or staff as customer", async () => {
      const shop = await createShop(t);
      const staff = await addStaff(t, shop);
      for (const phone of [shop.owner.phone, staff.phone]) {
        const res = await t.post('/v1/accounts', inviteBody(shop, phone), {
          token: shop.owner.accessToken,
        });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_customer');
      }
    });

    it('rejects a non-mobile number', async () => {
      const shop = await createShop(t);
      const res = await t.post('/v1/accounts', inviteBody(shop, '0111234567'), {
        token: shop.owner.accessToken,
      });
      expect(res.body.code).toBe('invalid_phone');
    });

    it("cannot invite into someone else's shop", async () => {
      const shop = await createShop(t);
      const other = await login(t);
      const res = await t.post('/v1/accounts', inviteBody(shop), { token: other.accessToken });
      expect(res.status).toBe(404);
    });
  });

  describe('US-02: the customer accepts', () => {
    it('a first sign-in from an invite counts as a new user, with the invite language', async () => {
      const shop = await createShop(t);
      const phone = nextPhone();
      await t.post(
        '/v1/accounts',
        { ...inviteBody(shop, phone), language: 'en' },
        { token: shop.owner.accessToken },
      );
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      const device = newDevice();
      const res = await t.post(
        '/v1/auth/verify',
        { phone, code: lastOtp(t, phone), device: { id: device.id, public_key: device.publicKey } },
        { ip },
      );
      expect(res.body).toMatchObject({ is_new_user: true, user: { language: 'en' } });
      // The second sign-in is not "new" any more.
      t.clock.advance(61_000);
      expect((await login(t, { phone })).userId).toBe(res.body.user.id);
    });

    it('turns the account active for both sides', async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop);
      const customer = await login(t, { phone: invited.phone });

      const mine = await t.get('/v1/accounts?role=customer', { token: customer.accessToken });
      expect(mine.body.accounts).toEqual([
        expect.objectContaining({ id: invited.accountId, status: 'pending' }),
      ]);

      const res = await t.post(
        `/v1/accounts/${invited.accountId}/accept`,
        { terms_version: CURRENT_TERMS_VERSION },
        { token: customer.accessToken },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'active',
        terms_accepted_at: t.clock.now().toISOString(),
        shop: { id: shop.merchantId, name: shop.shopName },
        balance_santim: 0,
      });

      const merchantSide = await t.get(`/v1/accounts/${invited.accountId}`, {
        token: shop.owner.accessToken,
      });
      expect(merchantSide.body.status).toBe('active');
    });

    it('is idempotent', async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop);
      const customer = await acceptInvite(t, invited);
      t.clock.advance(60_000);
      const again = await t.post(
        `/v1/accounts/${invited.accountId}/accept`,
        { terms_version: CURRENT_TERMS_VERSION },
        { token: customer.accessToken },
      );
      expect(again.status).toBe(200);
      expect(again.body.terms_accepted_at).not.toBe(t.clock.now().toISOString());
    });

    it('requires the current terms version', async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop);
      const customer = await login(t, { phone: invited.phone });
      const res = await t.post(
        `/v1/accounts/${invited.accountId}/accept`,
        { terms_version: 'dube-2020-01' },
        { token: customer.accessToken },
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('terms_outdated');
    });

    it('only the customer can accept', async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop);
      const res = await t.post(
        `/v1/accounts/${invited.accountId}/accept`,
        { terms_version: CURRENT_TERMS_VERSION },
        { token: shop.owner.accessToken },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('privacy (rule 8, ADR-006)', () => {
    it('never shows the nickname or location note to the customer', async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop, { nickname: 'NICKNAME-SECRET-7' });
      const customer = await acceptInvite(t, invited);
      const opts = { token: customer.accessToken };
      const responses = [
        await t.get('/v1/accounts?role=customer', opts),
        await t.get(`/v1/accounts/${invited.accountId}`, opts),
        await t.patch(
          `/v1/accounts/${invited.accountId}`,
          { customer_detail_view: 'detailed' },
          opts,
        ),
        await t.post(
          `/v1/accounts/${invited.accountId}/accept`,
          { terms_version: CURRENT_TERMS_VERSION },
          opts,
        ),
      ];
      for (const r of responses) {
        expect(r.status).toBe(200);
        const raw = JSON.stringify(r.body);
        expect(raw).not.toContain('NICKNAME-SECRET-7');
        expect(raw).not.toContain('Block 12');
        expect(raw).not.toContain('nickname');
        expect(raw).not.toContain('location_note');
      }
    });

    it('shows the balance to the owner but not to staff', async () => {
      const shop = await createShop(t);
      const staff = await addStaff(t, shop);
      const invited = await invite(t, shop);
      const asOwner = await t.get(`/v1/accounts/${invited.accountId}`, {
        token: shop.owner.accessToken,
      });
      const asStaff = await t.get(`/v1/accounts/${invited.accountId}`, {
        token: staff.accessToken,
      });
      expect(asOwner.body.balance_santim).toBe(0);
      expect(asStaff.body).not.toHaveProperty('balance_santim');
      const staffList = await t.get('/v1/accounts?role=merchant', { token: staff.accessToken });
      expect(JSON.stringify(staffList.body)).not.toContain('balance');
    });
  });

  describe('PATCH /v1/accounts/:id (per-field permissions)', () => {
    it('staff can set the nickname but not the detail mode', async () => {
      const shop = await createShop(t);
      const staff = await addStaff(t, shop);
      const invited = await invite(t, shop);
      const url = `/v1/accounts/${invited.accountId}`;
      const ok = await t.patch(url, { nickname: 'Blue gate' }, { token: staff.accessToken });
      expect(ok.body.nickname).toBe('Blue gate');
      const no = await t.patch(
        url,
        { nickname: 'x', detail_mode: 'detailed' },
        { token: staff.accessToken },
      );
      expect(no.status).toBe(403);
      expect(no.body.details).toMatchObject({ field: 'detail_mode' });
      // Nothing from the rejected request was applied.
      expect((await t.get(url, { token: staff.accessToken })).body.nickname).toBe('Blue gate');
    });

    it('the owner sets the per-customer detail mode; the customer sets their view', async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop);
      const customer = await acceptInvite(t, invited);
      const url = `/v1/accounts/${invited.accountId}`;
      expect(
        (await t.patch(url, { detail_mode: 'detailed' }, { token: shop.owner.accessToken })).body
          .detail_mode,
      ).toBe('detailed');
      expect(
        (await t.patch(url, { customer_detail_view: 'simple' }, { token: customer.accessToken }))
          .body.customer_detail_view,
      ).toBe('simple');
      expect((await t.patch(url, { nickname: 'me' }, { token: customer.accessToken })).status).toBe(
        403,
      );
      expect(
        (await t.patch(url, { customer_detail_view: 'simple' }, { token: shop.owner.accessToken }))
          .status,
      ).toBe(403);
    });
  });

  describe('GET /v1/accounts', () => {
    it('pages through the merchant list', async () => {
      const shop = await createShop(t);
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push((await invite(t, shop)).accountId);
      const opts = { token: shop.owner.accessToken };
      const p1 = await t.get('/v1/accounts?role=merchant&limit=2', opts);
      expect(p1.body.accounts).toHaveLength(2);
      expect(p1.body.next_after).toBe(p1.body.accounts[1].id);
      const p2 = await t.get(
        `/v1/accounts?role=merchant&limit=2&after=${p1.body.next_after}`,
        opts,
      );
      expect(p2.body.accounts).toHaveLength(1);
      expect(p2.body.next_after).toBeNull();
      expect(
        [...p1.body.accounts, ...p2.body.accounts].map((a: { id: string }) => a.id).sort(),
      ).toEqual(ids.sort());
    });

    it('requires role', async () => {
      const shop = await createShop(t);
      expect((await t.get('/v1/accounts', { token: shop.owner.accessToken })).body.code).toBe(
        'validation_failed',
      );
    });

    it('a customer of two shops sees two separate accounts; neither shop sees the other', async () => {
      const a = await createShop(t, 'Shop A');
      const b = await createShop(t, 'Shop B');
      const phone = nextPhone();
      const atA = await invite(t, a, { phone });
      const atB = await invite(t, b, { phone });
      const customer = await acceptInvite(t, atA);

      const mine = await t.get('/v1/accounts?role=customer', { token: customer.accessToken });
      expect(
        mine.body.accounts
          .map((x: { shop: { name: string }; status: string }) => [x.shop.name, x.status])
          .sort(),
      ).toEqual([
        ['Shop A', 'active'],
        ['Shop B', 'pending'],
      ]);
      expect(
        (await t.get(`/v1/accounts/${atB.accountId}`, { token: a.owner.accessToken })).status,
      ).toBe(404);
      const aList = await t.get('/v1/accounts?role=merchant', { token: a.owner.accessToken });
      expect(aList.body.accounts.map((x: { id: string }) => x.id)).toEqual([atA.accountId]);
    });
  });

  describe('PATCH /v1/me', () => {
    it('sets name, language and calendar', async () => {
      const u = await login(t);
      const res = await t.patch(
        '/v1/me',
        { name: 'Hanna', language: 'am', calendar_pref: 'ethiopian' },
        { token: u.accessToken },
      );
      expect(res.body).toMatchObject({ name: 'Hanna', language: 'am', calendar_pref: 'ethiopian' });
    });
  });
});
