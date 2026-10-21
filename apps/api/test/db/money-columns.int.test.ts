import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../setup/db.js';

/** CLAUDE.md rule 2: money is integer santim; no floats or decimals anywhere. */
describe('money columns', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('no column is real, double precision or numeric', async () => {
    const { rows } = await t.pool.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type IN ('real', 'double precision', 'numeric')`,
    );
    expect(rows).toEqual([]);
  });

  it('every money column is bigint', async () => {
    const { rows } = await t.pool.query<{ col: string; data_type: string }>(
      `SELECT table_name || '.' || column_name AS col, data_type FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (column_name IN ('amount', 'value', 'unit_price', 'last_price', 'limit_value')
              OR column_name LIKE '%santim%')
       ORDER BY 1`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.filter((r) => r.data_type !== 'bigint')).toEqual([]);
  });
});
