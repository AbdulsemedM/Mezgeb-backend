import { z } from 'zod';
import { languageSchema } from './auth.js';

/** Version of the dube agreement text the client displayed (ADR-006). */
export const CURRENT_TERMS_VERSION = 'dube-2026-10';

export const detailModeSchema = z.enum(['simple', 'detailed']);
export type DetailMode = z.infer<typeof detailModeSchema>;
export const calendarSchema = z.enum(['ethiopian', 'gregorian']);

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const createMerchantSchema = z.object({
  id: z.uuid(),
  shop_name: shortText(80),
  sub_city: shortText(60).optional(),
  woreda: shortText(60).optional(),
  landmark: shortText(120).optional(),
  default_detail_mode: detailModeSchema.optional(),
  terms_version: z.string().min(1).max(32),
});
export type CreateMerchant = z.infer<typeof createMerchantSchema>;

export const updateMerchantSchema = z
  .object({
    shop_name: shortText(80),
    sub_city: shortText(60).nullable(),
    woreda: shortText(60).nullable(),
    landmark: shortText(120).nullable(),
    default_detail_mode: detailModeSchema,
    /** PAY-7, shown on pay-me requests. */
    payment_details: shortText(300).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateMerchant = z.infer<typeof updateMerchantSchema>;

export const addStaffSchema = z.object({ phone: z.string().min(1).max(32) });
export type AddStaff = z.infer<typeof addStaffSchema>;

export const createAccountSchema = z.object({
  id: z.uuid(),
  merchant_id: z.uuid(),
  phone: z.string().min(1).max(32),
  nickname: shortText(60).optional(),
  location_note: shortText(120).optional(),
  /** The customer's SMS language, if the merchant knows it. */
  language: languageSchema.optional(),
});
export type CreateAccount = z.infer<typeof createAccountSchema>;

export const acceptAccountSchema = z.object({ terms_version: z.string().min(1).max(32) });
export type AcceptAccount = z.infer<typeof acceptAccountSchema>;

export const updateAccountSchema = z
  .object({
    nickname: shortText(60).nullable(),
    location_note: shortText(120).nullable(),
    detail_mode: detailModeSchema.nullable(),
    customer_detail_view: detailModeSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateAccount = z.infer<typeof updateAccountSchema>;

export const listAccountsQuerySchema = z.object({
  role: z.enum(['merchant', 'customer']),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  after: z.uuid().optional(),
});
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

export const updateMeSchema = z
  .object({
    name: shortText(80),
    language: languageSchema,
    calendar_pref: calendarSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateMe = z.infer<typeof updateMeSchema>;
