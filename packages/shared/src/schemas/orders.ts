import { z } from 'zod';
import { isCanonicalQty, lineAmount } from '../money.js';

/** M9 (ADR-014) delivery orders. */

const text = (max: number) => z.string().trim().min(1).max(max);
const santim = z.number().int().refine(Number.isSafeInteger, 'must be a safe integer');
const qty = z.string().refine(isCanonicalQty, 'canonical decimal text');

/** What the customer asks for: free text or a catalogue item, with an optional quantity. */
export const orderLineSchema = z.object({
  name: text(80),
  qty: qty.optional(),
  unit: text(20).optional(),
  item_id: z.uuid().optional(),
  note: text(120).optional(),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

/** ORD-1, the customer (PWA). */
export const createOrderSchema = z.object({
  id: z.uuid(),
  lines: z.array(orderLineSchema).min(1).max(50),
  address_note: text(200).optional(),
  preferred_time: text(80).optional(),
});
export type CreateOrder = z.infer<typeof createOrderSchema>;

/** ORD-2: the shop's priced list. Out-of-stock lines stay listed, marked and not charged. */
export const pricedLineSchema = z
  .object({
    name: text(80),
    qty,
    unit: text(20).nullish(),
    unit_price: santim.min(0),
    amount: santim.min(0),
    item_id: z.uuid().nullish(),
    unavailable: z.boolean().default(false),
  })
  .superRefine((l, ctx) => {
    const expected = l.unavailable ? 0 : lineAmount(l.unit_price, l.qty);
    if (l.amount !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'amount must be qty × unit_price',
      });
    }
  });
export type PricedLine = z.infer<typeof pricedLineSchema>;

export const priceOrderSchema = z.object({
  lines: z.array(pricedLineSchema).min(1).max(50),
});
export type PriceOrder = z.infer<typeof priceOrderSchema>;

export const declineOrderSchema = z.object({ reason: text(280) });
export type DeclineOrder = z.infer<typeof declineOrderSchema>;

export const outForDeliverySchema = z.object({ delivery_person: text(80).optional() });
export type OutForDelivery = z.infer<typeof outForDeliverySchema>;

/** ORD-4, the customer: received, or something was missing (opens a dispute). */
export const orderReceiptSchema = z.object({ missing: text(280).optional() });
export type OrderReceipt = z.infer<typeof orderReceiptSchema>;
