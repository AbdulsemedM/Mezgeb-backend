import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../src/db/schema.js';
import { createTestDb, type TestDb } from '../setup/db.js';
import { nextPhone, pgError, seedAccount, type SeededAccount } from '../setup/fixtures.js';

describe('schema constraints', () => {
  let t: TestDb;
  let a: SeededAccount;

  const newUser = async () => {
    const id = randomUUID();
    await t.db.insert(s.appUser).values({ id, phone: nextPhone() });
    return id;
  };

  beforeAll(async () => {
    t = await createTestDb();
    a = await seedAccount(t.db);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('app_user', () => {
    it.each(['0911223344', '+0911223344', '+251 911 223344', '+2519'])(
      'rejects non-E.164 phone %j',
      async (phone) => {
        const err = await pgError(() => t.db.insert(s.appUser).values({ id: randomUUID(), phone }));
        expect(err.constraint).toBe('app_user_phone_e164');
      },
    );

    it('rejects a duplicate phone', async () => {
      const phone = nextPhone();
      await t.db.insert(s.appUser).values({ id: randomUUID(), phone });
      const err = await pgError(() => t.db.insert(s.appUser).values({ id: randomUUID(), phone }));
      expect(err.code).toBe('23505');
    });
  });

  describe('merchant_staff (ADR-003: one owner, at most one staff)', () => {
    it('accepts one staff member', async () => {
      const staff = await newUser();
      await t.db
        .insert(s.merchantStaff)
        .values({ merchantId: a.merchantId, userId: staff, role: 'staff' });
    });

    it('rejects a second staff member', async () => {
      const staff2 = await newUser();
      const err = await pgError(() =>
        t.db
          .insert(s.merchantStaff)
          .values({ merchantId: a.merchantId, userId: staff2, role: 'staff' }),
      );
      expect(err.constraint).toBe('merchant_staff_one_staff');
    });

    it('rejects a second owner', async () => {
      const owner2 = await newUser();
      const err = await pgError(() =>
        t.db
          .insert(s.merchantStaff)
          .values({ merchantId: a.merchantId, userId: owner2, role: 'owner' }),
      );
      expect(err.constraint).toBe('merchant_staff_one_owner');
    });
  });

  describe('account', () => {
    it('rejects a second account for the same merchant-customer pair', async () => {
      const err = await pgError(() =>
        t.db.insert(s.account).values({
          id: randomUUID(),
          merchantId: a.merchantId,
          customerUserId: a.customerId,
          createdBy: a.ownerId,
        }),
      );
      expect(err.constraint).toBe('account_merchant_customer_uq');
    });

    it('starts pending with a genesis chain head and zero balance', async () => {
      const customer = await newUser();
      const [row] = await t.db
        .insert(s.account)
        .values({
          id: randomUUID(),
          merchantId: a.merchantId,
          customerUserId: customer,
          createdBy: a.ownerId,
        })
        .returning();
      expect(row).toMatchObject({
        status: 'pending',
        lastSeq: 0,
        lastHash: '0'.repeat(64),
        balanceSantim: 0,
      });
    });

    it('rejects an active account without accepted terms', async () => {
      const customer = await newUser();
      const err = await pgError(() =>
        t.db.insert(s.account).values({
          id: randomUUID(),
          merchantId: a.merchantId,
          customerUserId: customer,
          status: 'active',
          createdBy: a.ownerId,
        }),
      );
      expect(err.constraint).toBe('account_accepted_before_active');
    });
  });

  describe('account_limit', () => {
    const limit = (overrides: Partial<typeof s.accountLimit.$inferInsert>) =>
      t.db
        .insert(s.accountLimit)
        .values({ accountId: a.accountId, setBy: 'merchant', ...overrides });

    it('accepts the worked example: merchant 5,000 monthly, customer 4,000 two-weekly hard stop', async () => {
      await limit({ value: 500_000, periodType: 'monthly', calendar: 'ethiopian' });
      await limit({ setBy: 'customer', value: 400_000, periodType: 'biweekly', mode: 'hard_stop' });
    });

    it('rejects a third limit row (two max per account)', async () => {
      const err = await pgError(() => limit({ value: 1 }));
      expect(err.code).toBe('23505');
    });

    describe('on a fresh account', () => {
      let accountId: string;
      const fresh = (overrides: Partial<typeof s.accountLimit.$inferInsert>) =>
        pgError(() =>
          t.db.insert(s.accountLimit).values({ accountId, setBy: 'merchant', ...overrides }),
        );

      beforeAll(async () => {
        accountId = (await seedAccount(t.db)).accountId;
      });

      it('rejects hard_stop on the merchant side', async () => {
        expect((await fresh({ value: 100, mode: 'hard_stop' })).constraint).toBe(
          'account_limit_hard_stop_customer_only',
        );
      });

      it('rejects custom_days without days', async () => {
        expect((await fresh({ periodType: 'custom_days' })).constraint).toBe(
          'account_limit_custom_days',
        );
      });

      it('rejects days on a non-custom period', async () => {
        expect((await fresh({ periodType: 'weekly', periodDays: 7 })).constraint).toBe(
          'account_limit_custom_days',
        );
      });

      it('rejects days without any period type', async () => {
        expect((await fresh({ value: 100, periodDays: 7 })).constraint).toBe(
          'account_limit_custom_days',
        );
      });

      it('rejects a monthly limit without a calendar', async () => {
        expect((await fresh({ periodType: 'monthly' })).constraint).toBe(
          'account_limit_monthly_calendar',
        );
      });

      it('rejects a calendar on a non-monthly period', async () => {
        expect((await fresh({ periodType: 'weekly', calendar: 'gregorian' })).constraint).toBe(
          'account_limit_monthly_calendar',
        );
      });

      it('rejects a limit with neither value nor period', async () => {
        expect((await fresh({})).constraint).toBe('account_limit_something_set');
      });

      it('rejects a zero value', async () => {
        expect((await fresh({ value: 0 })).constraint).toBe('account_limit_value_pos');
      });
    });
  });

  describe('representative', () => {
    const rep = (overrides: Partial<typeof s.representative.$inferInsert>) =>
      t.db.insert(s.representative).values({
        id: randomUUID(),
        accountId: a.accountId,
        name: 'Almaz',
        relationship: 'maid',
        ...overrides,
      });

    it('accepts an own limit of 1,500 per month', async () => {
      await rep({
        limitValue: 150_000,
        limitPeriodType: 'monthly',
        limitCalendar: 'gregorian',
        limitSetAt: '2026-10-22',
      });
    });

    it('rejects a limit without the day it was set, and an anchor without a limit (M6)', async () => {
      expect((await pgError(() => rep({ limitValue: 150_000 }))).constraint).toBe(
        'representative_limit_anchor',
      );
      expect((await pgError(() => rep({ limitSetAt: '2026-10-22' }))).constraint).toBe(
        'representative_limit_anchor',
      );
    });

    it('rejects an SMS receipt without a phone (REP-5)', async () => {
      expect((await pgError(() => rep({ smsReceipt: true }))).constraint).toBe(
        'representative_receipt_phone',
      );
    });

    it('defaults to active and not allowed to order', async () => {
      const [row] = await rep({}).returning();
      expect(row).toMatchObject({ status: 'active', mayOrder: false });
    });

    it('rejects custom_days without days', async () => {
      expect((await pgError(() => rep({ limitPeriodType: 'custom_days' }))).constraint).toBe(
        'representative_custom_days',
      );
    });

    it('rejects a monthly limit without a calendar', async () => {
      expect((await pgError(() => rep({ limitPeriodType: 'monthly' }))).constraint).toBe(
        'representative_monthly_calendar',
      );
    });
  });

  describe('payment_report', () => {
    it('rejects confirmed without a payment entry', async () => {
      const err = await pgError(() =>
        t.db.insert(s.paymentReport).values({
          id: randomUUID(),
          accountId: a.accountId,
          amount: 100,
          method: 'telebirr',
          status: 'confirmed',
        }),
      );
      expect(err.constraint).toBe('payment_report_confirmed_entry');
    });

    it('rejects a zero amount', async () => {
      const err = await pgError(() =>
        t.db
          .insert(s.paymentReport)
          .values({ id: randomUUID(), accountId: a.accountId, amount: 0, method: 'cash' }),
      );
      expect(err.constraint).toBe('payment_report_amount_pos');
    });
  });

  describe('notification', () => {
    it('rejects a notification with no recipient', async () => {
      const err = await pgError(() =>
        t.db
          .insert(s.notification)
          .values({ id: randomUUID(), event: 'purchase_recorded', channel: 'sms' }),
      );
      expect(err.constraint).toBe('notification_recipient');
    });

    it('accepts an SMS to a representative by phone only', async () => {
      await t.db.insert(s.notification).values({
        id: randomUUID(),
        phone: nextPhone(),
        event: 'purchase_recorded',
        channel: 'sms',
      });
    });
  });

  describe('dispute', () => {
    it('rejects resolved without a correction or a note', async () => {
      const entryId = randomUUID();
      const err = await pgError(() =>
        t.db.insert(s.dispute).values({
          id: randomUUID(),
          entryId,
          raisedBy: a.customerId,
          reason: 'I did not take this',
          status: 'resolved',
        }),
      );
      expect(err.constraint).toBe('dispute_resolution');
    });
  });
});
