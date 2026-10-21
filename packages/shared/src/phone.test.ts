import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeEthiopianPhone } from './phone.js';

interface PhoneVectors {
  cases: { input: string; output: string | null }[];
}

const vectors = JSON.parse(
  readFileSync(new URL('../test-vectors/phone.json', import.meta.url), 'utf8'),
) as PhoneVectors;

describe('normalizeEthiopianPhone (test-vectors/phone.json)', () => {
  it.each(vectors.cases)('$input -> $output', ({ input, output }) => {
    expect(normalizeEthiopianPhone(input)).toBe(output);
  });
});
