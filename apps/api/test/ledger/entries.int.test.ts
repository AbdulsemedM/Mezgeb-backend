import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogueItem, representative } from '../../src/db/schema.js';
import { login, newDevice } from '../setup/auth.js';
import {
  buy,
  correctionBody,
  nextDeviceSeq,
  postEntry,
  purchaseBody,
  signEntry,
} from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('ledger entries (M5, ADR-001, ADR-008)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  /** A shop with an active account and the customer signed in. */
  async function activeAccount() {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    return { shop, owner: shop.owner, accountId: invited.accountId, customer, invited };
  }

  describe('US-03: record a sale in simple or detailed mode', () => {
    it('simple mode: name and amount only; the chain and balance move', async () => {
      const { owner, accountId } = await activeAccount();
      const body = purchaseBody(t, owner, accountId, {
        amount: 3_500,
        lines: [
          { name: 'Bread', amount: 1_500 },
          { name: 'Oil', amount: 2_000 },
        ],
      });
      const res = await postEntry(t, owner, accountId, body);

      expect(res.status).toBe(201);
      expect(res.body.entry).toMatchObject({
        id: body.id,
        account_id: accountId,
        type: 'purchase',
        amount: 3_500,
        taken_by_type: 'customer',
        seq: 1,
        prev_hash: '0'.repeat(64),
        origin: 'device',
        device_id: owner.device.id,
        device_seq: body.device_seq,
        recorded_at: body.recorded_at,
        flags: [],
      });
      expect(res.body.entry.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.entry.lines).toEqual([
        expect.objectContaining({ line_no: 1, name: 'Bread', qty: null, amount: 1_500 }),
        expect.objectContaining({ line_no: 2, name: 'Oil', qty: null, amount: 2_000 }),
      ]);
      expect(res.body.head).toEqual({ seq: 1, hash: res.body.entry.hash });
      expect(res.body.balance_santim).toBe(3_500);

      const second = await buy(t, owner, accountId, { amount: 1_000 });
      expect(second.body.entry).toMatchObject({ seq: 2, prev_hash: res.body.entry.hash });
      expect(second.body.balance_santim).toBe(4_500);
    });

    it('detailed mode: the line total must be unit_price × qty, rounded half up', async () => {
      const { owner, accountId } = await activeAccount();
      const ok = await postEntry(
        t,
        owner,
        accountId,
        purchaseBody(t, owner, accountId, {
          amount: 4_500,
          lines: [{ name: 'Sugar', qty: '1.5', unit: 'kg', unit_price: 3_000, amount: 4_500 }],
        }),
      );
      expect(ok.status).toBe(201);
      expect(ok.body.entry.lines[0]).toMatchObject({ qty: '1.5', unit: 'kg', unit_price: 3_000 });

      const wrong = await postEntry(
        t,
        owner,
        accountId,
        purchaseBody(t, owner, accountId, {
          amount: 4_000,
          lines: [{ name: 'Sugar', qty: '1.5', unit: 'kg', unit_price: 3_000, amount: 4_000 }],
        }),
      );
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('validation_failed');
    });

    it('the amount must equal the sum of the lines', async () => {
      const { owner, accountId } = await activeAccount();
      const res = await postEntry(
        t,
        owner,
        accountId,
        purchaseBody(t, owner, accountId, {
          amount: 999,
          lines: [{ name: 'Bread', amount: 1_000 }],
        }),
      );
      expect(res.status).toBe(400);
    });

    it('the catalogue learns: a detailed line updates or creates the item and its last price', async () => {
      const { shop, owner, accountId } = await activeAccount();
      await buy(t, owner, accountId, {
        amount: 9_000,
        lines: [{ name: 'Eggs', qty: '6', unit: 'pc', unit_price: 1_500, amount: 9_000 }],
      });
      await buy(t, owner, accountId, {
        amount: 1_600,
        lines: [{ name: '  eggs ', qty: '1', unit: 'pc', unit_price: 1_600, amount: 1_600 }],
      });
      await buy(t, owner, accountId, { amount: 500, lines: [{ name: 'Matches', amount: 500 }] });

      const res = await t.get(`/v1/merchants/${shop.merchantId}/catalogue`, {
        token: owner.accessToken,
      });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        expect.objectContaining({ name: 'Eggs', unit: 'pc', last_price: 1_600 }),
      ]);
    });

    it('an item_id must be in this shop’s catalogue', async () => {
      const { owner, accountId } = await activeAccount();
      const other = await createShop(t, 'Other');
      const itemId = randomUUID();
      await t.db!.db.insert(catalogueItem).values({
        id: itemId,
        merchantId: other.merchantId,
        name: 'Foreign',
        createdBy: other.owner.userId,
      });
      const res = await postEntry(
        t,
        owner,
        accountId,
        purchaseBody(t, owner, accountId, {
          amount: 100,
          lines: [{ name: 'Foreign', amount: 100, item_id: itemId }],
        }),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_item');
    });
  });

  describe('US-04: who took the goods', () => {
    it('is required on a purchase', async () => {
      const { owner, accountId } = await activeAccount();
      const body = purchaseBody(t, owner, accountId);
      const res = await postEntry(t, owner, accountId, { ...body, taken_by_type: null });
      expect(res.status).toBe(400);
    });

    it('a representative must be listed on this account', async () => {
      const { owner, accountId } = await activeAccount();
      const other = await activeAccount();
      const repId = randomUUID();
      await t.db!.db.insert(representative).values({
        id: repId,
        accountId: other.accountId,
        name: 'Maid',
        relationship: 'maid',
        createdBy: other.customer.userId,
      });
      const res = await postEntry(
        t,
        owner,
        accountId,
        purchaseBody(t, owner, accountId, { takenBy: 'representative', representativeId: repId }),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_representative');
    });

    it('a listed representative is recorded', async () => {
      const { owner, accountId, customer } = await activeAccount();
      const repId = randomUUID();
      await t.db!.db.insert(representative).values({
        id: repId,
        accountId,
        name: 'Almaz',
        relationship: 'maid',
        createdBy: customer.userId,
      });
      const res = await buy(t, owner, accountId, {
        takenBy: 'representative',
        representativeId: repId,
      });
      expect(res.body.entry).toMatchObject({
        taken_by_type: 'representative',
        representative_id: repId,
      });
    });
  });

  describe('idempotency and integrity (ADR-001)', () => {
    it('a retry returns the original unchanged, with 200', async () => {
      const { owner, accountId } = await activeAccount();
      const body = purchaseBody(t, owner, accountId);
      const first = await postEntry(t, owner, accountId, body);
      const retry = await postEntry(t, owner, accountId, body);
      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      expect(retry.body.entry).toEqual(first.body.entry);
      expect(retry.body.head.seq).toBe(1);
    });

    it('the same id with different content is 409 id_conflict', async () => {
      const { owner, accountId } = await activeAccount();
      const body = purchaseBody(t, owner, accountId);
      await postEntry(t, owner, accountId, body);
      const other = purchaseBody(t, owner, accountId, { id: body.id, amount: 99 });
      const res = await postEntry(t, owner, accountId, other);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('id_conflict');
    });

    it('a reused device_seq with a new id is 409 device_seq_conflict', async () => {
      const { owner, accountId } = await activeAccount();
      const first = purchaseBody(t, owner, accountId);
      await postEntry(t, owner, accountId, first);
      const again = signEntry(owner.device, accountId, {
        ...first,
        id: randomUUID(),
        device_seq: first.device_seq,
      });
      const res = await postEntry(t, owner, accountId, again);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('device_seq_conflict');
    });

    it('a bad signature is rejected', async () => {
      const { owner, accountId } = await activeAccount();
      const body = purchaseBody(t, owner, accountId, { amount: 1_000 });
      const res = await postEntry(t, owner, accountId, { ...body, amount: 2_000 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_signature');
    });

    it('a signature by another key is rejected', async () => {
      const { owner, accountId } = await activeAccount();
      const body = signEntry(newDevice(), accountId, {
        ...purchaseBody(t, owner, accountId),
        device_id: owner.device.id,
      });
      const res = await postEntry(t, owner, accountId, body);
      expect(res.body.code).toBe('invalid_signature');
    });

    it('device_id must be the caller’s own device', async () => {
      const { owner, accountId } = await activeAccount();
      const otherPhone = await login(t, { phone: owner.phone });
      const body = purchaseBody(t, otherPhone, accountId);
      const res = await postEntry(t, owner, accountId, body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('device_mismatch');
    });

    it('recorded_at must be RFC 3339 UTC with milliseconds', async () => {
      const { owner, accountId } = await activeAccount();
      const body = purchaseBody(t, owner, accountId);
      const res = await postEntry(t, owner, accountId, {
        ...body,
        recorded_at: '2026-10-21T08:00:00Z',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('roles', () => {
    it('staff record purchases but see no balance', async () => {
      const { shop, accountId } = await activeAccount();
      const staff = await addStaff(t, shop);
      const res = await buy(t, staff, accountId);
      expect(res.body.entry.created_by).toBe(staff.userId);
      expect(res.body).not.toHaveProperty('balance_santim');
    });

    it('staff cannot record corrections; customers cannot record purchases', async () => {
      const { shop, owner, accountId, customer } = await activeAccount();
      const staff = await addStaff(t, shop);
      const original = await buy(t, owner, accountId);
      const correction = await postEntry(
        t,
        staff,
        accountId,
        correctionBody(t, staff, accountId, original.body.entry.id, -500),
      );
      expect(correction.status).toBe(403);
      const byCustomer = await postEntry(
        t,
        customer,
        accountId,
        purchaseBody(t, customer, accountId),
      );
      expect(byCustomer.status).toBe(403);
    });

    it('a stranger gets 404', async () => {
      const { accountId } = await activeAccount();
      const stranger = (await createShop(t, 'Elsewhere')).owner;
      const res = await postEntry(t, stranger, accountId, purchaseBody(t, stranger, accountId));
      expect(res.status).toBe(404);
    });
  });

  describe('corrections (LED-5)', () => {
    it('a negative correction references the original; the original stays', async () => {
      const { owner, accountId } = await activeAccount();
      const original = await buy(t, owner, accountId, { amount: 12_500 });
      const res = await postEntry(
        t,
        owner,
        accountId,
        correctionBody(
          t,
          owner,
          accountId,
          original.body.entry.id,
          -2_500,
          'Charged twice for oil',
        ),
      );
      expect(res.status).toBe(201);
      expect(res.body.entry).toMatchObject({
        type: 'correction',
        amount: -2_500,
        ref_entry_id: original.body.entry.id,
        reason: 'Charged twice for oil',
        seq: 2,
      });
      expect(res.body.balance_santim).toBe(10_000);

      const list = await t.get(`/v1/accounts/${accountId}/entries`, { token: owner.accessToken });
      expect(list.body.entries.map((e: { id: string }) => e.id)).toEqual([
        original.body.entry.id,
        res.body.entry.id,
      ]);
    });

    it('the referenced entry must be on the same account', async () => {
      const { owner, accountId } = await activeAccount();
      const elsewhere = await activeAccount();
      const foreign = await buy(t, elsewhere.owner, elsewhere.accountId);
      const res = await postEntry(
        t,
        owner,
        accountId,
        correctionBody(t, owner, accountId, foreign.body.entry.id, -100),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_ref_entry');
    });

    it('a correction needs a reason', async () => {
      const { owner, accountId } = await activeAccount();
      const original = await buy(t, owner, accountId);
      const body = signEntry(owner.device, accountId, {
        id: randomUUID(),
        type: 'correction',
        amount: -100,
        lines: [],
        ref_entry_id: original.body.entry.id,
        reason: null,
        device_id: owner.device.id,
        device_seq: nextDeviceSeq(owner.device),
        recorded_at: t.clock.now().toISOString(),
      });
      expect((await postEntry(t, owner, accountId, body)).status).toBe(400);
    });
  });

  describe('flags', () => {
    it('pending_acceptance while the customer has not accepted', async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop);
      const res = await buy(t, shop.owner, invited.accountId);
      expect(res.body.entry.flags).toEqual(['pending_acceptance']);
    });

    it('clock_skew when recorded_at is more than 10 minutes after received_at', async () => {
      const { owner, accountId } = await activeAccount();
      const future = new Date(t.clock.now().getTime() + 11 * 60_000);
      const res = await buy(t, owner, accountId, { recordedAt: future });
      expect(res.body.entry.flags).toEqual(['clock_skew']);
      const near = new Date(t.clock.now().getTime() + 9 * 60_000);
      expect((await buy(t, owner, accountId, { recordedAt: near })).body.entry.flags).toEqual([]);
    });
  });

  describe('GET /v1/accounts/:id/entries', () => {
    it('sorts by recorded_at, then seq, and filters by from/to', async () => {
      const { owner, accountId } = await activeAccount();
      const now = t.clock.now().getTime();
      const late = await buy(t, owner, accountId, { recordedAt: new Date(now - 60_000) });
      const early = await buy(t, owner, accountId, { recordedAt: new Date(now - 3_600_000) });
      const list = await t.get(`/v1/accounts/${accountId}/entries`, { token: owner.accessToken });
      expect(list.status).toBe(200);
      expect(list.body.entries.map((e: { seq: number }) => e.seq)).toEqual([
        early.body.entry.seq,
        late.body.entry.seq,
      ]);
      const from = new Date(now - 120_000).toISOString();
      const filtered = await t.get(
        `/v1/accounts/${accountId}/entries?from=${encodeURIComponent(from)}`,
        { token: owner.accessToken },
      );
      expect(filtered.body.entries.map((e: { id: string }) => e.id)).toEqual([late.body.entry.id]);
    });

    it('the customer sees the same entries', async () => {
      const { owner, accountId, customer } = await activeAccount();
      const sale = await buy(t, owner, accountId);
      const list = await t.get(`/v1/accounts/${accountId}/entries`, {
        token: customer.accessToken,
      });
      expect(list.body.entries).toEqual([sale.body.entry]);
    });
  });

  describe('notifications', () => {
    it('the customer gets a receipt with the new balance once the account is active', async () => {
      const { owner, accountId, invited } = await activeAccount();
      await buy(t, owner, accountId, { amount: 12_500 });
      await t.outbox.runOnce();
      expect(smsTo(t, invited.phone)).toContain('125.00');
    });

    it('no receipt before the customer accepts', async () => {
      const shop = await createShop(t);
      const invited = await invite(t, shop);
      await t.outbox.runOnce();
      const inviteSms = t.sms.lastTo(invited.phone);
      await buy(t, shop.owner, invited.accountId);
      await t.outbox.runOnce();
      expect(t.sms.lastTo(invited.phone)).toBe(inviteSms);
    });

    it('a correction tells the customer why', async () => {
      const { owner, accountId, invited } = await activeAccount();
      const sale = await buy(t, owner, accountId);
      await postEntry(
        t,
        owner,
        accountId,
        correctionBody(t, owner, accountId, sale.body.entry.id, -500, 'Wrong bread price'),
      );
      await t.outbox.runOnce();
      expect(smsTo(t, invited.phone)).toContain('Wrong bread price');
    });
  });

  it('every write is in the audit log', async () => {
    const { owner, accountId } = await activeAccount();
    const sale = await buy(t, owner, accountId);
    const { auditLog } = await import('../../src/db/schema.js');
    const rows = await t
      .db!.db.select()
      .from(auditLog)
      .where(eq(auditLog.objectId, sale.body.entry.id));
    expect(rows.map((r) => r.action)).toEqual(['entry.create']);
  });
});
