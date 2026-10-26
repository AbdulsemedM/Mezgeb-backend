import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limitRaise } from '../../src/db/schema.js';
import {
  RAISE_CODE_TTL_MS,
  RAISE_MAX_ATTEMPTS,
  RAISE_RESEND_AFTER_MS,
  RAISE_VALID_MS,
} from '../../src/ledger/raises.service.js';
import { login } from '../setup/auth.js';
import { buy, postEntry, purchaseBody } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('one-time raise over the hard stop (ADR-011, LIM-3)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  /** An active account whose customer set a 100 ETB hard stop, with 90 ETB already owed. */
  async function hardStopAccount() {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    const accountId = invited.accountId;
    await t.put(
      `/v1/accounts/${accountId}/limits/customer`,
      { value: 10_000, mode: 'hard_stop' },
      { token: customer.accessToken },
    );
    await buy(t, shop.owner, accountId, { amount: 9_000 });
    return { shop, owner: shop.owner, customer, accountId, phone: invited.phone };
  }

  const requestRaise = (token: string, accountId: string, amount: number, id = randomUUID()) =>
    t.post(`/v1/accounts/${accountId}/raises`, { id, amount }, { token });

  const approve = (token: string, accountId: string, raiseId: string, code?: string) =>
    t.post(`/v1/accounts/${accountId}/raises/${raiseId}/approve`, code ? { code } : {}, {
      token,
    });

  /** The code in the last raise SMS to `phone`. */
  function codeFor(phone: string): string {
    const texts = smsTo(t, phone).match(/\b\d{6}\b/g);
    if (!texts) throw new Error('no code sent');
    return texts.at(-1)!;
  }

  it('the shop asks, the customer gets a code by SMS, the code approves, the sale posts', async () => {
    const { owner, accountId, phone } = await hardStopAccount();
    const asked = await requestRaise(owner.accessToken, accountId, 2_000);
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: 'pending', amount: 2_000, valid_until: null });
    expect(smsTo(t, phone)).toContain('Tigist Mini Market');
    expect(smsTo(t, phone)).toContain('20.00');

    const approved = await approve(owner.accessToken, accountId, asked.body.id, codeFor(phone));
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');

    const sale = await buy(t, owner, accountId, { amount: 3_000 });
    expect(sale.body.entry.flags).not.toContain('over_hard_stop');
    const [row] = await t.db!.db.select().from(limitRaise).where(eq(limitRaise.id, asked.body.id));
    expect(row).toMatchObject({ status: 'used', usedByEntryId: sale.body.entry.id });

    // Used once: the next sale over the hard stop is refused again.
    const next = await postEntry(t, owner, accountId, purchaseBody(t, owner, accountId));
    expect(next.body.code).toBe('limit_hard_stop');
  });

  it('ADR-016: the customer sees the waiting request and approves it without a code', async () => {
    const { owner, customer, accountId } = await hardStopAccount();
    const asked = await requestRaise(owner.accessToken, accountId, 2_000);

    const listed = await t.get(`/v1/accounts/${accountId}/raises`, { token: customer.accessToken });
    expect(listed.status).toBe(200);
    expect(listed.body.raises).toEqual([
      expect.objectContaining({ id: asked.body.id, amount: 2_000, status: 'pending' }),
    ]);
    // The shop sees it too (it asked); a stranger gets 404 (IDOR test).
    expect(
      (await t.get(`/v1/accounts/${accountId}/raises`, { token: owner.accessToken })).status,
    ).toBe(200);

    const approved = await approve(customer.accessToken, accountId, asked.body.id);
    expect(approved.body.status).toBe('approved');
    // Approved or expired requests no longer wait.
    expect(
      (await t.get(`/v1/accounts/${accountId}/raises`, { token: customer.accessToken })).body
        .raises,
    ).toEqual([]);
  });

  it('ADR-016: an expired request is not listed', async () => {
    const { owner, accountId, phone } = await hardStopAccount();
    await requestRaise(owner.accessToken, accountId, 2_000);
    t.clock.advance(RAISE_CODE_TTL_MS + 1);
    // The 15-minute access token expired with the clock: sign in again.
    const customer = await login(t, { phone });
    const listed = await t.get(`/v1/accounts/${accountId}/raises`, { token: customer.accessToken });
    expect(listed.status).toBe(200);
    expect(listed.body.raises).toEqual([]);
  });

  it('a sale beyond the approved amount is still refused, and the raise stays', async () => {
    const { owner, accountId, phone } = await hardStopAccount();
    const asked = await requestRaise(owner.accessToken, accountId, 1_000);
    await approve(owner.accessToken, accountId, asked.body.id, codeFor(phone));
    const tooMuch = await postEntry(
      t,
      owner,
      accountId,
      purchaseBody(t, owner, accountId, { amount: 5_000 }),
    );
    expect(tooMuch.body.code).toBe('limit_hard_stop');
    await buy(t, owner, accountId, { amount: 2_000 });
  });

  it('offline (sync) sales use the raise too instead of being flagged', async () => {
    const { owner, accountId, phone } = await hardStopAccount();
    const asked = await requestRaise(owner.accessToken, accountId, 2_000);
    await approve(owner.accessToken, accountId, asked.body.id, codeFor(phone));
    const body = purchaseBody(t, owner, accountId, { amount: 3_000 });
    const res = await t.post(
      '/v1/sync',
      { cursor: '0', writes: [{ op: 'entry.create', body: { ...body, account_id: accountId } }] },
      { token: owner.accessToken },
    );
    expect(res.body.results[0]).toMatchObject({ status: 'ok' });
    expect(res.body.results[0].result.entry.flags).not.toContain('over_hard_stop');
  });

  it('staff can ask and approve; the customer approves without a code', async () => {
    const { shop, customer, accountId } = await hardStopAccount();
    const staff = await addStaff(t, shop);
    const asked = await requestRaise(staff.accessToken, accountId, 2_000);
    expect(asked.status).toBe(201);
    const approved = await approve(customer.accessToken, accountId, asked.body.id);
    expect(approved.body.status).toBe('approved');
    const [row] = await t.db!.db.select().from(limitRaise).where(eq(limitRaise.id, asked.body.id));
    expect(row!.approvedVia).toBe('app');
  });

  it('the customer cannot ask for a raise on their own account', async () => {
    const { customer, accountId } = await hardStopAccount();
    const res = await requestRaise(customer.accessToken, accountId, 2_000);
    expect(res.status).toBe(403);
  });

  it('the shop needs the code', async () => {
    const { owner, accountId } = await hardStopAccount();
    const asked = await requestRaise(owner.accessToken, accountId, 2_000);
    const res = await approve(owner.accessToken, accountId, asked.body.id);
    expect(res.body.code).toBe('code_required');
  });

  it('wrong codes count down, then lock the request', async () => {
    const { owner, accountId, phone } = await hardStopAccount();
    const asked = await requestRaise(owner.accessToken, accountId, 2_000);
    const right = codeFor(phone);
    const wrong = right === '000000' ? '111111' : '000000';
    const first = await approve(owner.accessToken, accountId, asked.body.id, wrong);
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({
      code: 'raise_code_invalid',
      details: { attempts_left: RAISE_MAX_ATTEMPTS - 1 },
    });
    for (let i = 1; i < RAISE_MAX_ATTEMPTS - 1; i++) {
      await approve(owner.accessToken, accountId, asked.body.id, wrong);
    }
    const last = await approve(owner.accessToken, accountId, asked.body.id, wrong);
    expect(last.body.code).toBe('raise_code_locked');
    const after = await approve(owner.accessToken, accountId, asked.body.id, right);
    expect(after.body.code).toBe('raise_expired');
  });

  it('the code expires', async () => {
    const { shop, owner, accountId, phone } = await hardStopAccount();
    const asked = await requestRaise(owner.accessToken, accountId, 2_000);
    // Access tokens live 15 minutes too: a colleague signs in again just before.
    const staff = await addStaff(t, shop);
    t.clock.advance(RAISE_CODE_TTL_MS - 60_000);
    const fresh = await login(t, { phone: staff.phone, device: staff.device });
    t.clock.advance(60_000);
    const res = await approve(fresh.accessToken, accountId, asked.body.id, codeFor(phone));
    expect(res.body.code).toBe('raise_expired');
  });

  it('an approved raise is only good for a while', async () => {
    const { shop, owner, accountId, phone } = await hardStopAccount();
    const asked = await requestRaise(owner.accessToken, accountId, 2_000);
    await approve(owner.accessToken, accountId, asked.body.id, codeFor(phone));
    const staff = await addStaff(t, shop);
    t.clock.advance(RAISE_VALID_MS - 60_000);
    const fresh = await login(t, { phone: staff.phone, device: staff.device });
    t.clock.advance(60_000);
    const late = await postEntry(
      t,
      fresh,
      accountId,
      purchaseBody(t, fresh, accountId, { amount: 3_000 }),
    );
    expect(late.body.code).toBe('limit_hard_stop');
  });

  it('retrying the same request sends no second SMS; a new one replaces the old', async () => {
    const { owner, accountId, phone } = await hardStopAccount();
    const id = randomUUID();
    await requestRaise(owner.accessToken, accountId, 2_000, id);
    const before = t.sms.sent.filter((m) => m.to === phone).length;
    const again = await requestRaise(owner.accessToken, accountId, 2_000, id);
    expect(again.status).toBe(200);
    expect(t.sms.sent.filter((m) => m.to === phone)).toHaveLength(before);

    const tooSoon = await requestRaise(owner.accessToken, accountId, 2_000);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe('raise_rate_limited');

    t.clock.advance(RAISE_RESEND_AFTER_MS);
    const second = await requestRaise(owner.accessToken, accountId, 3_000);
    expect(second.status).toBe(201);
    const [old] = await t.db!.db.select().from(limitRaise).where(eq(limitRaise.id, id));
    expect(old!.status).toBe('expired');
  });

  it('only a customer hard stop can be raised', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    await acceptInvite(t, invited);
    const res = await requestRaise(shop.owner.accessToken, invited.accountId, 2_000);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_hard_stop');
  });
});
