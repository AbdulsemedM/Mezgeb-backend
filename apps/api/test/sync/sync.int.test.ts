import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PG_POOL } from '../../src/db/db.module.js';
import type { LoggedIn } from '../setup/auth.js';
import { purchaseBody } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite, type Shop } from '../setup/shop.js';
import { type ApiResponse, startTestApp, type TestApp } from '../setup/test-app.js';

interface SyncBody {
  results: { op: string; id: string; status: 'ok' | 'error'; code?: string; result?: any }[];
  changes: {
    accounts: any[];
    entries: any[];
    representatives: any[];
    disputes: any[];
    limits: any[];
    catalogue: any[];
    merchants: any[];
  };
  deleted: { limits: { account_id: string; side: string }[] };
  heads: { account_id: string; seq: number; hash: string }[];
  memberships: {
    merchants: { id: string; role: string }[];
    accounts: { id: string; role: string }[];
  };
  cursor: string;
  has_more: boolean;
}

describe('POST /v1/sync (M7, ADR-010)', () => {
  let t: TestApp;

  // Own Postgres: pulls read only transactions older than every one still running on the
  // server (ADR-010), and other test files' transactions would hold that back.
  beforeAll(async () => {
    t = await startTestApp({ ownContainer: true });
  });

  afterAll(async () => {
    await t?.close();
  });

  const sync = (
    user: LoggedIn,
    body: { cursor?: string; writes?: { op: string; body: unknown }[]; page_size?: number } = {},
  ): Promise<ApiResponse<SyncBody>> => t.post('/v1/sync', body, { token: user.accessToken });

  /** Syncs until has_more is false, collecting every page. */
  async function pullAll(user: LoggedIn, cursor = '0', pageSize?: number) {
    const pages: SyncBody[] = [];
    for (;;) {
      const res = await sync(user, { cursor, page_size: pageSize });
      expect(res.status).toBe(200);
      pages.push(res.body);
      cursor = res.body.cursor;
      if (!res.body.has_more) return { pages, cursor };
    }
  }

  interface Shopfront {
    shop: Shop;
    owner: LoggedIn;
    staff: LoggedIn;
    customer: LoggedIn;
    accountId: string;
  }

  async function shopfront(): Promise<Shopfront> {
    const shop = await createShop(t);
    const staff = await addStaff(t, shop);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    return { shop, owner: shop.owner, staff, customer, accountId: invited.accountId };
  }

  const entryWrite = (
    user: LoggedIn,
    accountId: string,
    o: Parameters<typeof purchaseBody>[3] = {},
  ) => ({
    op: 'entry.create',
    body: { account_id: accountId, ...purchaseBody(t, user, accountId, o) },
  });

  describe('done when: owner and staff record offline, then sync in either order', () => {
    async function scenario(order: 'owner-first' | 'staff-first') {
      const f = await shopfront();
      await t.put(
        `/v1/accounts/${f.accountId}/limits/merchant`,
        { value: 30_000 },
        { token: f.owner.accessToken },
      );
      const base = t.clock.now().getTime() - 3_600_000;
      const at = (minutes: number) => new Date(base + minutes * 60_000);
      // Both phones were offline for an hour, recording interleaved sales.
      const ownerWrites = [
        entryWrite(f.owner, f.accountId, { amount: 10_000, recordedAt: at(1) }),
        entryWrite(f.owner, f.accountId, { amount: 5_000, recordedAt: at(30) }),
      ];
      // The staff sale goes over the limit without a reason: offline, never refused (rule 6).
      const staffWrites = [
        entryWrite(f.staff, f.accountId, { amount: 4_000, recordedAt: at(10) }),
        entryWrite(f.staff, f.accountId, { amount: 20_000, recordedAt: at(40) }),
      ];
      const batches =
        order === 'owner-first'
          ? [[f.owner, ownerWrites] as const, [f.staff, staffWrites] as const]
          : [[f.staff, staffWrites] as const, [f.owner, ownerWrites] as const];
      for (const [user, writes] of batches) {
        const res = await sync(user, { writes });
        expect(res.status).toBe(200);
        expect(res.body.results.map((r) => r.status)).toEqual(['ok', 'ok']);
      }
      const verify = await t.get(`/v1/accounts/${f.accountId}/chain/verify`, {
        token: f.owner.accessToken,
      });
      expect(verify.body).toMatchObject({ ok: true, checked: 4 });

      // What both phones end up with after pulling.
      const owner = await pullAll(f.owner);
      const staff = await pullAll(f.staff);
      const ledger = (pages: SyncBody[]) =>
        pages
          .flatMap((p) => p.changes.entries)
          .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
          .map((e) => ({ amount: e.amount, recorded_at: e.recorded_at, flags: e.flags }));
      expect(ledger(staff.pages)).toEqual(ledger(owner.pages));
      const balance = owner.pages.flatMap((p) => p.changes.accounts).at(-1).balance_santim;
      return {
        ledger: ledger(owner.pages).map((e) => ({ ...e, recorded_at: e.recorded_at.slice(-13) })),
        balance,
      };
    }

    it('gives the same ledger, balance and a valid chain either way', async () => {
      const a = await scenario('owner-first');
      const b = await scenario('staff-first');
      expect(a.balance).toBe(39_000);
      expect(b.balance).toBe(a.balance);
      expect(b.ledger.map((e) => e.amount)).toEqual(a.ledger.map((e) => e.amount));
      // Flags depend on seq order (when the limit was crossed), the amounts and balance do not.
      expect(a.ledger.some((e) => e.flags.includes('over_limit_override'))).toBe(true);
    });
  });

  it('partial failure: a bad write fails alone, the others commit', async () => {
    const f = await shopfront();
    const good1 = entryWrite(f.owner, f.accountId, { amount: 100 });
    const bad = entryWrite(f.owner, f.accountId, { amount: 200 });
    (bad.body as { amount: number }).amount = 999; // signature no longer matches
    const good2 = entryWrite(f.owner, f.accountId, { amount: 300 });
    const res = await sync(f.owner, { writes: [good1, bad, good2] });
    expect(res.body.results.map((r) => [r.status, r.code])).toEqual([
      ['ok', undefined],
      ['error', 'invalid_signature'],
      ['ok', undefined],
    ]);
    expect(res.body.results[0]!.result.entry.seq).toBe(1);
    expect(res.body.results[2]!.result.entry.seq).toBe(2);
  });

  it('a malformed write is a validation error for that write only', async () => {
    const f = await shopfront();
    const res = await sync(f.owner, {
      writes: [{ op: 'entry.create', body: { account_id: f.accountId, amount: 'lots' } }],
    });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ status: 'error', code: 'validation_failed' });
  });

  it('a retried batch returns the same results and creates nothing twice', async () => {
    const f = await shopfront();
    const writes = [entryWrite(f.owner, f.accountId), entryWrite(f.owner, f.accountId)];
    const first = await sync(f.owner, { writes });
    const again = await sync(f.owner, { writes });
    expect(again.body.results.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(again.body.results.map((r) => r.result.entry.hash)).toEqual(
      first.body.results.map((r) => r.result.entry.hash),
    );
    const list = await t.get(`/v1/accounts/${f.accountId}/entries`, { token: f.owner.accessToken });
    expect(list.body.entries).toHaveLength(2);
  });

  describe('what each role receives', () => {
    it('owner: balances, limits, catalogue, shop; heads for touched accounts', async () => {
      const f = await shopfront();
      await t.put(
        `/v1/accounts/${f.accountId}/limits/merchant`,
        { value: 50_000 },
        { token: f.owner.accessToken },
      );
      await sync(f.owner, {
        writes: [
          entryWrite(f.owner, f.accountId, {
            amount: 3_000,
            lines: [{ name: 'Sugar', qty: '1', unit: 'kg', unit_price: 3_000, amount: 3_000 }],
          }),
        ],
      });
      const { pages } = await pullAll(f.owner);
      const changes = pages.flatMap((p) => p.changes.accounts);
      expect(changes.at(-1)).toMatchObject({
        id: f.accountId,
        balance_santim: 3_000,
        nickname: 'Floor 4 Hanna',
      });
      expect(pages.flatMap((p) => p.changes.limits)).toEqual([
        expect.objectContaining({ account_id: f.accountId, side: 'merchant', value: 50_000 }),
      ]);
      expect(pages.flatMap((p) => p.changes.catalogue).map((c) => c.name)).toEqual(['Sugar']);
      expect(pages.flatMap((p) => p.changes.merchants)[0]).toMatchObject({
        id: f.shop.merchantId,
        role: 'owner',
      });
      const head = pages.flatMap((p) => p.heads).find((h) => h.account_id === f.accountId);
      expect(head).toMatchObject({ seq: 1 });
      expect(pages[0]!.memberships.merchants).toEqual([{ id: f.shop.merchantId, role: 'owner' }]);
    });

    it('staff: entries but no balance and no limits (ADR-003)', async () => {
      const f = await shopfront();
      await t.put(
        `/v1/accounts/${f.accountId}/limits/merchant`,
        { value: 50_000 },
        { token: f.owner.accessToken },
      );
      await sync(f.owner, { writes: [entryWrite(f.owner, f.accountId)] });
      const { pages } = await pullAll(f.staff);
      expect(pages.flatMap((p) => p.changes.entries)).toHaveLength(1);
      for (const a of pages.flatMap((p) => p.changes.accounts))
        expect(a).not.toHaveProperty('balance_santim');
      expect(pages.flatMap((p) => p.changes.limits)).toEqual([]);
    });

    it('customer: own account without the shop’s notes, no catalogue, no other customers', async () => {
      const f = await shopfront();
      const other = await invite(t, f.shop);
      await sync(f.owner, {
        writes: [
          entryWrite(f.owner, f.accountId, {
            amount: 3_000,
            lines: [{ name: 'Rice', qty: '1', unit: 'kg', unit_price: 3_000, amount: 3_000 }],
          }),
        ],
      });
      const { pages } = await pullAll(f.customer);
      const accounts = pages.flatMap((p) => p.changes.accounts);
      expect(new Set(accounts.map((a) => a.id))).toEqual(new Set([f.accountId]));
      expect(accounts.some((a) => a.id === other.accountId)).toBe(false);
      for (const a of accounts) {
        expect(a).not.toHaveProperty('nickname');
        expect(a).not.toHaveProperty('location_note');
      }
      expect(pages.flatMap((p) => p.changes.catalogue)).toEqual([]);
      expect(pages.flatMap((p) => p.changes.merchants)).toEqual([]);
      expect(pages[0]!.memberships.accounts).toEqual([{ id: f.accountId, role: 'customer' }]);
    });
  });

  it('a cursor returns only what changed since', async () => {
    const f = await shopfront();
    const { cursor } = await pullAll(f.owner);
    const empty = await sync(f.owner, { cursor });
    expect(empty.body.changes.entries).toEqual([]);
    await sync(f.staff, { writes: [entryWrite(f.staff, f.accountId, { amount: 777 })] });
    const next = await sync(f.owner, { cursor });
    expect(next.body.changes.entries.map((e) => e.amount)).toEqual([777]);
  });

  it('pages: has_more until everything is delivered, nothing twice', async () => {
    const f = await shopfront();
    await sync(f.owner, {
      writes: Array.from({ length: 7 }, (_, i) =>
        entryWrite(f.owner, f.accountId, { amount: 100 + i }),
      ),
    });
    const { pages } = await pullAll(f.owner, '0', 3);
    expect(pages.length).toBeGreaterThan(2);
    const ids = pages.flatMap((p) => p.changes.entries.map((e) => e.id));
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
  });

  it('a transaction that commits late is still delivered (ADR-010)', async () => {
    const f = await shopfront();
    const { cursor } = await pullAll(f.owner);
    // A slow transaction starts first and stays open…
    const slow = await t.app.get<pg.Pool>(PG_POOL).connect();
    const itemId = randomUUID();
    try {
      await slow.query('BEGIN');
      await slow.query(
        `INSERT INTO catalogue_item (id, merchant_id, name, created_by) VALUES ($1, $2, 'Late item', $3)`,
        [itemId, f.shop.merchantId, f.owner.userId],
      );
      // …while a later write commits and is pulled.
      await sync(f.staff, { writes: [entryWrite(f.staff, f.accountId, { amount: 555 })] });
      const during = await sync(f.owner, { cursor });
      expect(during.body.changes.catalogue).toEqual([]);
      await slow.query('COMMIT');
      const after = await pullAll(f.owner, during.body.cursor);
      const delivered = [during.body, ...after.pages];
      expect(delivered.flatMap((p) => p.changes.catalogue).map((c) => c.id)).toEqual([itemId]);
      expect(delivered.flatMap((p) => p.changes.entries).map((e) => e.amount)).toEqual([555]);
    } finally {
      slow.release();
    }
  });

  it('a removed staff member no longer has the shop in memberships', async () => {
    const f = await shopfront();
    await t.delete(`/v1/merchants/${f.shop.merchantId}/staff/${f.staff.userId}`, {
      token: f.owner.accessToken,
    });
    const res = await sync(f.staff);
    expect(res.body.memberships.merchants).toEqual([]);
  });

  describe('other writes', () => {
    it('account.create and account.update', async () => {
      const shop = await createShop(t);
      const id = randomUUID();
      const res = await sync(shop.owner, {
        writes: [
          { op: 'account.create', body: { id, merchant_id: shop.merchantId, phone: '0912345000' } },
          { op: 'account.update', body: { id, nickname: 'Corner house' } },
        ],
      });
      expect(res.body.results.map((r) => r.status)).toEqual(['ok', 'ok']);
      expect(res.body.results[1]!.result).toMatchObject({
        id,
        nickname: 'Corner house',
        status: 'pending',
      });
    });

    it('representative writes by the customer', async () => {
      const f = await shopfront();
      const repId = randomUUID();
      const res = await sync(f.customer, {
        writes: [
          {
            op: 'representative.create',
            body: { account_id: f.accountId, id: repId, name: 'Almaz', relationship: 'maid' },
          },
          { op: 'representative.update', body: { id: repId, name: 'Almaz T.' } },
          { op: 'representative.status', body: { id: repId, status: 'paused' } },
        ],
      });
      expect(res.body.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
      const owner = await pullAll(f.owner);
      expect(owner.pages.flatMap((p) => p.changes.representatives).at(-1)).toMatchObject({
        id: repId,
        name: 'Almaz T.',
        status: 'paused',
      });
    });

    it('limit.set and limit.delete; a deleted limit is reported as deleted', async () => {
      const f = await shopfront();
      const { cursor } = await pullAll(f.owner);
      await sync(f.customer, {
        writes: [
          { op: 'limit.set', body: { account_id: f.accountId, side: 'customer', value: 80_000 } },
        ],
      });
      const set = await sync(f.owner, { cursor });
      expect(set.body.changes.limits).toEqual([
        expect.objectContaining({ side: 'customer', value: 80_000 }),
      ]);
      await sync(f.customer, {
        writes: [{ op: 'limit.delete', body: { account_id: f.accountId, side: 'customer' } }],
      });
      const removed = await sync(f.owner, { cursor: set.body.cursor });
      expect(removed.body.deleted.limits).toEqual([{ account_id: f.accountId, side: 'customer' }]);
    });

    it('dispute.create by the customer', async () => {
      const f = await shopfront();
      const sale = await sync(f.owner, { writes: [entryWrite(f.owner, f.accountId)] });
      const entryId = sale.body.results[0]!.result.entry.id;
      const res = await sync(f.customer, {
        writes: [
          { op: 'dispute.create', body: { entry_id: entryId, id: randomUUID(), reason: 'Not me' } },
        ],
      });
      expect(res.body.results[0]).toMatchObject({
        status: 'ok',
        result: { entry_id: entryId, status: 'open' },
      });
    });

    it('a write the role may not do is an error for that write', async () => {
      const f = await shopfront();
      const res = await sync(f.staff, {
        writes: [
          { op: 'limit.set', body: { account_id: f.accountId, side: 'merchant', value: 1_000 } },
        ],
      });
      expect(res.body.results[0]).toMatchObject({ status: 'error', code: 'forbidden_for_role' });
    });
  });

  it('change_log rows come from triggers in the writing transaction', async () => {
    const f = await shopfront();
    await sync(f.owner, { writes: [entryWrite(f.owner, f.accountId)] });
    const rows = await t.app
      .get<pg.Pool>(PG_POOL)
      .query<{ object_type: string }>(
        'SELECT object_type FROM change_log WHERE account_id = $1 ORDER BY id',
        [f.accountId],
      );
    expect(rows.rows.map((r) => r.object_type)).toContain('entry');
  });
});
