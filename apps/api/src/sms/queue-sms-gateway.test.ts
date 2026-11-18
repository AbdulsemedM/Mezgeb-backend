import { describe, expect, it } from 'vitest';
import { type QueuedSms, QueueSmsGateway } from './queue-sms-gateway.js';

function gateway(respond: () => Response) {
  const calls: { url: string; auth: string; body: unknown }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      auth: (init.headers as Record<string, string>).Authorization!,
      body: JSON.parse(String(init.body)),
    });
    return respond();
  }) as unknown as typeof fetch;
  const g = new QueueSmsGateway({
    url: 'https://q.upstash.test',
    token: 'tok',
    key: 'mezgeb:sms',
    fetch: fetchFn,
  });
  return { g, calls };
}

describe('QueueSmsGateway (ADR-018)', () => {
  it('LPUSHes the message as JSON onto the queue', async () => {
    const { g, calls } = gateway(() => Response.json({ result: 1 }));
    await g.send({ to: '+251946514836', text: 'ኮድ 123456' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://q.upstash.test');
    expect(calls[0]!.auth).toBe('Bearer tok');
    const [cmd, key, raw] = calls[0]!.body as [string, string, string];
    expect([cmd, key]).toEqual(['LPUSH', 'mezgeb:sms']);
    const item = JSON.parse(raw) as QueuedSms;
    expect(item).toMatchObject({ to: '+251946514836', text: 'ኮድ 123456' });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof item.created_at).toBe('number');
  });

  it('throws when Upstash answers an error', async () => {
    const { g } = gateway(() => Response.json({ error: 'WRONGPASS' }, { status: 401 }));
    await expect(g.send({ to: '+251946514836', text: 'x' })).rejects.toThrow(/HTTP 401/);
  });

  it('throws on a 200 without a result', async () => {
    const { g } = gateway(() => Response.json({ error: 'ERR wrong type' }));
    await expect(g.send({ to: '+251946514836', text: 'x' })).rejects.toThrow(/wrong type/);
  });
});
