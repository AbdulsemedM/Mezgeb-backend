import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buy, correctionBody, postEntry } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('correction requests (ADR-012)', () => {
  let t: TestApp;

  // Own Postgres: the last test pulls changes, which waits for other files' transactions.
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
    const sale = await buy(t, staff, invited.accountId, { amount: 5_000 });
    return {
      shop,
      owner: shop.owner,
      staff,
      customer,
      accountId: invited.accountId,
      entryId: sale.body.entry.id as string,
    };
  }

  const ask = (token: string, entryId: string, body: object) =>
    t.post(`/v1/entries/${entryId}/correction-requests`, body, { token });

  it('staff ask; the owner is told; the owner corrects; the request shows the correction', async () => {
    const { owner, staff, accountId, entryId } = await setup();
    const id = randomUUID();
    const asked = await ask(staff.accessToken, entryId, {
      id,
      amount: -1_000,
      reason: 'Charged 50, it was 40',
    });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: 'open', amount: -1_000 });
    await t.outbox.runOnce();
    expect(smsTo(t, owner.phone)).toContain('Charged 50, it was 40');

    const fix = correctionBody(t, owner, accountId, entryId, -1_000, 'Charged 50, it was 40');
    expect((await postEntry(t, owner, accountId, fix)).status).toBe(201);
    const done = await t.post(
      `/v1/correction-requests/${id}/resolve`,
      { correction_entry_id: fix.id },
      { token: owner.accessToken },
    );
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'corrected', resolution_entry_id: fix.id });

    // A retry of the same answer is fine; a different one is not.
    const again = await t.post(
      `/v1/correction-requests/${id}/resolve`,
      { correction_entry_id: fix.id },
      { token: owner.accessToken },
    );
    expect(again.status).toBe(200);
    const other = await t.post(
      `/v1/correction-requests/${id}/resolve`,
      { note: 'No' },
      { token: owner.accessToken },
    );
    expect(other.body.code).toBe('correction_request_resolved');
  });

  it('the owner can decline with a note', async () => {
    const { owner, staff, entryId } = await setup();
    const id = randomUUID();
    await ask(staff.accessToken, entryId, { id, amount: 500, reason: 'Forgot the eggs' });
    const res = await t.post(
      `/v1/correction-requests/${id}/resolve`,
      { note: 'Eggs were paid in cash' },
      { token: owner.accessToken },
    );
    expect(res.body).toMatchObject({
      status: 'declined',
      resolution_note: 'Eggs were paid in cash',
    });
  });

  it('only staff ask; only the owner answers; customers never see requests', async () => {
    const { owner, staff, customer, accountId, entryId } = await setup();
    expect(
      (await ask(owner.accessToken, entryId, { id: randomUUID(), amount: 1, reason: 'x' })).status,
    ).toBe(403);
    expect(
      (await ask(customer.accessToken, entryId, { id: randomUUID(), amount: 1, reason: 'x' }))
        .status,
    ).toBe(403);
    const id = randomUUID();
    await ask(staff.accessToken, entryId, { id, amount: 1, reason: 'x' });
    const byStaff = await t.post(
      `/v1/correction-requests/${id}/resolve`,
      { note: 'No' },
      { token: staff.accessToken },
    );
    expect(byStaff.status).toBe(403);
    const list = await t.get(`/v1/accounts/${accountId}/correction-requests`, {
      token: customer.accessToken,
    });
    expect(list.status).toBe(403);
    const shopList = await t.get(`/v1/accounts/${accountId}/correction-requests`, {
      token: owner.accessToken,
    });
    expect(shopList.body.correction_requests).toHaveLength(1);
  });

  it('a zero amount is not a correction', async () => {
    const { staff, entryId } = await setup();
    const res = await ask(staff.accessToken, entryId, { id: randomUUID(), amount: 0, reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('through sync: staff ask offline, the owner corrects and resolves offline; customers see nothing', async () => {
    const { owner, staff, customer, accountId, entryId } = await setup();
    const id = randomUUID();
    const sync = (token: string, writes: object[], cursor = '0') =>
      t.post('/v1/sync', { cursor, writes }, { token });

    const asked = await sync(staff.accessToken, [
      {
        op: 'correction_request.create',
        body: { entry_id: entryId, id, amount: -500, reason: 'Wrong price' },
      },
    ]);
    expect(asked.body.results[0]).toMatchObject({ status: 'ok' });

    const fix = correctionBody(t, owner, accountId, entryId, -500, 'Wrong price');
    const resolved = await sync(owner.accessToken, [
      { op: 'entry.create', body: { ...fix, account_id: accountId } },
      { op: 'correction_request.resolve', body: { id, correction_entry_id: fix.id } },
    ]);
    expect(resolved.body.results.map((r: { status: string }) => r.status)).toEqual(['ok', 'ok']);
    const ownerRequests = resolved.body.changes.correction_requests as {
      id: string;
      status: string;
    }[];
    expect(ownerRequests.find((r) => r.id === id)?.status).toBe('corrected');

    const customerPull = await sync(customer.accessToken, []);
    expect(customerPull.body.changes.correction_requests).toEqual([]);
  });

  it('disputes can be resolved through sync too, and a retry is fine', async () => {
    const { owner, customer, accountId, entryId } = await setup();
    const disputeId = randomUUID();
    await t.post(
      `/v1/entries/${entryId}/disputes`,
      { id: disputeId, reason: 'Not me' },
      { token: customer.accessToken },
    );
    const write = { op: 'dispute.resolve', body: { id: disputeId, note: 'Your daughter took it' } };
    const first = await t.post('/v1/sync', { writes: [write] }, { token: owner.accessToken });
    expect(first.body.results[0]).toMatchObject({ status: 'ok' });
    const retry = await t.post('/v1/sync', { writes: [write] }, { token: owner.accessToken });
    expect(retry.body.results[0]).toMatchObject({ status: 'ok' });
    expect(accountId).toBeTruthy();
  });
});
