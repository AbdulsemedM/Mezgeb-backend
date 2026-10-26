import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakePushSender, type PushMessage } from './push-sender.js';
import { RoutingPushSender, WebPushSender } from './web-push-sender.js';

/** A stand-in push service: answers with the status queued for each path. */
describe('WebPushSender (ADR-016)', () => {
  let server: Server;
  let base: string;
  const received: { path: string; headers: Record<string, unknown>; bytes: number }[] = [];
  const statusFor: Record<string, number> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({
          path: req.url!,
          headers: req.headers,
          bytes: Buffer.concat(chunks).length,
        });
        res.statusCode = statusFor[req.url!] ?? 201;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const vapid = { ...webpush.generateVAPIDKeys(), subject: 'mailto:test@mezgeb.et' };
  const sender = new WebPushSender(vapid);

  function token(path: string): string {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return `webpush:${JSON.stringify({
      endpoint: `${base}${path}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    })}`;
  }

  const message = (tokens: string[]): PushMessage => ({
    tokens,
    title: 'Mezgeb',
    body: 'Abebe Shop: 120 ETB on your dube',
    data: { event: 'purchase_recorded', account_id: 'a1' },
    sound: false,
  });

  it('accepts only web push tokens', () => {
    expect(sender.accepts(token('/x'))).toBe(true);
    expect(sender.accepts('fcm-token')).toBe(false);
  });

  it('sends an encrypted payload with VAPID auth', async () => {
    const res = await sender.send(message([token('/ok')]));
    expect(res.invalidTokens).toEqual([]);
    const req = received.find((r) => r.path === '/ok')!;
    expect(req.headers['content-encoding']).toBe('aes128gcm');
    expect(String(req.headers.authorization)).toMatch(/^vapid t=.+, k=/);
    expect(req.headers.ttl).toBe('86400');
    expect(req.bytes).toBeGreaterThan(0);
  });

  it('reports 404 and 410 subscriptions as invalid', async () => {
    statusFor['/gone'] = 410;
    statusFor['/missing'] = 404;
    const gone = token('/gone');
    const missing = token('/missing');
    const res = await sender.send(message([gone, missing, token('/ok2')]));
    expect(res.invalidTokens.sort()).toEqual([gone, missing].sort());
  });

  it('reports malformed tokens as invalid', async () => {
    const res = await sender.send(message(['webpush:{not json', 'webpush:{"endpoint":"x"}']));
    expect(res.invalidTokens).toHaveLength(2);
  });

  it('throws when nothing could be delivered because the service failed', async () => {
    statusFor['/down'] = 500;
    await expect(sender.send(message([token('/down')]))).rejects.toBeDefined();
  });

  it('urgent pushes ask for high urgency', async () => {
    await sender.send({ ...message([token('/urgent')]), sound: true });
    expect(received.find((r) => r.path === '/urgent')!.headers.urgency).toBe('high');
  });

  describe('RoutingPushSender', () => {
    it('sends app tokens to the native sender and web tokens to web push', async () => {
      const native = new FakePushSender();
      const routing = new RoutingPushSender(native, sender);
      const web = token('/routed');
      await routing.send(message(['fcm-1', web]));
      expect(native.sent).toHaveLength(1);
      expect(native.sent[0]!.tokens).toEqual(['fcm-1']);
      expect(received.some((r) => r.path === '/routed')).toBe(true);
    });

    it('is enabled with web push alone and accepts only web tokens then', () => {
      const routing = new RoutingPushSender({ enabled: false } as never, sender);
      expect(routing.enabled).toBe(true);
      expect(routing.accepts(token('/x'))).toBe(true);
    });

    it('is disabled with neither', () => {
      const routing = new RoutingPushSender(
        { enabled: false, accepts: () => false } as never,
        null,
      );
      expect(routing.enabled).toBe(false);
      expect(routing.accepts(token('/x'))).toBe(false);
    });
  });
});
