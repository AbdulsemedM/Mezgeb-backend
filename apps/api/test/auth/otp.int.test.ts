import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lastOtp, login, newDevice, nextIp } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/** ADR-005: OTP sign-in, expiry, lockout and rate limits. */
describe('OTP sign-in', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  const verify = (phone: string, code: string, ip: string, device = newDevice()) =>
    t.post(
      '/v1/auth/verify',
      { phone, code, device: { id: device.id, public_key: device.publicKey } },
      { ip },
    );

  describe('happy path', () => {
    it('sends a code, verifies it, and the access token works on /v1/me', async () => {
      const ip = nextIp();
      const otp = await t.post('/v1/auth/otp', { phone: '0911 000 001', language: 'en' }, { ip });
      expect(otp.status).toBe(202);
      expect(otp.body).toEqual({
        expires_at: new Date(t.clock.now().getTime() + 5 * 60_000).toISOString(),
        resend_after_s: 60,
      });

      const sms = t.sms.lastTo('+251911000001');
      expect(sms?.text).toMatch(/^Your Nota code is \d{6}\. It expires in 5 minutes/);

      const res = await verify('+251911000001', lastOtp(t, '+251911000001'), ip);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        is_new_user: true,
        user: { phone: '+251911000001', language: 'en', name: null, calendar_pref: null },
        access_token: expect.any(String),
        refresh_token: expect.any(String),
      });

      const me = await t.get('/v1/me', { token: res.body.access_token });
      expect(me.status).toBe(200);
      expect(me.body).toEqual(res.body.user);
    });

    it('signs an existing user into the same account', async () => {
      const first = await login(t);
      const second = await login(t, { phone: first.phone });
      expect(second.userId).toBe(first.userId);
    });

    it('sends the SMS in Amharic by default', async () => {
      const phone = nextPhone();
      await t.post('/v1/auth/otp', { phone }, { ip: nextIp() });
      expect(t.sms.lastTo(phone)?.text).toContain('የኖታ');
    });

    it("sends the SMS in an existing user's language, not the requested one", async () => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone, language: 'om' }, { ip });
      await verify(phone, lastOtp(t, phone), ip);
      t.clock.advance(61_000);
      await t.post('/v1/auth/otp', { phone, language: 'en' }, { ip });
      expect(t.sms.lastTo(phone)?.text).toContain('Koodiin Nota');
    });

    it('answers an unknown phone exactly like a known one', async () => {
      const res = await t.post('/v1/auth/otp', { phone: nextPhone() }, { ip: nextIp() });
      expect(res.status).toBe(202);
      expect(Object.keys(res.body).sort()).toEqual(['expires_at', 'resend_after_s']);
    });
  });

  describe('code checks', () => {
    it('rejects a code after 5 minutes', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      t.clock.advance(5 * 60_000 + 1_000);
      const res = await verify(phone, lastOtp(t, phone), ip);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('otp_expired');
    });

    it('accepts a code just before it expires', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      t.clock.advance(5 * 60_000 - 1_000);
      expect((await verify(phone, lastOtp(t, phone), ip)).status).toBe(200);
    });

    it('rejects a code that was already used', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      const code = lastOtp(t, phone);
      expect((await verify(phone, code, ip)).status).toBe(200);
      const again = await verify(phone, code, ip);
      expect(again.status).toBe(401);
      expect(again.body.code).toBe('otp_invalid');
    });

    it('counts wrong codes and locks the challenge after 5', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      const code = lastOtp(t, phone);
      const wrong = code === '000000' ? '111111' : '000000';

      for (let left = 4; left >= 1; left--) {
        const res = await verify(phone, wrong, ip);
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ code: 'otp_invalid', details: { attempts_left: left } });
      }
      const fifth = await verify(phone, wrong, ip);
      expect(fifth.body.code).toBe('otp_locked');

      // The correct code no longer works either.
      const correct = await verify(phone, code, ip);
      expect(correct.status).toBe(401);
      expect(correct.body.code).toBe('otp_locked');
    });

    it('accepts a fresh code after a lockout', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      for (let i = 0; i < 5; i++) await verify(phone, '999999', ip);
      t.clock.advance(61_000);
      await t.post('/v1/auth/otp', { phone }, { ip });
      expect((await verify(phone, lastOtp(t, phone), ip)).status).toBe(200);
    });

    it('only the latest code counts', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      const old = lastOtp(t, phone);
      t.clock.advance(61_000);
      await t.post('/v1/auth/otp', { phone }, { ip });
      const latest = lastOtp(t, phone);
      if (old !== latest) {
        expect((await verify(phone, old, ip)).body.code).toBe('otp_invalid');
      }
      expect((await verify(phone, latest, ip)).status).toBe(200);
    });

    it('rejects a phone with no challenge', async () => {
      const res = await verify(nextPhone(), '123456', nextIp());
      expect(res.body.code).toBe('otp_invalid');
    });
  });

  describe('validation', () => {
    it.each(['0111234567', '+254711234567', 'abc'])(
      'rejects non-mobile phone %j',
      async (phone) => {
        const res = await t.post('/v1/auth/otp', { phone }, { ip: nextIp() });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_phone');
      },
    );

    it('rejects a malformed body with validation_failed', async () => {
      const res = await t.post(
        '/v1/auth/verify',
        { phone: nextPhone(), code: '12' },
        { ip: nextIp() },
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
      expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'code',
        'device',
      ]);
    });

    it('rejects an unsupported language', async () => {
      const res = await t.post(
        '/v1/auth/otp',
        { phone: nextPhone(), language: 'fr' },
        { ip: nextIp() },
      );
      expect(res.body.code).toBe('validation_failed');
    });
  });

  describe('rate limits', () => {
    it('allows one request per phone per 60 seconds', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      expect((await t.post('/v1/auth/otp', { phone }, { ip })).status).toBe(202);
      t.clock.advance(30_000);
      const res = await t.post('/v1/auth/otp', { phone }, { ip });
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ code: 'otp_rate_limited', details: { retry_after_s: 30 } });
      t.clock.advance(30_000);
      expect((await t.post('/v1/auth/otp', { phone }, { ip })).status).toBe(202);
    });

    it('allows 5 requests per phone per hour', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      for (let i = 0; i < 5; i++) {
        expect((await t.post('/v1/auth/otp', { phone }, { ip })).status).toBe(202);
        t.clock.advance(61_000);
      }
      const sixth = await t.post('/v1/auth/otp', { phone }, { ip });
      expect(sixth.status).toBe(429);
      // The first request was 5 × 61 s ago; it leaves the window 3600 − 305 s from now.
      expect(sixth.body.details.retry_after_s).toBe(3600 - 305);
      t.clock.advance((3600 - 305) * 1000 + 1);
      expect((await t.post('/v1/auth/otp', { phone }, { ip })).status).toBe(202);
    });

    it('allows 20 requests per IP per hour across phones', async () => {
      const ip = nextIp();
      for (let i = 0; i < 20; i++) {
        expect((await t.post('/v1/auth/otp', { phone: nextPhone() }, { ip })).status).toBe(202);
      }
      const res = await t.post('/v1/auth/otp', { phone: nextPhone() }, { ip });
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('otp_rate_limited');
      // Another IP is unaffected.
      expect((await t.post('/v1/auth/otp', { phone: nextPhone() }, { ip: nextIp() })).status).toBe(
        202,
      );
      t.clock.advance(60 * 60_000 + 1);
      expect((await t.post('/v1/auth/otp', { phone: nextPhone() }, { ip })).status).toBe(202);
    });

    it('holds under parallel requests for one phone', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => t.post('/v1/auth/otp', { phone }, { ip })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([202, 429, 429, 429, 429]);
    });
  });
});
