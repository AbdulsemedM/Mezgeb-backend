import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseDevicePublicKey, verifyDeviceSignature } from './device-key.js';

const p256 = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    spki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    sign: (data: string, dsaEncoding: 'der' | 'ieee-p1363' = 'der') =>
      sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding }).toString('base64'),
  };
};

describe('device-key', () => {
  it('parses a P-256 SPKI key', () => {
    expect(parseDevicePublicKey(p256().spki)).not.toBeNull();
  });

  it('rejects P-384 and garbage', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
    expect(
      parseDevicePublicKey(publicKey.export({ format: 'der', type: 'spki' }).toString('base64')),
    ).toBeNull();
    expect(parseDevicePublicKey('AAAA')).toBeNull();
    expect(parseDevicePublicKey('')).toBeNull();
  });

  it('verifies a DER signature round trip', () => {
    const k = p256();
    expect(verifyDeviceSignature(k.spki, 'hello', k.sign('hello'))).toBe(true);
  });

  it('rejects a signature over other data, from another key, or in raw (P1363) form', () => {
    const k = p256();
    expect(verifyDeviceSignature(k.spki, 'hello', k.sign('hullo'))).toBe(false);
    expect(verifyDeviceSignature(k.spki, 'hello', p256().sign('hello'))).toBe(false);
    expect(verifyDeviceSignature(k.spki, 'hello', k.sign('hello', 'ieee-p1363'))).toBe(false);
    expect(verifyDeviceSignature(k.spki, 'hello', 'not base64 at all!')).toBe(false);
  });
});
