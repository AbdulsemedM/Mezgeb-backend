import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevModule } from '../../src/dev/dev.module.js';
import { lastOtp, newDevice, nextIp } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

describe('GET /v1/dev/otp (dev only, for the app integration test)', () => {
  describe('without DEV_ROUTES', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startTestApp();
    });
    afterAll(async () => {
      await t?.close();
    });

    it('does not exist', async () => {
      const res = await t.get('/v1/dev/otp?phone=0911234567');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'not_found' });
    });
  });

  describe('with the dev module', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await startTestApp({ imports: [DevModule] });
    });
    afterAll(async () => {
      await t?.close();
    });

    it('returns the last code sent to a phone, which then signs in', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      expect((await t.post('/v1/auth/otp', { phone }, { ip })).status).toBe(202);

      // Any accepted spelling of the number finds it.
      const local = `0${phone.slice(4)}`;
      const res = await t.get(`/v1/dev/otp?phone=${encodeURIComponent(local)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ phone, code: lastOtp(t, phone) });

      const device = newDevice();
      const verify = await t.post(
        '/v1/auth/verify',
        { phone, code: res.body.code, device: { id: device.id, public_key: device.publicKey } },
        { ip },
      );
      expect(verify.status).toBe(200);
    });

    it('404 when no code was sent to the phone', async () => {
      const res = await t.get(`/v1/dev/otp?phone=${encodeURIComponent(nextPhone())}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'not_found' });
    });

    it('400 invalid_phone for a number that is not Ethiopian mobile', async () => {
      const res = await t.get('/v1/dev/otp?phone=0111234567');
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'invalid_phone' });
    });
  });
});
