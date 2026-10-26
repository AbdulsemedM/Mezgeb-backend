import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, nextIp } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/** OTP_FIXED_CODE: every code is the same until an SMS gateway exists. */
describe('OTP with a fixed code', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp({ env: { OTP_FIXED_CODE: '654321' } });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('sends and accepts the fixed code', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    const otp = await t.post('/v1/auth/otp', { phone, language: 'en' }, { ip });
    expect(otp.status).toBe(202);
    expect(t.sms.lastTo(phone)?.text).toContain('654321');

    const device = newDevice();
    const res = await t.post(
      '/v1/auth/verify',
      { phone, code: '654321', device: { id: device.id, public_key: device.publicKey } },
      { ip },
    );
    expect(res.status).toBe(200);
  });
});
