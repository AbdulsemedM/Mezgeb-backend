import { sha256Hex } from './hash.js';
import { canonicalBytes } from './jcs.js';
import { assertSantim, isCanonicalQty } from './money.js';

/**
 * The entry signing payload and chain hash, exactly as ADR-001 defines them. Devices sign
 * `signingBytes(payload)`; the server computes `payload_hash` and the chained `hash`.
 */

export const GENESIS_HASH = '0'.repeat(64);

export type LineSource = 'manual' | 'photo' | 'order';
export type TakenByType = 'customer' | 'representative' | 'delivery';
export type SignedEntryType = 'purchase' | 'payment' | 'correction';

export interface SigningLine {
  name: string;
  /** Canonical decimal text (ADR-004), or null in simple mode. */
  qty: string | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  item_id: string | null;
  source: LineSource;
}

/** Exactly the ADR-001 field set; absent optional fields are null, never omitted. */
export interface SigningPayload {
  id: string;
  account_id: string;
  type: SignedEntryType;
  amount: number;
  lines: SigningLine[];
  taken_by_type: TakenByType | null;
  representative_id: string | null;
  order_id: string | null;
  ref_entry_id: string | null;
  reason: string | null;
  device_id: string | null;
  device_seq: number | null;
  recorded_at: string;
}

export type SigningLineInput = Partial<Omit<SigningLine, 'name' | 'amount'>> &
  Pick<SigningLine, 'name' | 'amount'>;

export type SigningInput = Partial<
  Omit<SigningPayload, 'id' | 'account_id' | 'type' | 'amount' | 'lines' | 'recorded_at'>
> &
  Pick<SigningPayload, 'id' | 'account_id' | 'type' | 'amount' | 'recorded_at'> & {
    lines?: SigningLineInput[];
  };

/** RFC 3339 UTC with exactly three fractional digits, as `Date.prototype.toISOString` writes. */
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isCanonicalTimestamp(value: string): boolean {
  if (!CANONICAL_TIMESTAMP.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString() === value;
}

/** Builds the payload with every optional field present (null) and validates its shape. */
export function buildSigningPayload(input: SigningInput): SigningPayload {
  assertSantim(input.amount);
  if (!isCanonicalTimestamp(input.recorded_at)) {
    throw new Error(`recorded_at must be RFC 3339 UTC with milliseconds: ${input.recorded_at}`);
  }
  if (
    input.device_seq != null &&
    (!Number.isSafeInteger(input.device_seq) || input.device_seq < 1)
  ) {
    throw new Error('device_seq must be a positive integer');
  }
  const lines = (input.lines ?? []).map((l): SigningLine => {
    assertSantim(l.amount, 'line amount');
    if (l.unit_price != null) assertSantim(l.unit_price, 'unit_price');
    if (l.qty != null && !isCanonicalQty(l.qty)) {
      throw new Error(`qty must be canonical decimal text: ${l.qty}`);
    }
    return {
      name: l.name,
      qty: l.qty ?? null,
      unit: l.unit ?? null,
      unit_price: l.unit_price ?? null,
      amount: l.amount,
      item_id: l.item_id ?? null,
      source: l.source ?? 'manual',
    };
  });
  return {
    id: input.id,
    account_id: input.account_id,
    type: input.type,
    amount: input.amount,
    lines,
    taken_by_type: input.taken_by_type ?? null,
    representative_id: input.representative_id ?? null,
    order_id: input.order_id ?? null,
    ref_entry_id: input.ref_entry_id ?? null,
    reason: input.reason ?? null,
    device_id: input.device_id ?? null,
    device_seq: input.device_seq ?? null,
    recorded_at: input.recorded_at,
  };
}

/** UTF-8 bytes of the JCS form: what the device signs. */
export function signingBytes(payload: SigningPayload): Uint8Array {
  return canonicalBytes(payload);
}

export function payloadHash(payload: SigningPayload): Promise<string> {
  return sha256Hex(signingBytes(payload));
}

export interface ChainLink {
  seq: number;
  prev_hash: string;
  payload_hash: string;
  /** Null for server-origin entries. */
  device_sig: string | null;
  /** RFC 3339 UTC with milliseconds. */
  received_at: string;
}

/** `hash = sha256(JCS({ seq, prev_hash, payload_hash, device_sig, received_at }))`, hex (ADR-001). */
export function entryHash(link: ChainLink): Promise<string> {
  if (!isCanonicalTimestamp(link.received_at)) {
    throw new Error(`received_at must be RFC 3339 UTC with milliseconds: ${link.received_at}`);
  }
  return sha256Hex(
    canonicalBytes({
      seq: link.seq,
      prev_hash: link.prev_hash,
      payload_hash: link.payload_hash,
      device_sig: link.device_sig,
      received_at: link.received_at,
    }),
  );
}
