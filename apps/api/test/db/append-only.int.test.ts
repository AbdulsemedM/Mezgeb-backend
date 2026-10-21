import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema.js';
import { createTestDb, type TestDb } from '../setup/db.js';
import { pgError, purchase, seedAccount } from '../setup/fixtures.js';

/** CLAUDE.md rule 1, defence in depth: the database itself refuses to change history. */
describe('append-only tables', () => {
  let t: TestDb;
  let entryId: string;
  let auditId: string;

  beforeAll(async () => {
    t = await createTestDb();
    const a = await seedAccount(t.db);
    const row = purchase(a);
    entryId = row.id;
    await t.db.insert(s.entry).values(row);
    await t.db.insert(s.entryLine).values({
      entryId,
      lineNo: 1,
      name: 'Eggs',
      qty: '6',
      unit: 'pc',
      unitPrice: 1_500,
      amount: 9_000,
    });
    auditId = randomUUID();
    await t.db.insert(s.auditLog).values({
      id: auditId,
      actorUserId: a.ownerId,
      action: 'entry.create',
      objectType: 'entry',
      objectId: entryId,
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  const cases = [
    {
      table: 'entry',
      update: () => `UPDATE entry SET amount = 1 WHERE id = '${entryId}'`,
      del: () => `DELETE FROM entry WHERE id = '${entryId}'`,
      count: () =>
        `SELECT count(*)::int AS n FROM entry WHERE id = '${entryId}' AND amount = 12500`,
    },
    {
      table: 'entry_line',
      update: () => `UPDATE entry_line SET amount = 1 WHERE entry_id = '${entryId}'`,
      del: () => `DELETE FROM entry_line WHERE entry_id = '${entryId}'`,
      count: () =>
        `SELECT count(*)::int AS n FROM entry_line WHERE entry_id = '${entryId}' AND amount = 9000`,
    },
    {
      table: 'audit_log',
      update: () => `UPDATE audit_log SET action = 'x' WHERE id = '${auditId}'`,
      del: () => `DELETE FROM audit_log WHERE id = '${auditId}'`,
      count: () =>
        `SELECT count(*)::int AS n FROM audit_log WHERE id = '${auditId}' AND action = 'entry.create'`,
    },
  ];

  describe.each(cases)('$table', ({ table, update, del, count }) => {
    it('rejects UPDATE', async () => {
      const err = await pgError(() => t.pool.query(update()));
      expect(err.code).toBe('MZ001');
      expect(err.message).toBe(`mezgeb: ${table} is append-only (UPDATE forbidden)`);
    });

    it('rejects DELETE', async () => {
      const err = await pgError(() => t.pool.query(del()));
      expect(err.code).toBe('MZ001');
      expect(err.message).toContain('DELETE forbidden');
    });

    it('rejects TRUNCATE', async () => {
      const err = await pgError(() => t.pool.query(`TRUNCATE ${table} CASCADE`));
      expect(err.code).toBe('MZ001');
    });

    it('still holds the original row', async () => {
      const { rows } = await t.pool.query(count());
      expect(rows[0].n).toBe(1);
    });
  });

  it('rejects UPDATE through Drizzle as well', async () => {
    const err = await pgError(() => t.db.update(s.entry).set({ reason: 'edited' }));
    expect(err.code).toBe('MZ001');
  });

  it('blocks a TRUNCATE that cascades from account', async () => {
    const err = await pgError(() => t.pool.query(`TRUNCATE account CASCADE`));
    expect(err.code).toBe('MZ001');
    const { rows } = await t.pool.query(`SELECT count(*)::int AS n FROM account`);
    expect(rows[0].n).toBe(1);
  });

  it('cannot delete an account that has entries', async () => {
    const err = await pgError(() => t.pool.query(`DELETE FROM account`));
    expect(err.code).toBe('23503'); // foreign_key_violation
  });
});
