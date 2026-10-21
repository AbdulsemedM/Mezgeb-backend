/**
 * ECDSA P-256 signature encodings (ADR-006). The wire format is DER (ADR-001); WebCrypto
 * produces raw IEEE P1363 (r‖s, 32 bytes each), so the PWA converts before sending.
 */

const P256_SCALAR = 32;

/** Raw r‖s (64 bytes) → DER `SEQUENCE { INTEGER r, INTEGER s }`. */
export function p1363ToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 2 * P256_SCALAR) {
    throw new Error(`P-256 raw signature must be ${2 * P256_SCALAR} bytes, got ${raw.length}`);
  }
  const r = derInteger(raw.subarray(0, P256_SCALAR));
  const s = derInteger(raw.subarray(P256_SCALAR));
  const body = [0x02, r.length, ...r, 0x02, s.length, ...s];
  return Uint8Array.from([0x30, body.length, ...body]);
}

/** DER → raw r‖s (64 bytes). Strict: rejects trailing bytes and non-minimal integers. */
export function derToP1363(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) {
    throw new Error('Not a DER ECDSA signature');
  }
  const out = new Uint8Array(2 * P256_SCALAR);
  let pos = 2;
  for (const offset of [0, P256_SCALAR]) {
    if (der[pos] !== 0x02) throw new Error('Expected DER INTEGER');
    const len = der[pos + 1]!;
    const start = pos + 2;
    const int = der.subarray(start, start + len);
    if (int.length !== len || len === 0) throw new Error('Truncated DER INTEGER');
    if (int[0]! & 0x80) throw new Error('Negative DER INTEGER');
    if (len > 1 && int[0] === 0 && !(int[1]! & 0x80)) throw new Error('Non-minimal DER INTEGER');
    const value = int[0] === 0 && len > 1 ? int.subarray(1) : int;
    if (value.length > P256_SCALAR) throw new Error('DER INTEGER too large for P-256');
    out.set(value, offset + P256_SCALAR - value.length);
    pos = start + len;
  }
  if (pos !== der.length) throw new Error('Trailing bytes after DER signature');
  return out;
}

/** Minimal two's-complement big-endian encoding of an unsigned integer. */
function derInteger(bytes: Uint8Array): number[] {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const value = Array.from(bytes.subarray(i));
  return value[0]! & 0x80 ? [0, ...value] : value;
}
