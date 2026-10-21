import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lastOtp, login, newDevice, nextIp, refreshBody, signWith } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { startTestApp, TEST_ENV, type TestApp } from '../setup/test-app.js';

/** ADR-005: access tokens, refresh rotation, reuse detection and device binding. */
describe('sessions', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  const refresh = (body: object) => t.post('/v1/auth/refresh', body);
  const me = (token: string) => t.get('/v1/me', { token });

  describe('access token', () => {
    it('is required on protected routes', async () => {
      const res = await t.get('/v1/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('unauthorized');
    });

    it('expires after 15 minutes with token_expired', async () => {
      const s = await login(t);
      t.clock.advance(15 * 60_000 - 61_000 - 1_000);
      expect((await me(s.accessToken)).status).toBe(200);
      t.clock.advance(2_000);
      const res = await me(s.accessToken);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('token_expired');
    });

    it('rejects a tampered token', async () => {
      const s = await login(t);
      const [h, p, sig] = s.accessToken.split('.');
      const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
      payload.sub = '00000000-0000-7000-8000-000000000000';
      const forged = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), sig].join('.');
      expect((await me(forged)).body.code).toBe('unauthorized');
    });

    it('rejects a token signed with another secret', async () => {
      const s = await login(t);
      const now = Math.floor(t.clock.now().getTime() / 1000);
      const forged = await new SignJWT({ did: s.device.id })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(s.userId)
        .setIssuedAt(now)
        .setExpirationTime(now + 600)
        .sign(new TextEncoder().encode('another-secret-another-secret-0000'));
      expect((await me(forged)).body.code).toBe('unauthorized');
    });

    it('rejects alg none', async () => {
      const s = await login(t);
      const [, p] = s.accessToken.split('.');
      const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
      expect((await me(none)).status).toBe(401);
    });

    it('uses the configured secret (sanity check of the harness)', () => {
      expect(TEST_ENV.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('refresh rotation', () => {
    it('issues a new pair and the new access token works', async () => {
      const s = await login(t);
      const res = await refresh(refreshBody(s.device, s.refreshToken));
      expect(res.status).toBe(200);
      expect(res.body.refresh_token).not.toBe(s.refreshToken);
      expect((await me(res.body.access_token)).status).toBe(200);
    });

    it('chains several rotations', async () => {
      const s = await login(t);
      let token = s.refreshToken;
      for (let i = 0; i < 3; i++) {
        t.clock.advance(5 * 60_000);
        const res = await refresh(refreshBody(s.device, token));
        expect(res.status).toBe(200);
        token = res.body.refresh_token;
      }
    });

    it('detects reuse and revokes the whole family', async () => {
      const s = await login(t);
      const r1 = await refresh(refreshBody(s.device, s.refreshToken));
      const r2 = await refresh(refreshBody(s.device, r1.body.refresh_token));
      expect(r2.status).toBe(200);

      // An attacker replays the first token after its successor was used.
      const replay = await refresh(refreshBody(s.device, s.refreshToken));
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('refresh_reused');

      // The legitimate latest token is now dead too.
      const latest = await refresh(refreshBody(s.device, r2.body.refresh_token));
      expect(latest.status).toBe(401);
      expect(latest.body.code).toBe('refresh_invalid');
    });

    it('treats reuse after the grace window as theft even if the successor is unused', async () => {
      const s = await login(t);
      const r1 = await refresh(refreshBody(s.device, s.refreshToken));
      t.clock.advance(2 * 60_000 + 1);
      const replay = await refresh(refreshBody(s.device, s.refreshToken));
      expect(replay.body.code).toBe('refresh_reused');
      expect((await refresh(refreshBody(s.device, r1.body.refresh_token))).status).toBe(401);
    });

    it('expires 60 days after the last rotation', async () => {
      const s = await login(t);
      t.clock.advance(59 * 24 * 60 * 60_000);
      const r1 = await refresh(refreshBody(s.device, s.refreshToken));
      expect(r1.status).toBe(200);
      t.clock.advance(60 * 24 * 60 * 60_000 + 1);
      const res = await refresh(refreshBody(s.device, r1.body.refresh_token));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('refresh_expired');
    });

    it('rejects an unknown token', async () => {
      const s = await login(t);
      const res = await refresh(refreshBody(s.device, 'x'.repeat(43)));
      expect(res.body.code).toBe('refresh_invalid');
    });
  });

  describe('lost response on a bad connection (retry grace)', () => {
    it('rotates again when the successor was never used, within 2 minutes', async () => {
      const s = await login(t);
      const lost = await refresh(refreshBody(s.device, s.refreshToken));
      expect(lost.status).toBe(200);
      t.clock.advance(30_000);

      const retry = await refresh(refreshBody(s.device, s.refreshToken));
      expect(retry.status).toBe(200);
      expect(retry.body.refresh_token).not.toBe(lost.body.refresh_token);

      // The lost successor is revoked; the retried one works.
      expect((await refresh(refreshBody(s.device, lost.body.refresh_token))).body.code).toBe(
        'refresh_invalid',
      );
      expect((await refresh(refreshBody(s.device, retry.body.refresh_token))).status).toBe(200);
    });

    it('measures the window from the first rotation, not the last retry', async () => {
      const s = await login(t);
      await refresh(refreshBody(s.device, s.refreshToken));
      t.clock.advance(90_000);
      expect((await refresh(refreshBody(s.device, s.refreshToken))).status).toBe(200);
      t.clock.advance(60_000); // 150 s after the first rotation
      expect((await refresh(refreshBody(s.device, s.refreshToken))).body.code).toBe(
        'refresh_reused',
      );
    });

    it('does not apply once the successor has been used', async () => {
      const s = await login(t);
      const r1 = await refresh(refreshBody(s.device, s.refreshToken));
      await refresh(refreshBody(s.device, r1.body.refresh_token));
      const replay = await refresh(refreshBody(s.device, s.refreshToken));
      expect(replay.body.code).toBe('refresh_reused');
    });
  });

  describe('device binding', () => {
    it('rejects a refresh signed by another key', async () => {
      const s = await login(t);
      const other = newDevice();
      const res = await refresh({
        refresh_token: s.refreshToken,
        device_id: s.device.id,
        device_sig: signWith(other, `mezgeb-refresh-v1:${s.refreshToken}`),
      });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('refresh_invalid');
    });

    it('rejects a signature over the wrong message', async () => {
      const s = await login(t);
      const res = await refresh({
        refresh_token: s.refreshToken,
        device_id: s.device.id,
        device_sig: signWith(s.device, s.refreshToken),
      });
      expect(res.body.code).toBe('refresh_invalid');
    });

    it('rejects a token presented for a different device', async () => {
      const a = await login(t);
      const b = await login(t, { phone: a.phone });
      const res = await refresh(refreshBody(b.device, a.refreshToken));
      expect(res.body.code).toBe('refresh_invalid');
    });

    it('a bad signature does not trigger reuse revocation', async () => {
      const s = await login(t);
      const r1 = await refresh(refreshBody(s.device, s.refreshToken));
      // Someone with the old token but without the device key:
      const thief = newDevice();
      await refresh({
        refresh_token: s.refreshToken,
        device_id: s.device.id,
        device_sig: signWith(thief, `mezgeb-refresh-v1:${s.refreshToken}`),
      });
      t.clock.advance(3 * 60_000);
      expect((await refresh(refreshBody(s.device, r1.body.refresh_token))).status).toBe(200);
    });

    it('rejects a missing signature with validation_failed', async () => {
      const s = await login(t);
      const res = await refresh({ refresh_token: s.refreshToken, device_id: s.device.id });
      expect(res.body.code).toBe('validation_failed');
    });
  });

  describe('logout', () => {
    it('revokes the refresh token of this device only', async () => {
      const a = await login(t);
      const b = await login(t, { phone: a.phone });
      const out = await t.post('/v1/auth/logout', {}, { token: a.accessToken });
      expect(out.status).toBe(204);
      expect((await refresh(refreshBody(a.device, a.refreshToken))).body.code).toBe(
        'refresh_invalid',
      );
      expect((await refresh(refreshBody(b.device, b.refreshToken))).status).toBe(200);
    });
  });

  describe('sign-in device registration', () => {
    it('accepts the same device id, user and key again', async () => {
      const device = newDevice();
      const a = await login(t, { device });
      const b = await login(t, { phone: a.phone, device });
      expect(b.userId).toBe(a.userId);
    });

    it('rejects a device id registered to another user', async () => {
      const device = newDevice();
      await login(t, { device });
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      const res = await t.post(
        '/v1/auth/verify',
        { phone, code: lastOtp(t, phone), device: { id: device.id, public_key: device.publicKey } },
        { ip },
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('device_conflict');
    });

    it('rejects the same device id with a different key, and the OTP stays usable', async () => {
      const device = newDevice();
      const a = await login(t, { device });
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone: a.phone }, { ip });
      const code = lastOtp(t, a.phone);
      const conflict = await t.post(
        '/v1/auth/verify',
        { phone: a.phone, code, device: { id: device.id, public_key: newDevice().publicKey } },
        { ip },
      );
      expect(conflict.body.code).toBe('device_conflict');
      // The sign-in rolled back, so the code can be used with a correct device.
      const fresh = newDevice();
      const ok = await t.post(
        '/v1/auth/verify',
        { phone: a.phone, code, device: { id: fresh.id, public_key: fresh.publicKey } },
        { ip },
      );
      expect(ok.status).toBe(200);
    });
  });
});
