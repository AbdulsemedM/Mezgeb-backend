import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  makeInviteCode,
  normalizeInviteCode,
} from './invite-code.js';
import { loadVectors } from './test-vectors.js';

const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

describe('invite codes', () => {
  it('makes 8 characters from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeInviteCode(bytes);
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      for (const ch of code) expect(INVITE_CODE_ALPHABET).toContain(ch);
    }
  });

  it('skips bytes that would bias the alphabet', () => {
    // 240 and above are rejected for a 30-letter alphabet.
    const fixed = () => Uint8Array.from([255, 241, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(makeInviteCode(fixed)).toBe('23456789');
  });

  it('normalizes what people type', () => {
    expect(normalizeInviteCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeInviteCode(' k7m2 p9qx ')).toBe('K7M2P9QX');
  });

  it('rejects look-alikes and wrong lengths', () => {
    expect(normalizeInviteCode('ABCDEFG0')).toBeNull();
    expect(normalizeInviteCode('ABCDEFGI')).toBeNull();
    expect(normalizeInviteCode('ABCDEFG')).toBeNull();
    expect(normalizeInviteCode('ABCDEFGHJ')).toBeNull();
  });
});

describe('invite-code.json vectors', () => {
  const { cases } = loadVectors<{ cases: { input: string; output: string | null }[] }>(
    'invite-code',
  );
  it.each(cases)('$input', ({ input, output }) => {
    expect(normalizeInviteCode(input)).toBe(output);
  });
});
