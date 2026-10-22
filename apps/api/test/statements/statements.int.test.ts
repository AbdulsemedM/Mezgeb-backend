import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessService } from '../../src/access/access.service.js';
import { displayDate, StatementsService } from '../../src/statements/statements.service.js';
import { buy, correctionBody, postEntry } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

describe('statement (M11, LED-7, US-14)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function account() {
    const shop = await createShop(t);
    const invited = await invite(t, shop, { nickname: 'Floor 4 Hanna' });
    const customer = await acceptInvite(t, invited);
    return { shop, owner: shop.owner, customer, accountId: invited.accountId };
  }

  const pdfPath = (accountId: string, from: string, to: string) =>
    `/v1/accounts/${accountId}/statement.pdf?from=${from}&to=${to}`;

  it('returns a PDF for the owner and the customer', async () => {
    const { owner, customer, accountId } = await account();
    await buy(t, owner, accountId, { amount: 4_500, lines: [{ name: 'Bread', amount: 4_500 }] });
    const today = new Date(t.clock.now().getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
    for (const user of [owner, customer]) {
      // Raw fetch: the test helper reads every body as JSON.
      const res = await fetch(`${t.baseUrl}${pdfPath(accountId, today, today)}`, {
        headers: { authorization: `Bearer ${user.accessToken}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/pdf');
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('staff cannot get statements (ADR-003)', async () => {
    const { shop, accountId } = await account();
    const staff = await addStaff(t, shop);
    const res = await t.get(pdfPath(accountId, '2026-10-01', '2026-10-31'), {
      token: staff.accessToken,
    });
    expect(res.status).toBe(403);
  });

  it('a period that ends before it starts is refused', async () => {
    const { owner, accountId } = await account();
    const res = await t.get(pdfPath(accountId, '2026-10-31', '2026-10-01'), {
      token: owner.accessToken,
    });
    expect(res.status).toBe(400);
  });

  it('opening balance, rows with running balance, closing balance and head', async () => {
    const { owner, customer, accountId } = await account();
    const statements = t.app.get(StatementsService);
    const accessService = t.app.get(AccessService);

    await buy(t, owner, accountId, { amount: 1_000, recordedAt: new Date('2026-10-01T09:00:00Z') });
    const sale = await buy(t, owner, accountId, {
      amount: 4_500,
      lines: [
        { name: 'Bread', amount: 2_000 },
        { name: 'Oil', amount: 2_500 },
      ],
      recordedAt: new Date('2026-10-10T09:00:00Z'),
    });
    const fix = correctionBody(t, owner, accountId, sale.body.entry.id, -500, 'Wrong price');
    await postEntry(t, owner, accountId, fix);

    const a = await accessService.requireAccount(owner.userId, accountId, 'view_statement');
    const s = await statements.build(a, owner.userId, '2026-10-05', '2026-10-31');
    expect(s.opening).toBe(1_000);
    expect(s.rows.map((r) => [r.amount, r.balance])).toEqual([
      [4_500, 5_500],
      [-500, 5_000],
    ]);
    expect(s.rows[0]!.what).toContain('Bread, Oil');
    expect(s.rows[1]!.what).toContain('Wrong price');
    expect(s.closing).toBe(5_000);
    expect(s.head?.seq).toBe(3);
    expect(s.customer).toContain('Floor 4 Hanna');

    // The customer's copy never carries the shop's nickname for them (rule 8).
    const c = await accessService.requireAccount(customer.userId, accountId, 'view_statement');
    const theirs = await statements.build(c, customer.userId, '2026-10-01', '2026-10-31');
    expect(theirs.customer).not.toContain('Floor 4 Hanna');
    expect(theirs.opening).toBe(0);
    expect(theirs.closing).toBe(5_000);
  });

  it('dates follow the reader’s calendar and language', () => {
    expect(displayDate('2026-10-22', 'en', 'gregorian')).toBe('22 Oct 2026');
    expect(displayDate('2026-10-22', 'en', 'ethiopian')).toBe('12 Tikimt 2019');
    expect(displayDate('2026-10-22', 'am', 'ethiopian')).toBe('ጥቅምት 12 2019 ዓ.ም.');
    expect(displayDate('2026-10-22', 'om', 'gregorian')).toBe('22/10/2026');
  });
});
