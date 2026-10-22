import { z } from 'zod';
import { isCanonicalQty, lineAmount } from '../money.js';
import { isCanonicalTimestamp } from '../signing.js';

/** Ledger request bodies (M5, ADR-001, ADR-004, ADR-008). JSON is snake_case. */

const santim = z.number().int().refine(Number.isSafeInteger, 'must be a safe integer');
const text = (max: number) => z.string().trim().min(1).max(max);
/**
 * Signed text is checked, never transformed: the server must see exactly the bytes the device
 * signed (ADR-001), so surrounding spaces are kept and only blank values are refused.
 */
const signedText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, 'must not be blank');

export const entryLineSchema = z
  .object({
    name: signedText(80),
    /** Canonical decimal text (ADR-004); with unit_price in detailed mode, null in simple. */
    qty: z.string().refine(isCanonicalQty, 'qty must be canonical decimal text').nullish(),
    unit: signedText(20).nullish(),
    unit_price: santim.min(0).nullish(),
    amount: santim,
    item_id: z.uuid().nullish(),
    source: z.enum(['manual', 'photo', 'order']).optional(),
  })
  .superRefine((l, ctx) => {
    const detailed = l.qty != null;
    if (detailed !== (l.unit_price != null)) {
      ctx.addIssue({ code: 'custom', message: 'qty and unit_price go together (detailed mode)' });
    } else if (detailed && l.amount !== lineAmount(l.unit_price!, l.qty!)) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'amount must be unit_price × qty rounded half up (ADR-007)',
      });
    }
  });
export type EntryLineInput = z.infer<typeof entryLineSchema>;

/**
 * A purchase or correction, exactly the ADR-001 signing fields (account_id comes from the URL)
 * plus the device signature. Payments are recorded through the payments routes (M8).
 */
export const createEntrySchema = z
  .object({
    id: z.uuid(),
    type: z.enum(['purchase', 'correction']),
    amount: santim,
    lines: z.array(entryLineSchema).max(100).default([]),
    taken_by_type: z.enum(['customer', 'representative', 'delivery']).nullish(),
    representative_id: z.uuid().nullish(),
    /** Delivery orders arrive in M9. */
    order_id: z.null().optional(),
    ref_entry_id: z.uuid().nullish(),
    /** Correction reason or limit override reason. Signed. */
    reason: signedText(280).nullish(),
    device_id: z.uuid(),
    device_seq: z.number().int().min(1).refine(Number.isSafeInteger),
    recorded_at: z.string().refine(isCanonicalTimestamp, 'RFC 3339 UTC with milliseconds'),
    device_sig: z.base64().min(8).max(256),
  })
  .superRefine((e, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (e.type === 'purchase') {
      if (e.amount <= 0) issue('amount', 'a purchase amount is positive');
      if (e.taken_by_type == null) issue('taken_by_type', 'a purchase says who took the goods');
      if (e.ref_entry_id != null) issue('ref_entry_id', 'only corrections reference an entry');
    } else {
      if (e.amount === 0) issue('amount', 'a correction changes the balance (ADR-004)');
      if (e.taken_by_type != null) issue('taken_by_type', 'only purchases say who took them');
      if (e.ref_entry_id == null) issue('ref_entry_id', 'a correction references the original');
      if (e.reason == null) issue('reason', 'a correction needs a reason');
    }
    if ((e.taken_by_type === 'representative') !== (e.representative_id != null)) {
      issue('representative_id', 'needed exactly when a representative took the goods');
    }
    if (e.lines.length > 0 && e.lines.reduce((sum, l) => sum + l.amount, 0) !== e.amount) {
      issue('amount', 'amount must equal the sum of the lines');
    }
  });
export type CreateEntry = z.infer<typeof createEntrySchema>;

export const listEntriesQuerySchema = z.object({
  /** Inclusive, on recorded_at. */
  from: z.iso.datetime().optional(),
  /** Exclusive, on recorded_at. */
  to: z.iso.datetime().optional(),
});
export type ListEntriesQuery = z.infer<typeof listEntriesQuerySchema>;

export const limitSideSchema = z.enum(['merchant', 'customer']);
export type LimitSide = z.infer<typeof limitSideSchema>;

/** PUT /v1/accounts/{id}/limits/{side}. A monthly period takes the setter's calendar. */
export const setLimitSchema = z
  .object({
    value: santim.positive().nullable().default(null),
    period: z
      .object({
        type: z.enum(['weekly', 'biweekly', 'monthly', 'custom_days']),
        days: z.number().int().min(1).max(366).nullish(),
      })
      .nullable()
      .default(null),
    mode: z.enum(['alert', 'hard_stop']).default('alert'),
  })
  .superRefine((l, ctx) => {
    if (l.value === null && l.period === null) {
      ctx.addIssue({ code: 'custom', message: 'set a value, a period, or both' });
    }
    if (l.period && (l.period.type === 'custom_days') !== (l.period.days != null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['period', 'days'],
        message: 'days go with custom_days',
      });
    }
    if (l.mode === 'hard_stop' && l.value === null) {
      ctx.addIssue({ code: 'custom', path: ['mode'], message: 'a hard stop needs a value' });
    }
  });
export type SetLimit = z.infer<typeof setLimitSchema>;

/** ADR-011, online only: ask the customer to allow going over their hard stop once. */
export const requestRaiseSchema = z.object({ id: z.uuid(), amount: santim.positive() });
export type RequestRaise = z.infer<typeof requestRaiseSchema>;

/** The shop types the code the customer read from the SMS; the customer's app sends none. */
export const approveRaiseSchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type ApproveRaise = z.infer<typeof approveRaiseSchema>;

export const createDisputeSchema = z.object({ id: z.uuid(), reason: text(280) });
export type CreateDispute = z.infer<typeof createDisputeSchema>;

/** Resolved by a correction entry (that references the disputed entry) or by a note. */
export const resolveDisputeSchema = z
  .object({ correction_entry_id: z.uuid().optional(), note: text(280).optional() })
  .refine(
    (r) => (r.correction_entry_id === undefined) !== (r.note === undefined),
    'give a correction_entry_id or a note',
  );
export type ResolveDispute = z.infer<typeof resolveDisputeSchema>;

/** ADR-012: staff ask the owner to correct an entry by `amount` (signed santim). */
export const createCorrectionRequestSchema = z.object({
  id: z.uuid(),
  amount: santim.refine((n) => n !== 0, 'a correction changes the balance'),
  reason: text(280),
});
export type CreateCorrectionRequest = z.infer<typeof createCorrectionRequestSchema>;

/** The owner posted the correction (its entry id), or declines with a note. */
export const resolveCorrectionRequestSchema = resolveDisputeSchema;
export type ResolveCorrectionRequest = ResolveDispute;

const localDateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** `GET /v1/accounts/{id}/statement.pdf?from&to`: Addis local dates, both included (M11). */
export const statementQuerySchema = z
  .object({ from: localDateText, to: localDateText })
  .refine((q) => q.from <= q.to, 'the period ends before it starts');
export type StatementQuery = z.infer<typeof statementQuerySchema>;
