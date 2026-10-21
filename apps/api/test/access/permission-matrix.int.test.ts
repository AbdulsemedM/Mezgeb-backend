import { Controller, Get, Module } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountActionRequired, MerchantActionRequired } from '../../src/access/access.guards.js';
import {
  ACCOUNT_PERMISSIONS,
  type AccountAction,
  type AccountRole,
  MERCHANT_PERMISSIONS,
  type MerchantAction,
} from '../../src/access/permissions.js';
import type { LoggedIn } from '../setup/auth.js';
import { acceptInvite, addStaff, createShop, invite, type Shop } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/**
 * A test-only controller with one guarded route per action, built from the permission table,
 * so every action × role goes through the real guard and the real role resolution.
 */
function buildProbeModule() {
  class Probe {}
  const proto = Probe.prototype as unknown as Record<string, () => { ok: true }>;
  const decorate = (name: string, decorators: MethodDecorator[]) => {
    proto[name] = () => ({ ok: true });
    const desc = Object.getOwnPropertyDescriptor(proto, name)!;
    for (const d of decorators) d(proto, name, desc);
  };
  for (const action of Object.keys(ACCOUNT_PERMISSIONS) as AccountAction[]) {
    decorate(`account_${action}`, [Get(`accounts/:id/${action}`), AccountActionRequired(action)]);
  }
  for (const action of Object.keys(MERCHANT_PERMISSIONS) as MerchantAction[]) {
    decorate(`merchant_${action}`, [
      Get(`merchants/:id/${action}`),
      MerchantActionRequired(action),
    ]);
  }
  Controller('test-access')(Probe);
  @Module({ controllers: [Probe] })
  class ProbeModule {}
  return ProbeModule;
}

describe('permission matrix: every action × role through the guard', () => {
  let t: TestApp;
  let shop: Shop;
  let accountId: string;
  const callers: Record<'owner' | 'staff' | 'customer' | 'stranger', LoggedIn> = {} as never;

  beforeAll(async () => {
    t = await startTestApp({ imports: [buildProbeModule()] });
    shop = await createShop(t);
    callers.owner = shop.owner;
    callers.staff = await addStaff(t, shop);
    const invited = await invite(t, shop);
    accountId = invited.accountId;
    callers.customer = await acceptInvite(t, invited);
    // The stranger owns another shop: roles must not leak across shops.
    callers.stranger = (await createShop(t, 'Other Shop')).owner;
  });

  afterAll(async () => {
    await t?.close();
  });

  const accountCases = (Object.keys(ACCOUNT_PERMISSIONS) as AccountAction[]).flatMap((action) =>
    (['owner', 'staff', 'customer', 'stranger'] as const).map((who) => {
      const allowed = (ACCOUNT_PERMISSIONS[action] as readonly AccountRole[]).includes(
        who as AccountRole,
      );
      return { action, who, expected: who === 'stranger' ? 404 : allowed ? 200 : 403 };
    }),
  );

  it.each(accountCases)(
    'account $action as $who → $expected',
    async ({ action, who, expected }) => {
      const res = await t.get(`/v1/test-access/accounts/${accountId}/${action}`, {
        token: callers[who].accessToken,
      });
      expect(res.status).toBe(expected);
      if (expected === 403)
        expect(res.body).toMatchObject({ code: 'forbidden_for_role', details: { action } });
      if (expected === 404) expect(res.body.code).toBe('not_found');
    },
  );

  const merchantCases = (Object.keys(MERCHANT_PERMISSIONS) as MerchantAction[]).flatMap((action) =>
    (['owner', 'staff', 'customer', 'stranger'] as const).map((who) => {
      const roles = MERCHANT_PERMISSIONS[action] as readonly string[];
      // Customers and strangers have no role in the shop at all.
      const expected =
        who === 'customer' || who === 'stranger' ? 404 : roles.includes(who) ? 200 : 403;
      return { action, who, expected };
    }),
  );

  it.each(merchantCases)('shop $action as $who → $expected', async ({ action, who, expected }) => {
    const res = await t.get(`/v1/test-access/merchants/${shop.merchantId}/${action}`, {
      token: callers[who].accessToken,
    });
    expect(res.status).toBe(expected);
  });

  it('a malformed account id is 404, not 400 or 500', async () => {
    const res = await t.get('/v1/test-access/accounts/not-a-uuid/view_account', {
      token: callers.owner.accessToken,
    });
    expect(res.status).toBe(404);
  });

  it('an unknown account id is 404 for everyone', async () => {
    const res = await t.get(
      '/v1/test-access/accounts/01a15f64-b57c-7ca9-bda2-300e9c4914ae/view_account',
      { token: callers.owner.accessToken },
    );
    expect(res.status).toBe(404);
  });

  it('requires authentication before any role check', async () => {
    const res = await t.get(`/v1/test-access/accounts/${accountId}/view_account`);
    expect(res.status).toBe(401);
  });
});
