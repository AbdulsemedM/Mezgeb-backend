import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema.js';
import { createTestDb, type TestDb } from '../setup/db.js';
import { pgError, purchase, seedAccount, type SeededAccount } from '../setup/fixtures.js';

/** ADR-001 chain constraints and ADR-004 entry shape rules. */
describe('entry constraints', () => {
  let t: TestDb;
  let a: SeededAccount;
  let repId: string;

  const insert = (row: typeof s.entry.$inferInsert) => t.db.insert(s.entry).values(row);
  const rejects = async (row: typeof s.entry.$inferInsert, constraint: string, code = '23514') => {
    const err = await pgError(() => insert(row));
    expect(err.code).toBe(code);
    expect(err.constraint).toBe(constraint);
  };

  beforeAll(async () => {
    t = await createTestDb();
    a = await seedAccount(t.db);
    repId = randomUUID();
    await t.db.insert(s.representative).values({
      id: repId,
      accountId: a.accountId,
      name: 'Almaz',
      relationship: 'maid',
      createdBy: a.customerId,
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('accepts', () => {
    it('a device-origin purchase with lines', async () => {
      const row = purchase(a);
      await insert(row);
      await t.db.insert(s.entryLine).values([
        {
          entryId: row.id,
          lineNo: 1,
          name: 'Oil 1 L',
          qty: '2',
          unit: 'bottle',
          unitPrice: 4_000,
          amount: 8_000,
        },
        {
          entryId: row.id,
          lineNo: 2,
          name: 'Sugar',
          qty: '1.5',
          unit: 'kg',
          unitPrice: 3_000,
          amount: 4_500,
        },
      ]);
    });

    it('a simple-mode line (name and amount only)', async () => {
      const row = purchase(a);
      await insert(row);
      await t.db
        .insert(s.entryLine)
        .values({ entryId: row.id, lineNo: 1, name: 'Bread', amount: 12_500 });
    });

    it('a purchase taken by a representative', async () => {
      await insert(purchase(a, { takenByType: 'representative', representativeId: repId }));
    });

    it('a server-origin payment', async () => {
      await insert(
        purchase(a, {
          type: 'payment',
          takenByType: null,
          origin: 'server',
          deviceId: null,
          deviceSeq: null,
          deviceSig: null,
          requestId: randomUUID(),
        }),
      );
    });

    it('a negative correction referencing an entry, with flags', async () => {
      const original = purchase(a);
      await insert(original);
      await insert(
        purchase(a, {
          type: 'correction',
          takenByType: null,
          amount: -2_000,
          refEntryId: original.id,
          reason: 'Returned one bottle',
          flags: ['clock_skew', 'pending_acceptance'],
        }),
      );
    });
  });

  describe('chain uniqueness', () => {
    it('rejects a duplicate seq on the same account', async () => {
      const first = purchase(a);
      await insert(first);
      await rejects(purchase(a, { seq: first.seq }), 'entry_account_seq_uq', '23505');
    });

    it('rejects a duplicate device_seq on the same device', async () => {
      const first = purchase(a);
      await insert(first);
      await rejects(purchase(a, { deviceSeq: first.deviceSeq }), 'entry_device_seq_uq', '23505');
    });

    it('rejects a duplicate id', async () => {
      const first = purchase(a);
      await insert(first);
      await rejects(purchase(a, { id: first.id }), 'entry_pkey', '23505');
    });

    it('rejects seq 0', async () => {
      await rejects(purchase(a, { seq: 0 }), 'entry_seq_pos');
    });
  });

  describe('hashes', () => {
    it.each([
      ['uppercase hex', 'A'.repeat(64)],
      ['non-hex', 'z'.repeat(64)],
    ])('rejects a %s hash', async (_label, hash) => {
      await rejects(purchase(a, { hash }), 'entry_hash_hex');
    });

    it('rejects a malformed prev_hash', async () => {
      await rejects(purchase(a, { prevHash: 'g'.repeat(64) }), 'entry_prev_hash_hex');
    });
  });

  describe('origin', () => {
    it('rejects a device entry without a signature', async () => {
      await rejects(purchase(a, { deviceSig: null }), 'entry_origin_fields');
    });

    it('rejects a device entry without a device_seq', async () => {
      await rejects(purchase(a, { deviceSeq: null }), 'entry_origin_fields');
    });

    it('rejects a server entry without request_id', async () => {
      await rejects(
        purchase(a, { origin: 'server', deviceId: null, deviceSeq: null, deviceSig: null }),
        'entry_origin_fields',
      );
    });

    it('rejects a server entry that carries a device signature', async () => {
      await rejects(
        purchase(a, { origin: 'server', deviceId: null, deviceSeq: null, requestId: randomUUID() }),
        'entry_origin_fields',
      );
    });
  });

  describe('type rules', () => {
    it.each([0, -100])('rejects a purchase with amount %i', async (amount) => {
      await rejects(purchase(a, { amount }), 'entry_amount_by_type');
    });

    it('rejects a payment with amount 0', async () => {
      await rejects(
        purchase(a, { type: 'payment', takenByType: null, amount: 0 }),
        'entry_amount_by_type',
      );
    });

    it('rejects a correction with amount 0', async () => {
      const original = purchase(a);
      await insert(original);
      await rejects(
        purchase(a, {
          type: 'correction',
          takenByType: null,
          amount: 0,
          refEntryId: original.id,
          reason: 'x',
        }),
        'entry_amount_by_type',
      );
    });

    it('rejects a correction without ref_entry_id', async () => {
      await rejects(
        purchase(a, { type: 'correction', takenByType: null, amount: -1, reason: 'x' }),
        'entry_correction_fields',
      );
    });

    it('rejects a correction without a reason', async () => {
      const original = purchase(a);
      await insert(original);
      await rejects(
        purchase(a, { type: 'correction', takenByType: null, amount: -1, refEntryId: original.id }),
        'entry_correction_fields',
      );
    });

    it('rejects a purchase without taken_by_type', async () => {
      await rejects(purchase(a, { takenByType: null }), 'entry_taken_by_purchase_only');
    });

    it('rejects a payment with taken_by_type', async () => {
      await rejects(purchase(a, { type: 'payment' }), 'entry_taken_by_purchase_only');
    });

    it('rejects taken_by representative without a representative', async () => {
      await rejects(purchase(a, { takenByType: 'representative' }), 'entry_representative_iff');
    });

    it('rejects a representative on a purchase taken by the customer', async () => {
      await rejects(purchase(a, { representativeId: repId }), 'entry_representative_iff');
    });

    it('rejects an unknown flag', async () => {
      const err = await pgError(() =>
        t.pool.query(
          `INSERT INTO entry (id, account_id, type, amount, taken_by_type, seq, prev_hash, hash,
             received_at, origin, device_id, device_seq, device_sig, recorded_at, created_by, flags)
           VALUES ($1, $2, 'purchase', 100, 'customer', 9999, $3, $3, now(), 'device', $4, 9999,
             'c2ln', now(), $5, '{made_up}')`,
          [randomUUID(), a.accountId, 'a'.repeat(64), a.deviceId, a.ownerId],
        ),
      );
      expect(err.code).toBe('22P02'); // invalid_text_representation for the enum
    });
  });

  describe('entry_line', () => {
    const lineRejects = async (qty: string) => {
      const row = purchase(a);
      await insert(row);
      const err = await pgError(() =>
        t.db
          .insert(s.entryLine)
          .values({ entryId: row.id, lineNo: 1, name: 'x', qty, amount: 100 }),
      );
      expect(err.constraint).toBe('entry_line_qty_canonical');
    };

    it.each(['1.50', '01', '1.', '.5', '-1', '1e3', ' 1', '1,5'])(
      'rejects non-canonical qty %j',
      async (qty) => {
        await lineRejects(qty);
      },
    );

    it.each(['0', '1', '12', '1.5', '0.25', '10.125'])('accepts canonical qty %j', async (qty) => {
      const row = purchase(a);
      await insert(row);
      await t.db
        .insert(s.entryLine)
        .values({ entryId: row.id, lineNo: 1, name: 'x', qty, amount: 100 });
    });

    it('rejects a duplicate line number', async () => {
      const row = purchase(a);
      await insert(row);
      await t.db.insert(s.entryLine).values({ entryId: row.id, lineNo: 1, name: 'x', amount: 100 });
      const err = await pgError(() =>
        t.db.insert(s.entryLine).values({ entryId: row.id, lineNo: 1, name: 'y', amount: 100 }),
      );
      expect(err.code).toBe('23505');
    });
  });
});
