import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listRoutes } from '../../src/openapi/routes.js';
import { login, type LoggedIn } from '../setup/auth.js';
import { buy } from '../setup/ledger.js';
import { acceptInvite, createShop, invite } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/**
 * M12 security review: IDOR. A signed-in stranger calls every route that names an object
 * (`{id}`, `{raiseId}`…) with the id of a real object they have nothing to do with. They must
 * get 404 (no role, ADR-006) or a 400 for a body the route never got to use, and never a 2xx or
 * a 403 (which would tell them the object exists).
 */
describe('IDOR on every route with an id (M12)', () => {
  let t: TestApp;
  const ids: Record<string, string> = {};
  let stranger: LoggedIn;

  beforeAll(async () => {
    t = await startTestApp();
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    const sale = await buy(t, shop.owner, invited.accountId, { amount: 1_000 });
    const dispute = await t.post(
      `/v1/entries/${sale.body.entry.id}/disputes`,
      { id: randomUUID(), reason: 'x' },
      { token: customer.accessToken },
    );
    const report = await t.post(
      `/v1/accounts/${invited.accountId}/payment-reports`,
      { id: randomUUID(), amount: 100, method: 'cash' },
      { token: customer.accessToken },
    );
    const order = await t.post(
      `/v1/accounts/${invited.accountId}/orders`,
      { id: randomUUID(), lines: [{ name: 'Bread' }] },
      { token: customer.accessToken },
    );
    const rep = await t.post(
      `/v1/accounts/${invited.accountId}/representatives`,
      { id: randomUUID(), name: 'Selam', relationship: 'household' },
      { token: customer.accessToken },
    );
    Object.assign(ids, {
      account: invited.accountId,
      merchant: shop.merchantId,
      entry: sale.body.entry.id,
      dispute: dispute.body.id,
      payment_report: report.body.id,
      order: order.body.id,
      representative: rep.body.id,
      user: shop.owner.userId,
      device: shop.owner.device.id,
    });
    stranger = await login(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  /** The kind of object a path's first `{id}` names, from the segment before it. */
  function idFor(path: string): string {
    const kind = path.match(/\/v1\/([\w-]+)\/\{id\}/)?.[1];
    return (
      {
        accounts: ids.account,
        merchants: ids.merchant,
        entries: ids.entry,
        disputes: ids.dispute,
        'payment-reports': ids.payment_report,
        orders: ids.order,
        representatives: ids.representative,
        devices: ids.device,
        'correction-requests': randomUUID(),
      }[kind ?? ''] ?? randomUUID()
    );
  }

  const routes = listRoutes().filter((r) => r.path.includes('{') && !r.public);

  it('covers every route that takes an id', () => {
    expect(routes.length).toBeGreaterThan(25);
  });

  it.each(routes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
    '%s refuses a stranger',
    async (_name, r) => {
      const path = r.path
        .replace('{id}', idFor(r.path))
        .replace('{raiseId}', randomUUID())
        .replace('{userId}', ids.user!)
        .replace('{side}', 'merchant');
      const query = r.path.includes('statement.pdf') ? '?from=2026-10-01&to=2026-10-31' : '';
      const call = { get: t.get, post: t.post, put: t.put, patch: t.patch, delete: t.delete }[
        r.method
      ];
      const res =
        r.method === 'get' || r.method === 'delete'
          ? await (call as typeof t.get)(`${path}${query}`, { token: stranger.accessToken })
          : await (call as typeof t.post)(path, {}, { token: stranger.accessToken });
      expect([400, 404]).toContain(res.status);
    },
  );

  it('every private route needs a token', async () => {
    for (const r of listRoutes().filter((x) => !x.public)) {
      const path = r.path.replace(/\{\w+\}/g, randomUUID());
      const res = await fetch(`${t.baseUrl}${path}`, { method: r.method.toUpperCase() });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it('refuses forged tokens: unsigned, other key, edited claims', async () => {
    const [head, claims, sig] = stranger.accessToken.split('.') as [string, string, string];
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString()) as { sub: string };
    const forged = [
      `${b64({ alg: 'none', typ: 'JWT' })}.${claims}.`,
      `${head}.${claims}.${Buffer.from('x'.repeat(32)).toString('base64url')}`,
      `${head}.${b64({ ...payload, sub: ids.user })}.${sig}`,
    ];
    for (const token of forged) {
      expect((await t.get('/v1/me', { token })).status).toBe(401);
    }
    expect((await t.get('/v1/me', { token: stranger.accessToken })).status).toBe(200);
  });

  it('does not advertise the framework', async () => {
    const res = await fetch(`${t.baseUrl}/v1/health`);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});
