import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { createTestDb, type TestDb } from '../setup/db.js';

const TABLES = [
  'account',
  'account_limit',
  'app_user',
  'audit_log',
  'catalogue_item',
  'change_log',
  'correction_request',
  'delivery_order',
  'device',
  'dispute',
  'entry',
  'entry_line',
  'limit_raise',
  'merchant',
  'merchant_staff',
  'notification',
  'otp_challenge',
  'payme_request',
  'payment_report',
  'refresh_token',
  'representative',
];

describe('migrations', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb('empty');
  });

  afterAll(async () => {
    await t?.close();
  });

  it('apply cleanly on an empty database', async () => {
    await runMigrations(t.pool);

    const { rows } = await t.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(TABLES);
  });

  it('are a no-op when run again', async () => {
    const count = async () =>
      (await t.pool.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)).rows[0]
        .n as number;
    const before = await count();
    await runMigrations(t.pool);
    expect(await count()).toBe(before);
    expect(before).toBe(12);
  });

  it('install the append-only and change-log triggers', async () => {
    const { rows } = await t.pool.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`,
    );
    expect(rows.map((r) => r.tgname)).toEqual([
      'audit_log_append_only',
      'audit_log_no_truncate',
      // M7, ADR-010: one per synced table
      'change_account',
      'change_catalogue',
      'change_correction_request',
      'change_dispute',
      'change_entry',
      'change_limit',
      'change_merchant',
      'change_payme_request',
      'change_payment_report',
      'change_representative',
      'change_staff',
      'entry_append_only',
      'entry_line_append_only',
      'entry_line_no_truncate',
      'entry_no_truncate',
    ]);
  });
});
