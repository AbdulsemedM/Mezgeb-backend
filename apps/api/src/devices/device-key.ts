import { createPublicKey, type KeyObject, verify } from 'node:crypto';

/**
 * Parses a device public key: ECDSA P-256, SPKI DER, base64 (ADR-001).
 * Returns null for anything else (other curves, RSA, garbage).
 */
export function parseDevicePublicKey(spkiBase64: string): KeyObject | null {
  try {
    const key = createPublicKey({
      key: Buffer.from(spkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ec') return null;
    if (key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    return key;
  } catch {
    return null;
  }
}

/** Verifies an ECDSA P-256 / SHA-256 signature (DER, base64) over `data`. */
export function verifyDeviceSignature(
  spkiBase64: string,
  data: string | Uint8Array,
  signatureBase64: string,
): boolean {
  const key = parseDevicePublicKey(spkiBase64);
  if (!key) return false;
  try {
    return verify(
      'sha256',
      typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
      { key, dsaEncoding: 'der' },
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}
