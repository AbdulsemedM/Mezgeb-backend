import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login } from '../setup/auth.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/** ADR-016: the PWA registers a Web Push subscription as its device's push token. */
describe('web push subscriptions (ADR-016)', () => {
  const vapid = webpush.generateVAPIDKeys();
  let t: TestApp;
  let off: TestApp;

  beforeAll(async () => {
    t = await startTestApp({
      env: { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey },
    });
    off = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
    await off?.close();
  });

  function subscription() {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    };
  }

  it('serves the VAPID public key without sign-in', async () => {
    const res = await t.get('/v1/devices/web-push-key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ vapid_public_key: vapid.publicKey });
  });

  it('serves null when web push is not configured', async () => {
    expect((await off.get('/v1/devices/web-push-key')).body).toEqual({ vapid_public_key: null });
  });

  it('stores a valid subscription', async () => {
    const user = await login(t);
    const res = await t.put(
      '/v1/devices/me/push-token',
      { token: `webpush:${JSON.stringify(subscription())}` },
      { token: user.accessToken },
    );
    expect(res.status).toBe(204);
  });

  it('refuses a malformed subscription', async () => {
    const user = await login(t);
    for (const token of ['webpush:{oops', `webpush:${JSON.stringify({ endpoint: 'x' })}`]) {
      const res = await t.put('/v1/devices/me/push-token', { token }, { token: user.accessToken });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_push_token');
    }
  });
});
