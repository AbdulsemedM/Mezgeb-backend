import { generateKeyPairSync, type KeyObject, randomUUID, sign } from 'node:crypto';
import { refreshSigningInput } from '@mezgeb/shared';
import { nextPhone } from './fixtures.js';
import type { TestApp } from './test-app.js';

export interface TestDevice {
  id: string;
  publicKey: string;
  privateKey: KeyObject;
}

/** A fresh ECDSA P-256 device key pair, as the app would create in the Android Keystore. */
export function newDevice(): TestDevice {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    id: randomUUID(),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey,
  };
}

export function signWith(device: TestDevice, data: string): string {
  return sign('sha256', Buffer.from(data, 'utf8'), {
    key: device.privateKey,
    dsaEncoding: 'der',
  }).toString('base64');
}

/** The body for POST /v1/auth/refresh, signed by `device` (ADR-005). */
export function refreshBody(device: TestDevice, refreshToken: string) {
  return {
    refresh_token: refreshToken,
    device_id: device.id,
    device_sig: signWith(device, refreshSigningInput(refreshToken)),
  };
}

let ipCounter = 0;
/** A distinct client IP, so per-IP limits don't leak between tests. */
export function nextIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/** Reads the 6-digit code from the last SMS sent to `phone`. */
export function lastOtp(t: TestApp, phone: string): string {
  const text = t.sms.lastTo(phone)?.text ?? '';
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  if (!code) throw new Error(`no OTP SMS for ${phone}`);
  return code;
}

export interface LoggedIn {
  phone: string;
  device: TestDevice;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

/** Full OTP sign-in; each call advances the clock past the resend limit. */
export async function login(
  t: TestApp,
  opts: { phone?: string; device?: TestDevice } = {},
): Promise<LoggedIn> {
  const phone = opts.phone ?? nextPhone();
  const device = opts.device ?? newDevice();
  const ip = nextIp();
  const otp = await t.post('/v1/auth/otp', { phone }, { ip });
  if (otp.status !== 202) throw new Error(`otp failed: ${JSON.stringify(otp.body)}`);
  const res = await t.post(
    '/v1/auth/verify',
    {
      phone,
      code: lastOtp(t, phone),
      device: { id: device.id, public_key: device.publicKey },
    },
    { ip },
  );
  if (res.status !== 200) throw new Error(`verify failed: ${JSON.stringify(res.body)}`);
  t.clock.advance(61_000);
  return {
    phone,
    device,
    userId: res.body.user.id,
    accessToken: res.body.access_token,
    refreshToken: res.body.refresh_token,
  };
}
