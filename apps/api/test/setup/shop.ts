import { randomUUID } from 'node:crypto';
import { CURRENT_TERMS_VERSION } from '@mezgeb/shared';
import { type LoggedIn, login } from './auth.js';
import { nextPhone } from './fixtures.js';
import type { TestApp } from './test-app.js';

export interface Shop {
  owner: LoggedIn;
  merchantId: string;
  shopName: string;
}

/** Owner signs in and creates a shop through the API. */
export async function createShop(t: TestApp, shopName = 'Tigist Mini Market'): Promise<Shop> {
  const owner = await login(t);
  const merchantId = randomUUID();
  const res = await t.post(
    '/v1/merchants',
    { id: merchantId, shop_name: shopName, terms_version: CURRENT_TERMS_VERSION },
    { token: owner.accessToken },
  );
  if (res.status !== 201) throw new Error(`create shop failed: ${JSON.stringify(res.body)}`);
  return { owner, merchantId, shopName };
}

/** Owner adds a staff member by phone; the staff member then signs in. */
export async function addStaff(t: TestApp, shop: Shop): Promise<LoggedIn> {
  const phone = nextPhone();
  const res = await t.post(
    `/v1/merchants/${shop.merchantId}/staff`,
    { phone },
    { token: shop.owner.accessToken },
  );
  if (res.status !== 200) throw new Error(`add staff failed: ${JSON.stringify(res.body)}`);
  return login(t, { phone });
}

export interface Invited {
  accountId: string;
  phone: string;
}

/** Invites a customer by phone (as owner unless `as` is given). */
export async function invite(
  t: TestApp,
  shop: Shop,
  opts: { as?: LoggedIn; phone?: string; nickname?: string; language?: string } = {},
): Promise<Invited> {
  const phone = opts.phone ?? nextPhone();
  const accountId = randomUUID();
  const res = await t.post(
    '/v1/accounts',
    {
      id: accountId,
      merchant_id: shop.merchantId,
      phone,
      nickname: opts.nickname ?? 'Floor 4 Hanna',
      location_note: 'Block 12, floor 4',
      ...(opts.language && { language: opts.language }),
    },
    { token: (opts.as ?? shop.owner).accessToken },
  );
  if (res.status !== 201) throw new Error(`invite failed: ${JSON.stringify(res.body)}`);
  return { accountId, phone };
}

/** The invited customer signs in and accepts the terms. */
export async function acceptInvite(t: TestApp, invited: Invited): Promise<LoggedIn> {
  const customer = await login(t, { phone: invited.phone });
  const res = await t.post(
    `/v1/accounts/${invited.accountId}/accept`,
    { terms_version: CURRENT_TERMS_VERSION },
    { token: customer.accessToken },
  );
  if (res.status !== 200) throw new Error(`accept failed: ${JSON.stringify(res.body)}`);
  return customer;
}
