import { createPublicKey, generateKeyPairSync, verify, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { derToP1363, p1363ToDer } from './ecdsa.js';

interface EcdsaVectors {
  public_key_spki_b64: string;
  cases: { name: string; message: string; raw_hex: string; der_hex: string }[];
  invalid_der_hex: { name: string; der_hex: string }[];
}

const v = JSON.parse(
  readFileSync(new URL('../test-vectors/ecdsa-der.json', import.meta.url), 'utf8'),
) as EcdsaVectors;
const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('ECDSA encodings (test-vectors/ecdsa-der.json)', () => {
  const publicKey = createPublicKey({
    key: Buffer.from(v.public_key_spki_b64, 'base64'),
    format: 'der',
    type: 'spki',
  });

  it.each(v.cases)('$name: raw → DER', ({ raw_hex, der_hex, message }) => {
    const der = p1363ToDer(hex(raw_hex));
    expect(toHex(der)).toBe(der_hex);
    expect(
      verify('sha256', Buffer.from(message), { key: publicKey, dsaEncoding: 'der' }, der),
    ).toBe(true);
  });

  it.each(v.cases)('$name: DER → raw', ({ raw_hex, der_hex }) => {
    expect(toHex(derToP1363(hex(der_hex)))).toBe(raw_hex);
  });

  it.each(v.invalid_der_hex)('rejects invalid DER: $name', ({ der_hex }) => {
    expect(() => derToP1363(hex(der_hex))).toThrow();
  });

  it('rejects a raw signature of the wrong length', () => {
    expect(() => p1363ToDer(new Uint8Array(63))).toThrow(/64 bytes/);
  });

  it('converts a WebCrypto signature into one Node verifies as DER', async () => {
    const { publicKey: pub, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const key = await webcrypto.subtle.importKey(
      'pkcs8',
      privateKey.export({ format: 'der', type: 'pkcs8' }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    for (let i = 0; i < 50; i++) {
      const data = new TextEncoder().encode(`message ${i}`);
      const raw = new Uint8Array(
        await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data),
      );
      const der = p1363ToDer(raw);
      expect(verify('sha256', data, { key: pub, dsaEncoding: 'der' }, der)).toBe(true);
      expect(derToP1363(der)).toEqual(raw);
    }
  });
});
