import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoggedIn } from '../setup/auth.js';
import { postEntry, purchaseBody } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('delivery orders (M9, ADR-014, US-12)', () => {
  let t: TestApp;

  // Own Postgres: one test pulls changes (ADR-010).
  beforeAll(async () => {
    t = await startTestApp({ ownContainer: true });
  });

  afterAll(async () => {
    await t?.close();
  });

  async function setup() {
    const shop = await createShop(t);
    const staff = await addStaff(t, shop);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    return {
      shop,
      owner: shop.owner,
      staff,
      customer,
      accountId: invited.accountId,
      phone: invited.phone,
    };
  }

  const sendOrder = (customer: LoggedIn, accountId: string, id = randomUUID()) =>
    t.post(
      `/v1/accounts/${accountId}/orders`,
      {
        id,
        lines: [
          { name: 'Bread', qty: '2' },
          { name: 'Oil', qty: '1', unit: 'litre' },
        ],
        address_note: 'Block 12, floor 4, unit 3',
        preferred_time: 'Before 7 pm',
      },
      { token: customer.accessToken },
    );

  const priced = {
    lines: [
      { name: 'Bread', qty: '2', unit_price: 1_000, amount: 2_000 },
      { name: 'Oil', qty: '1', unit: 'litre', unit_price: 25_000, amount: 0, unavailable: true },
    ],
  };

  /** The delivered purchase: the available priced lines, taken by delivery, with the order id. */
  const delivered = (user: LoggedIn, accountId: string, orderId: string) =>
    purchaseBody(t, user, accountId, {
      amount: 2_000,
      lines: [{ name: 'Bread', qty: '2', unit_price: 1_000, amount: 2_000, source: 'order' }],
      takenBy: 'delivery',
      orderId,
    });

  it('US-12: send, accept, price, out, delivered as one Delivery entry', async () => {
    const { owner, staff, customer, accountId, phone } = await setup();
    const sent = await sendOrder(customer, accountId);
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe('sent');
    await t.outbox.runOnce();
    expect(smsTo(t, owner.phone)).toContain('Floor 4 Hanna');
    expect(smsTo(t, staff.phone)).toContain('Floor 4 Hanna');

    const id = sent.body.id as string;
    const step = (path: string, body: object = {}, user: LoggedIn = staff) =>
      t.post(`/v1/orders/${id}/${path}`, body, { token: user.accessToken });
    expect((await step('accept')).body.status).toBe('accepted');
    const p = await step('price', priced);
    expect(p.body).toMatchObject({ status: 'priced' });
    expect(p.body.lines[1]).toMatchObject({ unavailable: true, amount: 0 });
    expect((await step('out', { delivery_person: 'Dawit' })).body).toMatchObject({
      status: 'out_for_delivery',
      delivery_person: 'Dawit',
    });
    await t.outbox.runOnce();
    expect(smsTo(t, phone)).toContain('20.00');

    const entry = await postEntry(t, staff, accountId, delivered(staff, accountId, id));
    expect(entry.status).toBe(201);
    expect(entry.body.entry).toMatchObject({ order_id: id, taken_by_type: 'delivery' });
    const list = await t.get(`/v1/accounts/${accountId}/orders`, { token: owner.accessToken });
    expect(list.body.orders[0]).toMatchObject({
      status: 'delivered',
      delivered_entry_id: entry.body.entry.id,
    });

    // ORD-4: the customer says something was missing; it becomes a dispute.
    const receipt = await t.post(
      `/v1/orders/${id}/receipt`,
      { missing: 'Only one bread came' },
      { token: customer.accessToken },
    );
    expect(receipt.body.receipt_confirmed_at).not.toBeNull();
    const disputes = await t.get(`/v1/accounts/${accountId}/disputes`, {
      token: owner.accessToken,
    });
    expect(disputes.body.disputes[0]).toMatchObject({ reason: 'Only one bread came' });
  });

  it('the shop’s steps and the delivery work through sync (offline)', async () => {
    const { staff, customer, accountId } = await setup();
    const id = (await sendOrder(customer, accountId)).body.id as string;
    const deliveredBody = delivered(staff, accountId, id);
    const res = await t.post(
      '/v1/sync',
      {
        writes: [
          { op: 'order.accept', body: { id } },
          { op: 'order.price', body: { id, ...priced } },
          { op: 'order.out', body: { id } },
          { op: 'entry.create', body: { ...deliveredBody, account_id: accountId } },
        ],
      },
      { token: staff.accessToken },
    );
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
    ]);
    const orders = res.body.changes.orders as { id: string; status: string }[];
    expect(orders.find((o) => o.id === id)?.status).toBe('delivered');

    // A retried step is harmless.
    const again = await t.post(
      '/v1/sync',
      { writes: [{ op: 'order.accept', body: { id } }] },
      { token: staff.accessToken },
    );
    expect(again.body.results[0]).toMatchObject({ status: 'ok' });
    expect(again.body.results[0].result.status).toBe('delivered');
  });

  it('steps must come in order; a declined order cannot be delivered', async () => {
    const { owner, customer, accountId, phone } = await setup();
    const id = (await sendOrder(customer, accountId)).body.id as string;
    const early = await t.post(`/v1/orders/${id}/out`, {}, { token: owner.accessToken });
    expect(early.body.code).toBe('invalid_order_step');
    const declined = await t.post(
      `/v1/orders/${id}/decline`,
      { reason: 'No oil today' },
      { token: owner.accessToken },
    );
    expect(declined.body.status).toBe('declined');
    await t.outbox.runOnce();
    expect(smsTo(t, phone)).toContain('No oil today');
    const res = await postEntry(t, owner, accountId, delivered(owner, accountId, id));
    expect(res.body.code).toBe('invalid_order_step');
  });

  it('an order is delivered only once', async () => {
    const { owner, customer, accountId } = await setup();
    const id = (await sendOrder(customer, accountId)).body.id as string;
    await t.post(`/v1/orders/${id}/accept`, {}, { token: owner.accessToken });
    await t.post(`/v1/orders/${id}/price`, priced, { token: owner.accessToken });
    expect((await postEntry(t, owner, accountId, delivered(owner, accountId, id))).status).toBe(
      201,
    );
    const twice = await postEntry(t, owner, accountId, delivered(owner, accountId, id));
    expect(twice.body.code).toBe('order_already_delivered');
  });

  it('a priced line must add up; only customers send orders; customers cannot accept', async () => {
    const { owner, customer, accountId } = await setup();
    const id = (await sendOrder(customer, accountId)).body.id as string;
    await t.post(`/v1/orders/${id}/accept`, {}, { token: owner.accessToken });
    const wrong = await t.post(
      `/v1/orders/${id}/price`,
      { lines: [{ name: 'Bread', qty: '2', unit_price: 1_000, amount: 999 }] },
      { token: owner.accessToken },
    );
    expect(wrong.status).toBe(400);
    expect((await sendOrder(owner, accountId)).status).toBe(403);
    const byCustomer = await t.post(
      `/v1/orders/${id}/decline`,
      { reason: 'x' },
      {
        token: customer.accessToken,
      },
    );
    expect(byCustomer.status).toBe(403);
  });
});
