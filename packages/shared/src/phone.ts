/**
 * Ethiopian mobile numbers (ADR-005). Returns E.164 (`+2519XXXXXXXX` for ethio telecom,
 * `+2517XXXXXXXX` for Safaricom) or null when the input is not an Ethiopian mobile number.
 *
 * Accepts `0911…`, `911…`, `251911…`, `+251911…`, `00251911…`, `+251 (0) 911…`,
 * with spaces, dashes, dots or parentheses.
 */
export function normalizeEthiopianPhone(input: string): string | null {
  let digits = input.trim().replace(/[\s\-.()]/g, '');
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
    if (!digits.startsWith('251')) return null;
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
    if (!digits.startsWith('251')) return null;
  }
  if (!/^\d+$/.test(digits)) return null;

  let national: string;
  if (digits.length === 12 && digits.startsWith('251')) national = digits.slice(3);
  else if (digits.length === 13 && digits.startsWith('2510')) national = digits.slice(4);
  else if (digits.length === 10 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 9) national = digits;
  else return null;

  return /^[79]\d{8}$/.test(national) ? `+251${national}` : null;
}
