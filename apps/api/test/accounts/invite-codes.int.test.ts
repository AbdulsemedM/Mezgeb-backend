import { CURRENT_TERMS_VERSION } from '@mezgeb/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVITE_TTL_MS } from '../../src/accounts/accounts.service.js';
import { account, accountInvite } from '../../src/db/schema.js';
import { lastOtp, login, nextIp } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { createShop, invite } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/** ADR-016: invite short codes, the public resolver and pending invites after sign-in. */
describe('invite codes (ADR-016)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function codeFor(accountId: string): Promise<string> {
    const [row] = await t
      .db!.db.select()
      .from(accountInvite)
      .where(eq(accountInvite.accountId, accountId));
    return row!.code;
  }

  it('the invite SMS links to /i/<code> and the code resolves before sign-in', async () => {
    const shop = await createShop(t, 'Abebe Shop');
    const invited = await invite(t, shop, { language: 'om' });
    const code = await codeFor(invited.accountId);
    await t.outbox.runOnce();
    expect(t.sms.lastTo(invited.phone)?.text).toContain(`/i/${code}`);

    const res = await t.get(`/v1/invites/${code}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      code,
      account_id: invited.accountId,
      shop: { name: 'Abebe Shop' },
      language: 'om',
      state: 'open',
      expires_at: new Date(t.clock.now().getTime() + INVITE_TTL_MS).toISOString(),
    });
  });

  it('never shows the phone, nickname or balance', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop, { nickname: 'Secret nickname' });
    const res = await t.get(`/v1/invites/${await codeFor(invited.accountId)}`);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('Secret nickname');
    expect(json).not.toContain(invited.phone.slice(4));
    expect(json).not.toContain('balance');
  });

  it('accepts the code in lower case and with a dash', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const code = await codeFor(invited.accountId);
    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
    expect((await t.get(`/v1/invites/${typed}`)).body.code).toBe(code);
  });

  it('unknown and malformed codes are 404', async () => {
    for (const code of ['ZZZZZZZZ', 'not-a-code', '00000000']) {
      const res = await t.get(`/v1/invites/${code}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('invite_not_found');
    }
  });

  it('expires after 14 days, but the account can still be accepted after sign-in', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const code = await codeFor(invited.accountId);
    t.clock.advance(INVITE_TTL_MS + 1);
    expect((await t.get(`/v1/invites/${code}`)).body.state).toBe('expired');

    const customer = await login(t, { phone: invited.phone });
    const pending = await t.get('/v1/accounts?role=customer', { token: customer.accessToken });
    expect(pending.body.accounts).toEqual([
      expect.objectContaining({ id: invited.accountId, status: 'pending' }),
    ]);
    const accepted = await t.post(
      `/v1/accounts/${invited.accountId}/accept`,
      { terms_version: CURRENT_TERMS_VERSION },
      { token: customer.accessToken },
    );
    expect(accepted.status).toBe(200);
    expect((await t.get(`/v1/invites/${code}`)).body.state).toBe('accepted');
  });

  it('shows a closed account as closed', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    await t
      .db!.db.update(account)
      .set({ status: 'closed' })
      .where(eq(account.id, invited.accountId));
    expect((await t.get(`/v1/invites/${await codeFor(invited.accountId)}`)).body.state).toBe(
      'closed',
    );
  });

  it('after sign-in, every pending invite for the phone is listed (no stored code needed)', async () => {
    const a = await createShop(t, 'Shop A');
    const b = await createShop(t, 'Shop B');
    const first = await invite(t, a);
    await invite(t, b, { phone: first.phone });

    const customer = await login(t, { phone: first.phone });
    const res = await t.get('/v1/accounts?role=customer', { token: customer.accessToken });
    expect(res.body.accounts.map((x: { shop: { name: string } }) => x.shop.name).sort()).toEqual([
      'Shop A',
      'Shop B',
    ]);
    expect(res.body.accounts.every((x: { status: string }) => x.status === 'pending')).toBe(true);
  });

  it('the OTP SMS ends with the WebOTP line for the PWA host', async () => {
    const phone = nextPhone();
    await t.post('/v1/auth/otp', { phone }, { ip: nextIp() });
    const text = t.sms.lastTo(phone)!.text;
    expect(text.split('\n').at(-1)).toBe(`@localhost:5173 #${lastOtp(t, phone)}`);
  });
});
