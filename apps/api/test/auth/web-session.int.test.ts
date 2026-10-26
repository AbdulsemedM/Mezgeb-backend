import { randomUUID, webcrypto } from 'node:crypto';
import { p1363ToDer, webRefreshSigningInput } from '@mezgeb/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lastOtp, nextIp } from '../setup/auth.js';
import { nextPhone } from '../setup/fixtures.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/**
 * ADR-016: the PWA's session. The refresh token lives only in an httpOnly cookie; the PWA signs
 * the token's public `refresh_id` with its non-extractable WebCrypto key.
 */
describe('PWA cookie session (ADR-016)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  /** The `mz_refresh` value from a response's Set-Cookie, with its attributes. */
  function refreshCookie(headers: Headers): { value: string; attrs: string } | undefined {
    const raw = headers.getSetCookie().find((c) => c.startsWith('mz_refresh='));
    if (!raw) return undefined;
    const [pair, ...attrs] = raw.split(';');
    return { value: pair!.slice('mz_refresh='.length), attrs: attrs.join(';').toLowerCase() };
  }

  async function pwaSignIn() {
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
      {
        phone,
        code: lastOtp(t, phone),
        device: { id: deviceId, public_key: spki, label: 'PWA' },
        session: 'cookie',
      },
      { ip },
    );
    const sign = async (refreshId: string) =>
      Buffer.from(
        p1363ToDer(
          new Uint8Array(
            await webcrypto.subtle.sign(
              { name: 'ECDSA', hash: 'SHA-256' },
              keys.privateKey,
              new TextEncoder().encode(webRefreshSigningInput(refreshId)),
            ),
          ),
        ),
      ).toString('base64');
    return { res, deviceId, sign };
  }

  const webRefresh = (cookie: string | undefined, body: object) =>
    t.post('/v1/auth/web/refresh', body, cookie ? { headers: { cookie } } : {});

  it('sign-in sets an httpOnly cookie and leaves the token out of the body', async () => {
    const { res } = await pwaSignIn();
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBeUndefined();
    expect(res.body.access_token).toEqual(expect.any(String));
    expect(res.body.refresh_id).toEqual(expect.any(String));
    const cookie = refreshCookie(res.headers);
    expect(cookie?.value.length).toBeGreaterThan(20);
    expect(cookie?.attrs).toContain('httponly');
    expect(cookie?.attrs).toContain('secure');
    expect(cookie?.attrs).toContain('samesite=lax');
    expect(cookie?.attrs).toContain('path=/v1/auth');
  });

  it('the app flow is unchanged: token in the body, no cookie', async () => {
    const phone = nextPhone();
    const ip = nextIp();
    await t.post('/v1/auth/otp', { phone }, { ip });
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ]);
    const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', keys.publicKey)).toString(
      'base64',
    );
    const res = await t.post(
      '/v1/auth/verify',
      { phone, code: lastOtp(t, phone), device: { id: randomUUID(), public_key: spki } },
      { ip },
    );
    expect(res.body.refresh_token).toEqual(expect.any(String));
    expect(refreshCookie(res.headers)).toBeUndefined();
  });

  it('refreshes with the cookie and a signature over refresh_id, and rotates', async () => {
    const s = await pwaSignIn();
    const cookie = refreshCookie(s.res.headers)!;
    const res = await webRefresh(`mz_refresh=${cookie.value}`, {
      device_id: s.deviceId,
      device_sig: await s.sign(s.res.body.refresh_id),
    });
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBeUndefined();
    expect(res.body.refresh_id).not.toBe(s.res.body.refresh_id);
    const next = refreshCookie(res.headers)!;
    expect(next.value).not.toBe(cookie.value);

    // The new access token works.
    expect((await t.get('/v1/me', { token: res.body.access_token })).status).toBe(200);
  });

  it('refuses a missing cookie', async () => {
    const s = await pwaSignIn();
    const res = await webRefresh(undefined, {
      device_id: s.deviceId,
      device_sig: await s.sign(s.res.body.refresh_id),
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('refresh_invalid');
  });

  it('a stolen cookie is useless without the key', async () => {
    const s = await pwaSignIn();
    const other = await pwaSignIn();
    const cookie = refreshCookie(s.res.headers)!;
    const res = await webRefresh(`mz_refresh=${cookie.value}`, {
      device_id: s.deviceId,
      device_sig: await other.sign(s.res.body.refresh_id),
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('refresh_invalid');
  });

  it('a signature over another token id is refused', async () => {
    const s = await pwaSignIn();
    const cookie = refreshCookie(s.res.headers)!;
    const res = await webRefresh(`mz_refresh=${cookie.value}`, {
      device_id: s.deviceId,
      device_sig: await s.sign(randomUUID()),
    });
    expect(res.status).toBe(401);
  });

  it('a lost response can be retried with the old cookie within the grace window', async () => {
    const s = await pwaSignIn();
    const cookie = `mz_refresh=${refreshCookie(s.res.headers)!.value}`;
    const body = { device_id: s.deviceId, device_sig: await s.sign(s.res.body.refresh_id) };
    expect((await webRefresh(cookie, body)).status).toBe(200);
    const retry = await webRefresh(cookie, body);
    expect(retry.status).toBe(200);
  });

  it('logout clears the cookie', async () => {
    const s = await pwaSignIn();
    const res = await t.post('/v1/auth/logout', {}, { token: s.res.body.access_token });
    expect(res.status).toBe(204);
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith('mz_refresh='));
    expect(cleared).toMatch(/expires=Thu, 01 Jan 1970/i);
  });

  it('CORS allows the PWA origin with credentials, and no other origin', async () => {
    const pre = await fetch(`${t.baseUrl}/v1/auth/web/refresh`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(pre.headers.get('access-control-allow-credentials')).toBe('true');

    const evil = await fetch(`${t.baseUrl}/v1/health`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
});
