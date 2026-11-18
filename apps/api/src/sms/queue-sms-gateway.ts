import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { SmsGateway, type SmsMessage } from './sms-gateway.js';

export interface QueueSmsConfig {
  /** Upstash Redis REST URL, e.g. `https://xyz.upstash.io`. */
  url: string;
  token: string;
  /** Redis list the relay reads (ADR-018). */
  key: string;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** What the relay receives; `created_at` lets it drop messages that waited too long. */
export interface QueuedSms {
  id: string;
  to: string;
  text: string;
  created_at: number;
}

/**
 * ADR-018: the Coopbank SMS API only answers callers inside the bank's allowlist, which Vercel is
 * not. The API puts each SMS on an Upstash Redis list; the relay on a bank server
 * (`apps/sms-relay`) takes them off and sends them. Success means "queued", not "delivered".
 */
export class QueueSmsGateway extends SmsGateway {
  private readonly logger = new Logger('QueueSms');
  private readonly fetch: typeof fetch;

  constructor(private readonly config: QueueSmsConfig) {
    super();
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async send(message: SmsMessage): Promise<void> {
    const item: QueuedSms = {
      id: randomUUID(),
      to: message.to,
      text: message.text,
      created_at: Date.now(),
    };
    const res = await this.fetch(this.config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['LPUSH', this.config.key, JSON.stringify(item)]),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
    });
    const text = await res.text().catch(() => '');
    let json: { result?: unknown; error?: unknown } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      // Not JSON: reported below.
    }
    if (!res.ok || typeof json.result !== 'number') {
      throw new Error(`SMS queue push failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    this.logger.log(`SMS ${item.id} queued (${json.result} waiting)`);
  }
}
