import { describe, expect, it } from 'vitest';
import { CoopbankSmsGateway, toLocalPhone } from './coopbank-sms-gateway.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch stand-in: records each call and answers from `respond`. */
function fakeFetch(respond: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call = {
      url,
      headers: init.headers as Record<string, string>,
      body: String(init.body),
    };
    calls.push(call);
    return respond(call, calls.length);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const TOKEN_URL = 'https://idp.test/oauth2/token';
const SEND_URL = 'https://gw.test/api/sms/1.0.0/send';

function gateway(f: typeof fetch) {
  return new CoopbankSmsGateway({
    tokenUrl: TOKEN_URL,
    sendUrl: SEND_URL,
    clientId: 'client',
    clientSecret: 'secret',
    fetch: f,
  });
}

const tokenOk = (value = 'tok-1', expiresIn = 3600) =>
  Response.json({ access_token: value, token_type: 'Bearer', expires_in: expiresIn });

describe('CoopbankSmsGateway (ADR-018)', () => {
  it('gets a client_credentials token, then posts the local number and text', async () => {
    const { fn, calls } = fakeFetch((c) =>
      c.url === TOKEN_URL ? tokenOk() : Response.json({ ok: true }),
    );
    await gateway(fn).send({ to: '+251946514836', text: 'ኮድ 123456' });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers.Authorization).toBe(
      `Basic ${Buffer.from('client:secret').toString('base64')}`,
    );
    expect(calls[0]!.body).toBe('grant_type=client_credentials');
    expect(calls[1]!.url).toBe(SEND_URL);
    expect(calls[1]!.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(calls[1]!.body)).toEqual({
      phone_number: '0946514836',
      text: 'ኮድ 123456',
    });
  });

  it('reuses the cached token across sends', async () => {
    const { fn, calls } = fakeFetch((c) => (c.url === TOKEN_URL ? tokenOk() : new Response('')));
    const g = gateway(fn);
    await g.send({ to: '+251946514836', text: 'a' });
    await g.send({ to: '+251946514836', text: 'b' });
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it('fetches one token for concurrent sends', async () => {
    const { fn, calls } = fakeFetch((c) => (c.url === TOKEN_URL ? tokenOk() : new Response('')));
    const g = gateway(fn);
    await Promise.all([1, 2, 3].map((i) => g.send({ to: '+251946514836', text: `${i}` })));
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it('refreshes the token once when the send answers 401', async () => {
    let tokens = 0;
    const { fn, calls } = fakeFetch((c) => {
      if (c.url === TOKEN_URL) return tokenOk(`tok-${++tokens}`);
      return c.headers.Authorization === 'Bearer tok-1'
        ? new Response('expired', { status: 401 })
        : new Response('');
    });
    await gateway(fn).send({ to: '+251946514836', text: 'x' });
    expect(calls.map((c) => c.headers.Authorization)).toEqual([
      expect.stringMatching(/^Basic /),
      'Bearer tok-1',
      expect.stringMatching(/^Basic /),
      'Bearer tok-2',
    ]);
  });

  it('throws when the send fails, so the outbox retries', async () => {
    const { fn } = fakeFetch((c) =>
      c.url === TOKEN_URL ? tokenOk() : new Response('boom', { status: 502 }),
    );
    await expect(gateway(fn).send({ to: '+251946514836', text: 'x' })).rejects.toThrow(
      /HTTP 502 boom/,
    );
  });

  it('throws when a 2xx answer says success: false', async () => {
    const { fn } = fakeFetch((c) =>
      c.url === TOKEN_URL
        ? tokenOk()
        : Response.json({ success: false, message: 'invalid number' }, { status: 202 }),
    );
    await expect(gateway(fn).send({ to: '+251946514836', text: 'x' })).rejects.toThrow(
      /invalid number/,
    );
  });

  it('throws when the token request fails', async () => {
    const { fn } = fakeFetch(() => new Response('bad client', { status: 401 }));
    await expect(gateway(fn).send({ to: '+251946514836', text: 'x' })).rejects.toThrow(
      /token request failed: HTTP 401/,
    );
  });

  it('reports an HTML page answered instead of a token', async () => {
    const { fn } = fakeFetch(() => new Response('<html>Request Rejected</html>'));
    await expect(gateway(fn).send({ to: '+251946514836', text: 'x' })).rejects.toThrow(
      /no access_token: HTTP 200 <html>Request Rejected/,
    );
  });

  it('converts E.164 to the local form and refuses anything else', () => {
    expect(toLocalPhone('+251712345678')).toBe('0712345678');
    expect(() => toLocalPhone('0946514836')).toThrow();
    expect(() => toLocalPhone('+254712345678')).toThrow();
  });
});
