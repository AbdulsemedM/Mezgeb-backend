import type { Language } from './schemas/auth.js';

/** Money is integer santim everywhere (CLAUDE.md rule 2). 1 ETB = 100 santim. */

export function assertSantim(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer number of santim`);
}

/**
 * Parses a birr amount as typed: `12`, `12.5`, `12.50`, `1,234.50`. At most 2 decimals,
 * no sign. Returns santim. Throws on anything else.
 */
export function parseBirr(input: string): number {
  const s = input.trim();
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Not a birr amount: ${JSON.stringify(input)}`);
  const birr = m[1]!.replaceAll(',', '');
  const santim = BigInt(birr) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  if (santim > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount too large');
  return Number(santim);
}

/** `ETB 1,234.50` (en, om) or `1,234.50 ብር` (am). */
export function formatBirr(santim: number, language: Language): string {
  assertSantim(santim);
  const negative = santim < 0;
  const abs = BigInt(Math.abs(santim));
  const birr = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (abs % 100n).toString().padStart(2, '0');
  const number = `${negative ? '-' : ''}${birr}.${cents}`;
  return language === 'am' ? `${number} ብር` : `ETB ${number}`;
}

const CANONICAL_QTY = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;

/** Canonical decimal text for quantities (ADR-004): no sign, no leading or trailing zeros. */
export function isCanonicalQty(qty: string): boolean {
  return CANONICAL_QTY.test(qty);
}

/** Normalizes a typed quantity (`"1.50"` → `"1.5"`, `"02"` → `"2"`). Throws if not a decimal. */
export function normalizeQty(input: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!m) throw new Error(`Not a quantity: ${JSON.stringify(input)}`);
  const int = m[1]!.replace(/^0+(?=\d)/, '');
  const frac = (m[2] ?? '').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/**
 * `unit_price × qty` in santim, rounded half up (ADR-007). Exact: qty is a decimal string and
 * the arithmetic is done in integers.
 */
export function lineAmount(unitPriceSantim: number, qty: string): number {
  assertSantim(unitPriceSantim, 'unit_price');
  if (unitPriceSantim < 0) throw new Error('unit_price must not be negative');
  if (!isCanonicalQty(qty)) throw new Error(`qty must be canonical decimal text: ${qty}`);
  const [int, frac = ''] = qty.split('.');
  const scale = 10n ** BigInt(frac.length);
  const numerator = BigInt(unitPriceSantim) * BigInt(int! + frac);
  const rounded = (numerator * 2n + scale) / (scale * 2n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Line amount too large');
  return Number(rounded);
}
