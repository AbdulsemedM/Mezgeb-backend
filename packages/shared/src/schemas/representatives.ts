import { z } from 'zod';

/** Representatives (REP-1..6, M6). The customer manages them; the shop picks from them. */

const text = (max: number) => z.string().trim().min(1).max(max);

export const repRelationshipSchema = z.enum(['household', 'maid', 'guard', 'driver', 'other']);

/** A representative's own value limit per period (REP-2), within the account limit. */
export const repLimitSchema = z
  .object({
    value: z.number().int().positive().refine(Number.isSafeInteger),
    period: z.object({
      type: z.enum(['weekly', 'biweekly', 'monthly', 'custom_days']),
      days: z.number().int().min(1).max(366).nullish(),
    }),
  })
  .refine(
    (l) => (l.period.type === 'custom_days') === (l.period.days != null),
    'days go with custom_days',
  );
export type RepLimit = z.infer<typeof repLimitSchema>;

/** REP-6: an optional 4-digit PIN the shop asks for at the counter. */
const pinSchema = z.string().regex(/^\d{4}$/, 'a PIN is 4 digits');

export const createRepresentativeSchema = z
  .object({
    id: z.uuid(),
    name: text(60),
    relationship: repRelationshipSchema,
    /** Typed as the customer wrote it; normalized by the server. */
    phone: z.string().min(1).max(32).nullish(),
    may_order: z.boolean().default(false),
    limit: repLimitSchema.nullish(),
    pin: pinSchema.nullish(),
    sms_receipt: z.boolean().default(false),
  })
  .refine((r) => !r.sms_receipt || r.phone != null, {
    path: ['sms_receipt'],
    message: 'an SMS receipt needs a phone number',
  });
export type CreateRepresentative = z.infer<typeof createRepresentativeSchema>;

/** Fields set to null are cleared (phone, limit, pin). */
export const updateRepresentativeSchema = z
  .object({
    name: text(60),
    relationship: repRelationshipSchema,
    phone: z.string().min(1).max(32).nullable(),
    may_order: z.boolean(),
    limit: repLimitSchema.nullable(),
    pin: pinSchema.nullable(),
    sms_receipt: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateRepresentative = z.infer<typeof updateRepresentativeSchema>;

/** REP-3: pause or revoke instantly; revoked is final. */
export const setRepresentativeStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'revoked']),
});
export type SetRepresentativeStatus = z.infer<typeof setRepresentativeStatusSchema>;

export const verifyPinSchema = z.object({ pin: pinSchema });
export type VerifyPin = z.infer<typeof verifyPinSchema>;
