import { randomUUID } from 'node:crypto';
import { CURRENT_TERMS_VERSION } from '@mezgeb/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/db/schema.js';
import { login } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

describe('merchants and staff', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  const createBody = (id = randomUUID()) => ({
    id,
    shop_name: 'Tigist Mini Market',
    sub_city: 'Yeka',
    woreda: '08',
    landmark: 'Behind the condominium gate',
    default_detail_mode: 'detailed',
    terms_version: CURRENT_TERMS_VERSION,
  });

  describe('POST /v1/merchants', () => {
    it('creates the shop with the caller as owner', async () => {
      const owner = await login(t);
      const body = createBody();
      const res = await t.post('/v1/merchants', body, { token: owner.accessToken });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: body.id,
        shop_name: 'Tigist Mini Market',
        sub_city: 'Yeka',
        default_detail_mode: 'detailed',
        plan: 'free',
        role: 'owner',
      });
      const list = await t.get('/v1/merchants', { token: owner.accessToken });
      expect(list.body.merchants).toEqual([res.body]);
    });

    it('returns the original on an idempotent retry', async () => {
      const owner = await login(t);
      const body = createBody();
      const first = await t.post('/v1/merchants', body, { token: owner.accessToken });
      const retry = await t.post(
        '/v1/merchants',
        { ...body, shop_name: 'Changed' },
        { token: owner.accessToken },
      );
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);
    });

    it('allows one shop per owner', async () => {
      const owner = await login(t);
      const first = await t.post('/v1/merchants', createBody(), { token: owner.accessToken });
      const second = await t.post('/v1/merchants', createBody(), { token: owner.accessToken });
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({
        code: 'merchant_exists',
        details: { merchant_id: first.body.id },
      });
    });

    it("rejects another user's shop id", async () => {
      const a = await login(t);
      const b = await login(t);
      const body = createBody();
      await t.post('/v1/merchants', body, { token: a.accessToken });
      const res = await t.post('/v1/merchants', body, { token: b.accessToken });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('id_conflict');
    });

    it('requires the current terms version', async () => {
      const owner = await login(t);
      const res = await t.post(
        '/v1/merchants',
        { ...createBody(), terms_version: 'dube-2020-01' },
        { token: owner.accessToken },
      );
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'terms_outdated',
        details: { current_version: CURRENT_TERMS_VERSION },
      });
    });

    it('records the creation in the audit log', async () => {
      const shop = await createShop(t);
      const rows = await t
        .db!.db.select()
        .from(auditLog)
        .where(eq(auditLog.objectId, shop.merchantId));
      expect(rows.map((r) => r.action)).toContain('merchant.create');
    });
  });

  describe('PATCH /v1/merchants/:id', () => {
    it('lets the owner change the shop default detail mode', async () => {
      const shop = await createShop(t);
      const res = await t.patch(
        `/v1/merchants/${shop.merchantId}`,
        { default_detail_mode: 'detailed', landmark: 'Next to the pharmacy' },
        { token: shop.owner.accessToken },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        default_detail_mode: 'detailed',
        landmark: 'Next to the pharmacy',
      });
    });

    it('is forbidden for staff', async () => {
      const shop = await createShop(t);
      const staff = await addStaff(t, shop);
      const res = await t.patch(
        `/v1/merchants/${shop.merchantId}`,
        { shop_name: 'Mine now' },
        { token: staff.accessToken },
      );
      expect(res.status).toBe(403);
    });

    it('rejects an empty body', async () => {
      const shop = await createShop(t);
      const res = await t.patch(
        `/v1/merchants/${shop.merchantId}`,
        {},
        { token: shop.owner.accessToken },
      );
      expect(res.body.code).toBe('validation_failed');
    });
  });

  describe('staff (ADR-003: one owner, at most one staff)', () => {
    it('adds staff by phone; they see the shop with role staff', async () => {
      const shop = await createShop(t);
      const staff = await addStaff(t, shop);
      const mine = await t.get('/v1/merchants', { token: staff.accessToken });
      expect(mine.body.merchants).toEqual([
        expect.objectContaining({ id: shop.merchantId, role: 'staff' }),
      ]);

      const detail = await t.get(`/v1/merchants/${shop.merchantId}`, {
        token: shop.owner.accessToken,
      });
      expect(detail.body.staff.map((s: { role: string }) => s.role)).toEqual(['owner', 'staff']);
    });

    it('is idempotent for the same person', async () => {
      const shop = await createShop(t);
      const phone = nextPhone();
      const opts = { token: shop.owner.accessToken };
      const a = await t.post(`/v1/merchants/${shop.merchantId}/staff`, { phone }, opts);
      const b = await t.post(`/v1/merchants/${shop.merchantId}/staff`, { phone }, opts);
      expect(b.status).toBe(200);
      expect(b.body).toEqual(a.body);
    });

    it('rejects a second staff member', async () => {
      const shop = await createShop(t);
      await addStaff(t, shop);
      const res = await t.post(
        `/v1/merchants/${shop.merchantId}/staff`,
        { phone: nextPhone() },
        { token: shop.owner.accessToken },
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('staff_limit');
    });

    it('rejects the owner as staff', async () => {
      const shop = await createShop(t);
      const res = await t.post(
        `/v1/merchants/${shop.merchantId}/staff`,
        { phone: shop.owner.phone },
        { token: shop.owner.accessToken },
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_staff');
    });

    it("rejects one of the shop's customers as staff", async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop);
      const res = await t.post(
        `/v1/merchants/${shop.merchantId}/staff`,
        { phone: invited.phone },
        { token: shop.owner.accessToken },
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('staff_is_customer');
    });

    it('staff cannot add staff', async () => {
      const shop = await createShop(t);
      const staff = await addStaff(t, shop);
      const res = await t.post(
        `/v1/merchants/${shop.merchantId}/staff`,
        { phone: nextPhone() },
        { token: staff.accessToken },
      );
      expect(res.status).toBe(403);
    });

    it('removing staff ends their access on the next request', async () => {
      const shop = await createShop(t);
      const staff = await addStaff(t, shop);
      const invited = await invite(t, shop, { as: staff });
      expect(
        (await t.get(`/v1/accounts/${invited.accountId}`, { token: staff.accessToken })).status,
      ).toBe(200);

      const del = await t.delete(`/v1/merchants/${shop.merchantId}/staff/${staff.userId}`, {
        token: shop.owner.accessToken,
      });
      expect(del.status).toBe(204);

      // Same access token, no new login: the role is read per request.
      expect(
        (await t.get(`/v1/accounts/${invited.accountId}`, { token: staff.accessToken })).status,
      ).toBe(404);
      expect((await t.get('/v1/merchants', { token: staff.accessToken })).body.merchants).toEqual(
        [],
      );
      expect(
        (
          await t.delete(`/v1/merchants/${shop.merchantId}/staff/${staff.userId}`, {
            token: shop.owner.accessToken,
          })
        ).status,
      ).toBe(404);
    });

    it('the owner cannot be removed through the staff endpoint', async () => {
      const shop = await createShop(t);
      const res = await t.delete(`/v1/merchants/${shop.merchantId}/staff/${shop.owner.userId}`, {
        token: shop.owner.accessToken,
      });
      expect(res.status).toBe(404);
    });

    it('a person can be staff at one shop and a customer at another', async () => {
      const shopA = await createShop(t);
      const shopB = await createShop(t, 'Shop B');
      const staff = await addStaff(t, shopA);
      const invited = await invite(t, shopB, { phone: staff.phone });
      await acceptInvite(t, invited);
      const asCustomer = await t.get('/v1/accounts?role=customer', { token: staff.accessToken });
      expect(asCustomer.body.accounts).toHaveLength(1);
      const asMerchant = await t.get('/v1/merchants', { token: staff.accessToken });
      expect(asMerchant.body.merchants).toEqual([
        expect.objectContaining({ id: shopA.merchantId }),
      ]);
    });
  });
});
