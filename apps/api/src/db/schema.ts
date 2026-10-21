/**
 * Database schema (spec "Data model" + ADR-001 + ADR-004).
 *
 * One file on purpose: the tables reference each other in cycles (entry <-> delivery_order,
 * payment_report -> entry), and drizzle-kit loads a single schema file most reliably.
 *
 * Money is always integer santim in `bigint` columns (CLAUDE.md rule 2).
 * `entry`, `entry_line` and `audit_log` are append-only; a trigger enforces it (see drizzle/).
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const language = pgEnum('language', ['am', 'om', 'en']);
export const calendar = pgEnum('calendar', ['ethiopian', 'gregorian']);
export const detailMode = pgEnum('detail_mode', ['simple', 'detailed']);
export const merchantPlan = pgEnum('merchant_plan', ['free', 'shop', 'shop_plus']);
export const staffRole = pgEnum('staff_role', ['owner', 'staff']);
export const accountStatus = pgEnum('account_status', ['pending', 'active', 'paused', 'closed']);
export const repRelationship = pgEnum('rep_relationship', [
  'household',
  'maid',
  'guard',
  'driver',
  'other',
]);
export const repStatus = pgEnum('rep_status', ['active', 'paused', 'revoked']);
export const limitSide = pgEnum('limit_side', ['merchant', 'customer']);
export const periodType = pgEnum('period_type', ['weekly', 'biweekly', 'monthly', 'custom_days']);
export const limitMode = pgEnum('limit_mode', ['alert', 'hard_stop']);
export const entryType = pgEnum('entry_type', ['purchase', 'payment', 'correction']);
export const takenByType = pgEnum('taken_by_type', ['customer', 'representative', 'delivery']);
export const entryOrigin = pgEnum('entry_origin', ['device', 'server']);
export const entryFlag = pgEnum('entry_flag', [
  'clock_skew',
  'over_limit_override',
  'over_hard_stop',
  'rep_revoked',
  'pending_acceptance',
]);
export const lineSource = pgEnum('line_source', ['manual', 'photo', 'order']);
export const paymentMethod = pgEnum('payment_method', [
  'cash',
  'telebirr',
  'cbe_birr',
  'mpesa',
  'bank_transfer',
  'other',
]);
export const paymentReportStatus = pgEnum('payment_report_status', [
  'reported',
  'confirmed',
  'rejected',
]);
export const paymeStatus = pgEnum('payme_status', [
  'sent',
  'seen',
  'partially_paid',
  'paid',
  'expired',
]);
export const orderStatus = pgEnum('order_status', [
  'sent',
  'accepted',
  'priced',
  'out_for_delivery',
  'delivered',
  'declined',
]);
export const disputeStatus = pgEnum('dispute_status', ['open', 'resolved']);
export const notificationChannel = pgEnum('notification_channel', ['push', 'sms']);
export const notificationStatus = pgEnum('notification_status', [
  'pending',
  'sent',
  'failed',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Common columns
// ---------------------------------------------------------------------------

/** RFC 3339 UTC with milliseconds. */
const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });
/** Integer santim. `number` is exact up to 2^53, far above any real balance. */
const santim = (name: string) => bigint(name, { mode: 'number' });

const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const createdBy = () => uuid('created_by').references((): AnyPgColumn => appUser.id);
const deviceId = () => uuid('device_id').references((): AnyPgColumn => device.id);

const GENESIS_HASH = '0'.repeat(64);
const HEX64 = `'^[0-9a-f]{64}$'`;

// ---------------------------------------------------------------------------
// Users and devices
// ---------------------------------------------------------------------------

