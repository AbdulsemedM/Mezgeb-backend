import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalize } from './jcs.js';
import { loadVectors } from './test-vectors.js';

const v = loadVectors<{ cases: { name: string; input_json: string; canonical: string }[] }>('jcs');

describe('JCS (test-vectors/jcs.json)', () => {
  it.each(v.cases)('$name', ({ input_json, canonical }) => {
    expect(canonicalize(JSON.parse(input_json))).toBe(canonical);
  });

  it('is idempotent', () => {
    for (const c of v.cases) expect(canonicalize(JSON.parse(c.canonical))).toBe(c.canonical);
  });

  it('encodes as UTF-8', () => {
    expect(Array.from(canonicalBytes({ a: 'é' }))).toEqual([
      0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0xa9, 0x22, 0x7d,
    ]);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['undefined value', { a: undefined }],
    ['bigint', 1n],
    ['function', () => 1],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalize(value)).toThrow(/JCS/);
  });
});
