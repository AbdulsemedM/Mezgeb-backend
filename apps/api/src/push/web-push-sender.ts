import { WEB_PUSH_TOKEN_PREFIX, webPushSubscriptionSchema } from '@mezgeb/shared';
import webpush from 'web-push';
import { type PushMessage, PushSender } from './push-sender.js';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Pushes wait this long for an offline browser before the push service drops them. */
const WEB_PUSH_TTL_S = 24 * 60 * 60;

export function isWebPushToken(token: string): boolean {
  return token.startsWith(WEB_PUSH_TOKEN_PREFIX);
}

/**
 * ADR-016: Web Push (VAPID, RFC 8291/8292) to the PWA. The device's push token is
 * `webpush:` + the browser's PushSubscription JSON. The payload is what the service worker shows.
 */
export class WebPushSender extends PushSender {
  readonly enabled = true;

  constructor(private readonly vapid: VapidKeys) {
    super();
  }

  override accepts(token: string): boolean {
    return isWebPushToken(token);
  }

  async send(message: PushMessage): Promise<{ invalidTokens: string[] }> {
    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      data: message.data,
    });
    const results = await Promise.allSettled(
      message.tokens.map((token) => this.sendOne(token, payload, message.sound)),
    );
    const invalidTokens = message.tokens.filter((_, i) => {
      const r = results[i]!;
      return r.status === 'fulfilled' && r.value === 'gone';
    });
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    // Nothing delivered and something broke: let the dispatcher retry or fall back to SMS.
    if (failed && results.every((r) => r.status === 'rejected' || r.value === 'gone')) {
      throw failed.reason;
    }
    return { invalidTokens };
  }

  private async sendOne(token: string, payload: string, urgent: boolean): Promise<'sent' | 'gone'> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(token.slice(WEB_PUSH_TOKEN_PREFIX.length));
    } catch {
      return 'gone';
    }
    const sub = webPushSubscriptionSchema.safeParse(parsed);
    if (!sub.success) return 'gone';
    // web-push encrypts and signs; fetch sends (the library's own sender is https-only).
    const req = webpush.generateRequestDetails(sub.data, payload, {
      vapidDetails: this.vapid,
      TTL: WEB_PUSH_TTL_S,
      urgency: urgent ? 'high' : 'normal',
    });
    const res = await fetch(req.endpoint, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.body ? new Uint8Array(req.body) : null,
      signal: AbortSignal.timeout(10_000),
    });
    // 404/410: the subscription is gone (the PWA was removed or permission withdrawn).
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) throw new Error(`web push failed: HTTP ${res.status}`);
    return 'sent';
  }
}

/** Sends app tokens to the native sender and Web Push subscriptions to the web sender. */
export class RoutingPushSender extends PushSender {
  readonly enabled: boolean;

  constructor(
    private readonly native: PushSender,
    private readonly web: WebPushSender | null,
  ) {
    super();
    this.enabled = native.enabled || web !== null;
  }

  override accepts(token: string): boolean {
    return isWebPushToken(token) ? this.web !== null : this.native.accepts(token);
  }

  async send(message: PushMessage): Promise<{ invalidTokens: string[] }> {
    const webTokens = message.tokens.filter((t) => isWebPushToken(t) && this.web);
    const nativeTokens = message.tokens.filter((t) => !isWebPushToken(t) && this.native.accepts(t));
    const jobs: Promise<{ invalidTokens: string[] }>[] = [];
    if (webTokens.length > 0) jobs.push(this.web!.send({ ...message, tokens: webTokens }));
    if (nativeTokens.length > 0) jobs.push(this.native.send({ ...message, tokens: nativeTokens }));
    const results = await Promise.allSettled(jobs);
    const ok = results.filter(
      (r): r is PromiseFulfilledResult<{ invalidTokens: string[] }> => r.status === 'fulfilled',
    );
    if (ok.length === 0) {
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
      return { invalidTokens: [] };
    }
    return { invalidTokens: ok.flatMap((r) => r.value.invalidTokens) };
  }
}
