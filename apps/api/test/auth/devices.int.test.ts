import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lastOtp, login, nextIp, refreshBody } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

const spki = (key: { export(o: { format: 'der'; type: 'spki' }): Buffer }) =>
  key.export({ format: 'der', type: 'spki' }).toString('base64');

describe('devices', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('key validation at sign-in', () => {
    const verifyWithKey = async (publicKey: string) => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      return t.post(
        '/v1/auth/verify',
        { phone, code: lastOtp(t, phone), device: { id: randomUUID(), public_key: publicKey } },
        { ip },
      );
    };

    it('rejects a P-384 key', async () => {
      const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
      const res = await verifyWithKey(spki(publicKey));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_device_key');
    });

    it('rejects an RSA key', async () => {
      const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      expect((await verifyWithKey(spki(publicKey))).body.code).toBe('invalid_device_key');
    });

    it('rejects bytes that are not a key', async () => {
      expect((await verifyWithKey(Buffer.from('not a key').toString('base64'))).body.code).toBe(
        'invalid_device_key',
      );
    });

    it('does not consume the OTP when the key is invalid', async () => {
      const phone = nextPhone();
      const ip = nextIp();
      await t.post('/v1/auth/otp', { phone }, { ip });
      const code = lastOtp(t, phone);
      await t.post(
        '/v1/auth/verify',
        { phone, code, device: { id: randomUUID(), public_key: 'AAAA' } },
        { ip },
      );
      const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const ok = await t.post(
        '/v1/auth/verify',
        { phone, code, device: { id: randomUUID(), public_key: spki(publicKey) } },
        { ip },
      );
      expect(ok.status).toBe(200);
    });
  });

  describe('list and revoke', () => {
    it('lists my devices and marks the current one', async () => {
      const a = await login(t);
      const b = await login(t, { phone: a.phone });
      const res = await t.get('/v1/devices', { token: b.accessToken });
      expect(res.status).toBe(200);
      expect(res.body.devices).toHaveLength(2);
      expect(res.body.devices.find((d: { id: string }) => d.id === b.device.id).current).toBe(true);
      expect(res.body.devices.find((d: { id: string }) => d.id === a.device.id).current).toBe(
        false,
      );
    });

    it('revokes a lost phone: its refresh token stops working', async () => {
      const lost = await login(t);
      const current = await login(t, { phone: lost.phone });
      const del = await t.delete(`/v1/devices/${lost.device.id}`, { token: current.accessToken });
      expect(del.status).toBe(204);

      const res = await t.post('/v1/auth/refresh', refreshBody(lost.device, lost.refreshToken));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('device_revoked');

      const list = await t.get('/v1/devices', { token: current.accessToken });
      const row = list.body.devices.find((d: { id: string }) => d.id === lost.device.id);
      expect(row.revoked_at).toBe(t.clock.now().toISOString());
    });

    it('is idempotent', async () => {
      const a = await login(t);
      const b = await login(t, { phone: a.phone });
      expect((await t.delete(`/v1/devices/${a.device.id}`, { token: b.accessToken })).status).toBe(
        204,
      );
      expect((await t.delete(`/v1/devices/${a.device.id}`, { token: b.accessToken })).status).toBe(
        204,
      );
    });

    it("cannot revoke someone else's device", async () => {
      const victim = await login(t);
      const other = await login(t);
      const res = await t.delete(`/v1/devices/${victim.device.id}`, { token: other.accessToken });
      expect(res.status).toBe(404);
      expect(
        (await t.post('/v1/auth/refresh', refreshBody(victim.device, victim.refreshToken))).status,
      ).toBe(200);
    });

    it('a revoked device cannot sign in again with the same id', async () => {
      const a = await login(t);
      const b = await login(t, { phone: a.phone });
      await t.delete(`/v1/devices/${a.device.id}`, { token: b.accessToken });
      await expect(login(t, { phone: a.phone, device: a.device })).rejects.toThrow(
        /device_revoked/,
      );
    });

    it('rejects a malformed id', async () => {
      const a = await login(t);
      const res = await t.delete('/v1/devices/not-a-uuid', { token: a.accessToken });
      expect(res.status).toBe(400);
    });
  });
});
