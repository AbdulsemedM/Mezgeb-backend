import { Logger } from '@nestjs/common';
import { SmsGateway, type SmsMessage } from './sms-gateway.js';

export interface CoopbankSmsConfig {
  /** OAuth2 token endpoint (client_credentials). */
  tokenUrl: string;
  /** `POST {phone_number, text}` endpoint. */
  sendUrl: string;
  clientId: string;
  clientSecret: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** Refresh the token this long before the provider says it expires. */
const TOKEN_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Cooperative Bank of Oromia's SMS API behind their API manager (WSO2 APIM).
 * Gets an OAuth2 client_credentials token, caches it until shortly before it expires, and
 * fetches a new one once if the send answers 401 (token revoked early).
 *
 * A failed send throws, so the outbox retries it and the OTP request answers 5xx.
 */
export class CoopbankSmsGateway extends SmsGateway {
  private readonly logger = new Logger('CoopbankSms');
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;
  /** One token request at a time; concurrent sends wait for the same one. */
  private pendingToken: Promise<string> | null = null;

  constructor(private readonly config: CoopbankSmsConfig) {
    super();
    this.fetch = config.fetch ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(message: SmsMessage): Promise<void> {
    const phone = toLocalPhone(message.to);
    let res = await this.post(phone, message.text, await this.accessToken());
    if (res.status === 401) {
      this.token = null;
      res = await this.post(phone, message.text, await this.accessToken());
    }
    // Accepted answers 202 `{"success": true, "message": "SMS request processed"}`.
    const body = await safeText(res);
    if (!res.ok || successFlag(body) === false) {
      throw new Error(`Coopbank SMS send failed: HTTP ${res.status} ${body}`);
    }
    this.logger.log(`SMS sent to ${maskPhone(message.to)}`);
  }

  private post(phone: string, text: string, token: string): Promise<Response> {
    return this.fetch(this.config.sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone_number: phone, text }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    this.pendingToken ??= this.fetchToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    );
    const res = await this.fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(
        `Coopbank SMS token request failed: HTTP ${res.status} ${await safeText(res)}`,
      );
    }
    const text = await safeText(res, 2000);
    let json: { access_token?: unknown; expires_in?: unknown } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      // A firewall or proxy page instead of the API (e.g. a caller outside the allowlist).
    }
    if (typeof json.access_token !== 'string' || json.access_token === '') {
      throw new Error(
        `Coopbank SMS token response has no access_token: HTTP ${res.status} ${text.slice(0, 500)}`,
      );
    }
    const ttlMs = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000;
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + Math.max(0, ttlMs - TOKEN_MARGIN_MS),
    };
    return json.access_token;
  }
}

/** `+251912345678` → `0912345678`, the form the Coopbank API takes. */
export function toLocalPhone(e164: string): string {
  const m = /^\+251(\d{9})$/.exec(e164);
  if (!m) throw new Error(`Not an E.164 Ethiopian number: ${maskPhone(e164)}`);
  return `0${m[1]}`;
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, -4).replace(/\d/g, '*')}${phone.slice(-4)}` : '****';
}

/** The `success` field of a JSON answer, or undefined when there is none. */
function successFlag(body: string): boolean | undefined {
  try {
    const json = JSON.parse(body) as { success?: unknown };
    return typeof json.success === 'boolean' ? json.success : undefined;
  } catch {
    return undefined;
  }
}

async function safeText(res: Response, max = 300): Promise<string> {
  try {
    return (await res.text()).slice(0, max);
  } catch {
    return '';
  }
}
