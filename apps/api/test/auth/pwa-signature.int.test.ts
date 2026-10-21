import { randomUUID, webcrypto } from 'node:crypto';
import { p1363ToDer, refreshSigningInput } from '@mezgeb/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lastOtp, nextIp } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/**
 * ADR-006: the PWA signs with a non-extractable WebCrypto key, which yields raw P1363
 * signatures; it converts them with p1363ToDer before sending, since DER is the wire format.
 */
describe('PWA (WebCrypto) device signatures', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function pwaLogin() {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
    const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', keys.publicKey)).toString(
      'base64',
    );
    const deviceId = randomUUID();
    const phone = nextPhone();
    const ip = nextIp();
    await t.post('/v1/auth/otp', { phone }, { ip });
    const res = await t.post(
      '/v1/auth/verify',
      { phone, code: lastOtp(t, phone), device: { id: deviceId, public_key: spki, label: 'PWA' } },
      { ip },
    );
    expect(res.status).toBe(200);
    const rawSign = async (text: string) =>
      new Uint8Array(
        await webcrypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keys.privateKey,
          new TextEncoder().encode(text),
        ),
      );
    return { deviceId, refreshToken: res.body.refresh_token as string, rawSign };
  }

  it('refreshes with a WebCrypto signature converted to DER', async () => {
    const s = await pwaLogin();
    const raw = await s.rawSign(refreshSigningInput(s.refreshToken));
    const res = await t.post('/v1/auth/refresh', {
      refresh_token: s.refreshToken,
      device_id: s.deviceId,
      device_sig: Buffer.from(p1363ToDer(raw)).toString('base64'),
    });
    expect(res.status).toBe(200);
  });

  it('rejects the raw P1363 signature as sent by WebCrypto without conversion', async () => {
    const s = await pwaLogin();
    const raw = await s.rawSign(refreshSigningInput(s.refreshToken));
    const res = await t.post('/v1/auth/refresh', {
      refresh_token: s.refreshToken,
      device_id: s.deviceId,
      device_sig: Buffer.from(raw).toString('base64'),
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('refresh_invalid');
  });
});