export const appUser = pgTable(
  'app_user',
  {
    id: uuid('id').primaryKey(),
    phone: text('phone').notNull().unique(),
    name: text('name'),
    language: language('language').notNull().default('am'),
    calendarPref: calendar('calendar_pref'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
  },
  (t) => [check('app_user_phone_e164', sql`${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`)],
);

export const device = pgTable(
  'device',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    /** ECDSA P-256 public key, SPKI, base64 (ADR-001). */
    publicKey: text('public_key').notNull(),
    label: text('label'),
    createdAt: createdAt(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('device_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

export const merchant = pgTable(
  'merchant',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => appUser.id),
    shopName: text('shop_name').notNull(),
    subCity: text('sub_city'),
    woreda: text('woreda'),
    landmark: text('landmark'),
    defaultDetailMode: detailMode('default_detail_mode').notNull().default('simple'),
    plan: merchantPlan('plan').notNull().default('free'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [index('merchant_owner_idx').on(t.ownerUserId)],
);

/** One owner and at most one staff member per shop (ADR-003), enforced by partial indexes. */
export const merchantStaff = pgTable(
  'merchant_staff',
  {
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchant.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    role: staffRole('role').notNull(),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.userId] }),
    uniqueIndex('merchant_staff_one_owner')
      .on(t.merchantId)
      .where(sql`${t.role} = 'owner'`),
    uniqueIndex('merchant_staff_one_staff')
      .on(t.merchantId)
      .where(sql`${t.role} = 'staff'`),
    index('merchant_staff_user_idx').on(t.userId),
  ],
);

export const catalogueItem = pgTable(
  'catalogue_item',
  {
    id: uuid('id').primaryKey(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchant.id),
    name: text('name').notNull(),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    unit: text('unit'),
    lastPrice: santim('last_price'),
    photoLabel: text('photo_label'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('catalogue_item_merchant_idx').on(t.merchantId),
    check('catalogue_item_last_price_nonneg', sql`${t.lastPrice} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Accounts, limits, representatives
// ---------------------------------------------------------------------------

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchant.id),
    customerUserId: uuid('customer_user_id')
      .notNull()
      .references(() => appUser.id),
    /** Private to the merchant side (CLAUDE.md rule 8). */
    nickname: text('nickname'),
    locationNote: text('location_note'),
    status: accountStatus('status').notNull().default('pending'),
    termsAcceptedAt: ts('terms_accepted_at'),
    /** Per-customer override of the shop's default detail mode (LED-2). */
    detailMode: detailMode('detail_mode'),
    /** The customer's own view preference. */
    customerDetailView: detailMode('customer_detail_view'),
    /** Chain head, maintained by the server in the entry insert transaction (ADR-001). */
    lastSeq: integer('last_seq').notNull().default(0),
    lastHash: char('last_hash', { length: 64 }).notNull().default(GENESIS_HASH),
    /** Cached Σ purchase + Σ correction − Σ payment (ADR-004). */
    balanceSantim: santim('balance_santim').notNull().default(0),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('account_merchant_customer_uq').on(t.merchantId, t.customerUserId),
    index('account_customer_idx').on(t.customerUserId),
    check('account_last_seq_nonneg', sql`${t.lastSeq} >= 0`),
    check('account_last_hash_hex', sql`${t.lastHash} ~ ${sql.raw(HEX64)}`),
    check(
      'account_accepted_before_active',
      sql`${t.status} NOT IN ('active', 'paused') OR ${t.termsAcceptedAt} IS NOT NULL`,
    ),
  ],
);

/** Two rows max per account: one per side. */
export const accountLimit = pgTable(
  'account_limit',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    setBy: limitSide('set_by').notNull(),
    value: santim('value'),
    periodType: periodType('period_type'),
    periodDays: integer('period_days'),
    /** Copied from the setter's calendar_pref for monthly periods (ADR-003, ADR-004). */
    calendar: calendar('calendar'),
    mode: limitMode('mode').notNull().default('alert'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.setBy] }),
    check('account_limit_value_pos', sql`${t.value} > 0`),
    check(
      'account_limit_something_set',
      sql`${t.value} IS NOT NULL OR ${t.periodType} IS NOT NULL`,
    ),
    check(
      'account_limit_custom_days',
      sql`(${t.periodType} IS NOT DISTINCT FROM 'custom_days') = (${t.periodDays} IS NOT NULL) AND (${t.periodDays} IS NULL OR ${t.periodDays} > 0)`,
    ),
    check(
      'account_limit_monthly_calendar',
      sql`(${t.periodType} IS NOT DISTINCT FROM 'monthly') = (${t.calendar} IS NOT NULL)`,
    ),
    check(
      'account_limit_hard_stop_customer_only',
      sql`${t.mode} = 'alert' OR ${t.setBy} = 'customer'`,
    ),
  ],
);

/** Created only by the customer (REP). */
export const representative = pgTable(
  'representative',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    name: text('name').notNull(),
    relationship: repRelationship('relationship').notNull(),
    phone: text('phone'),
    pinHash: text('pin_hash'),
    status: repStatus('status').notNull().default('active'),
    /** Whether the representative may send delivery orders. */
    mayOrder: boolean('may_order').notNull().default(false),
    limitValue: santim('limit_value'),
    limitPeriodType: periodType('limit_period_type'),
    limitPeriodDays: integer('limit_period_days'),
    limitCalendar: calendar('limit_calendar'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('representative_account_idx').on(t.accountId),
    check('representative_limit_value_pos', sql`${t.limitValue} > 0`),
    check(
      'representative_custom_days',
      sql`(${t.limitPeriodType} IS NOT DISTINCT FROM 'custom_days') = (${t.limitPeriodDays} IS NOT NULL) AND (${t.limitPeriodDays} IS NULL OR ${t.limitPeriodDays} > 0)`,
    ),
    check(
      'representative_monthly_calendar',
      sql`(${t.limitPeriodType} IS NOT DISTINCT FROM 'monthly') = (${t.limitCalendar} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Ledger (append-only)
// ---------------------------------------------------------------------------

export const entry = pgTable(
  'entry',
  {
    /** UUID v7 generated on the device; the idempotency key (ADR-001). */
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    type: entryType('type').notNull(),
    /** Santim. Purchase and payment > 0; correction is a signed delta, never 0 (ADR-004). */
    amount: santim('amount').notNull(),
    takenByType: takenByType('taken_by_type'),
    representativeId: uuid('representative_id').references(() => representative.id),
    orderId: uuid('order_id').references((): AnyPgColumn => deliveryOrder.id),
    refEntryId: uuid('ref_entry_id').references((): AnyPgColumn => entry.id),
    reason: text('reason'),
    photoUrl: text('photo_url'),

    // Chain, assigned by the server in the insert (ADR-001).
    seq: integer('seq').notNull(),
    prevHash: char('prev_hash', { length: 64 }).notNull(),
    hash: char('hash', { length: 64 }).notNull(),
    receivedAt: ts('received_at').notNull(),

    // Device identity and signature.
    origin: entryOrigin('origin').notNull(),
    deviceId: deviceId(),
    deviceSeq: integer('device_seq'),
    /** ECDSA P-256 / SHA-256, DER, base64. */
    deviceSig: text('device_sig'),
    recordedAt: ts('recorded_at').notNull(),
    /** For server-origin entries: the authenticated request, whose actor is in audit_log. */
    requestId: uuid('request_id'),

    flags: entryFlag('flags')
      .array()
      .notNull()
      .default(sql`'{}'::entry_flag[]`),
    createdAt: createdAt(),
    createdBy: uuid('created_by')
      .notNull()
      .references((): AnyPgColumn => appUser.id),
  },
  (t) => [
    unique('entry_account_seq_uq').on(t.accountId, t.seq),
    unique('entry_device_seq_uq').on(t.deviceId, t.deviceSeq),
    index('entry_account_recorded_idx').on(t.accountId, t.recordedAt, t.seq),
    index('entry_ref_idx').on(t.refEntryId),
    check('entry_seq_pos', sql`${t.seq} >= 1`),
    check('entry_device_seq_pos', sql`${t.deviceSeq} >= 1`),
    check('entry_prev_hash_hex', sql`${t.prevHash} ~ ${sql.raw(HEX64)}`),
    check('entry_hash_hex', sql`${t.hash} ~ ${sql.raw(HEX64)}`),
    check(
      'entry_origin_fields',
      sql`(${t.origin} = 'device' AND ${t.deviceId} IS NOT NULL AND ${t.deviceSeq} IS NOT NULL AND ${t.deviceSig} IS NOT NULL)
       OR (${t.origin} = 'server' AND ${t.deviceId} IS NULL AND ${t.deviceSeq} IS NULL AND ${t.deviceSig} IS NULL AND ${t.requestId} IS NOT NULL)`,
    ),
    check(
      'entry_amount_by_type',
      sql`(${t.type} IN ('purchase', 'payment') AND ${t.amount} > 0)
       OR (${t.type} = 'correction' AND ${t.amount} <> 0)`,
    ),
    check(
      'entry_taken_by_purchase_only',
      sql`(${t.type} = 'purchase') = (${t.takenByType} IS NOT NULL)`,
    ),
    check(
      'entry_representative_iff',
      sql`(${t.takenByType} IS NOT DISTINCT FROM 'representative') = (${t.representativeId} IS NOT NULL)`,
    ),
    check(
      'entry_correction_fields',
      sql`${t.type} <> 'correction' OR (${t.refEntryId} IS NOT NULL AND ${t.reason} IS NOT NULL)`,
    ),
  ],
);

export const entryLine = pgTable(
  'entry_line',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entry.id),
    /** Display order, 1-based; the signing payload lists lines in this order. */
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').references(() => catalogueItem.id),
    name: text('name').notNull(),
    /** Canonical decimal text, exactly as signed (ADR-004). Null in simple mode. */
    qty: text('qty'),
    unit: text('unit'),
    unitPrice: santim('unit_price'),
    amount: santim('amount').notNull(),
    source: lineSource('source').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.lineNo] }),
    check('entry_line_no_pos', sql`${t.lineNo} >= 1`),
    check('entry_line_qty_canonical', sql`${t.qty} ~ '^(0|[1-9][0-9]*)(\\.[0-9]*[1-9])?$'`),
    check('entry_line_unit_price_nonneg', sql`${t.unitPrice} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const paymentReport = pgTable(
  'payment_report',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    amount: santim('amount').notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference'),
    screenshotUrl: text('screenshot_url'),
    status: paymentReportStatus('status').notNull().default('reported'),
    reviewedBy: uuid('reviewed_by').references(() => appUser.id),
    reviewedAt: ts('reviewed_at'),
    rejectReason: text('reject_reason'),
    /** The server-origin payment entry created on confirm. */
    entryId: uuid('entry_id')
      .unique()
      .references(() => entry.id),
    resubmittedFromId: uuid('resubmitted_from_id').references((): AnyPgColumn => paymentReport.id),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payment_report_account_idx').on(t.accountId, t.status),
    check('payment_report_amount_pos', sql`${t.amount} > 0`),
    check(
      'payment_report_confirmed_entry',
      sql`(${t.status} = 'confirmed') = (${t.entryId} IS NOT NULL)`,
    ),
  ],
);

export const paymeRequest = pgTable(
  'payme_request',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    amount: santim('amount').notNull(),
    message: text('message'),
    dueDate: date('due_date', { mode: 'string' }),
    /** Payment details the merchant chose to share (PAY-7): telebirr number, account, QR. */
    paymentDetails: jsonb('payment_details'),
    status: paymeStatus('status').notNull().default('sent'),
    seenAt: ts('seen_at'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payme_request_account_idx').on(t.accountId, t.status),
    check('payme_request_amount_pos', sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Delivery orders
// ---------------------------------------------------------------------------

export const deliveryOrder = pgTable(
  'delivery_order',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    lines: jsonb('lines').notNull(),
    addressNote: text('address_note'),
    preferredTime: text('preferred_time'),
    status: orderStatus('status').notNull().default('sent'),
    declineReason: text('decline_reason'),
    deliveryPerson: text('delivery_person'),
    deliveredEntryId: uuid('delivered_entry_id')
      .unique()
      .references((): AnyPgColumn => entry.id),
    receiptConfirmedAt: ts('receipt_confirmed_at'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [index('delivery_order_account_idx').on(t.accountId, t.status)],
);

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export const dispute = pgTable(
  'dispute',
  {
    id: uuid('id').primaryKey(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entry.id),
    raisedBy: uuid('raised_by')
      .notNull()
      .references(() => appUser.id),
    reason: text('reason').notNull(),
    status: disputeStatus('status').notNull().default('open'),
    resolutionEntryId: uuid('resolution_entry_id').references(() => entry.id),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by').references(() => appUser.id),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    deviceId: deviceId(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dispute_entry_idx').on(t.entryId),
    check(
      'dispute_resolution',
      sql`${t.status} = 'open' OR ${t.resolutionEntryId} IS NOT NULL OR ${t.resolutionNote} IS NOT NULL`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Notifications outbox and audit log
// ---------------------------------------------------------------------------

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey(),
    /** App user, or null for a representative reached by SMS only. */
    userId: uuid('user_id').references(() => appUser.id),
    phone: text('phone'),
    event: text('event').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    channel: notificationChannel('channel').notNull(),
    status: notificationStatus('status').notNull().default('pending'),
    /** Delivery time; later than created_at when held for quiet hours. */
    scheduledFor: ts('scheduled_for').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    sentAt: ts('sent_at'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_due_idx').on(t.status, t.scheduledFor),
    index('notification_user_idx').on(t.userId),
    check('notification_recipient', sql`${t.userId} IS NOT NULL OR ${t.phone} IS NOT NULL`),
  ],
);

/** Immutable (trigger-enforced). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => appUser.id),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: uuid('request_id'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_object_idx').on(t.objectType, t.objectId),
    index('audit_log_request_idx').on(t.requestId),
  ],
);

/** Tables the append-only trigger protects. Kept here so tests can iterate over them. */
export const APPEND_ONLY_TABLES = ['entry', 'entry_line', 'audit_log'] as const;
