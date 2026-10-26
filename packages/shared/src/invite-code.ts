/**
 * Invite short codes (ADR-016): 8 characters from an alphabet without look-alikes
 * (no 0/O, 1/I/L, U), so a code read aloud or retyped from an SMS survives.
 */
export const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_CODE_LENGTH = 8;

/** A new code from `randomBytes` (one byte per character; rejection sampling keeps it uniform). */
export function makeInviteCode(randomBytes: (n: number) => Uint8Array): string {
  const n = INVITE_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let code = '';
  while (code.length < INVITE_CODE_LENGTH) {
    for (const b of randomBytes(INVITE_CODE_LENGTH * 2)) {
      if (b < limit && code.length < INVITE_CODE_LENGTH) code += INVITE_CODE_ALPHABET[b % n];
    }
  }
  return code;
}

/**
 * The canonical form of a code as typed or pasted: upper case, spaces and dashes removed.
 * Look-alikes (0, O, 1, I, L, U) are not in the alphabet and are refused. Null when it cannot be a code.
 */
export function normalizeInviteCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of code) if (!INVITE_CODE_ALPHABET.includes(ch)) return null;
  return code;
}
