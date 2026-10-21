import { describe, expect, it } from 'vitest';
import { formatBirr, isCanonicalQty, lineAmount, normalizeQty, parseBirr } from './money.js';
import type { Language } from './schemas/auth.js';
import { loadVectors } from './test-vectors.js';

interface MoneyVectors {
  parse_birr: { input: string; santim: number }[];
  parse_birr_invalid: string[];
  line_amount: { unit_price: number; qty: string; amount: number }[];
  normalize_qty: { input: string; qty: string }[];
  format_birr: { santim: number; language: Language; text: string }[];
}

const v = loadVectors<MoneyVectors>('money');

describe('money (test-vectors/money.json)', () => {
  it.each(v.parse_birr)('parseBirr($input) = $santim', ({ input, santim }) => {
    expect(parseBirr(input)).toBe(santim);
  });

  it.each(v.parse_birr_invalid)('parseBirr(%j) throws', (input) => {
    expect(() => parseBirr(input)).toThrow();
  });

  it.each(v.line_amount)(
    'lineAmount($unit_price, $qty) = $amount',
    ({ unit_price, qty, amount }) => {
      expect(lineAmount(unit_price, qty)).toBe(amount);
    },
  );

  it.each(v.normalize_qty)('normalizeQty($input) = $qty', ({ input, qty }) => {
    expect(normalizeQty(input)).toBe(qty);
    expect(isCanonicalQty(qty)).toBe(true);
  });

  it.each(v.format_birr)('formatBirr($santim, $language)', ({ santim, language, text }) => {
    expect(formatBirr(santim, language)).toBe(text);
  });

  it('rejects floats and non-canonical quantities', () => {
    expect(() => lineAmount(10.5, '1')).toThrow(/integer/);
    expect(() => lineAmount(100, '1.50')).toThrow(/canonical/);
    expect(() => lineAmount(-1, '1')).toThrow(/negative/);
    expect(() => formatBirr(0.1, 'en')).toThrow(/integer/);
  });
});
