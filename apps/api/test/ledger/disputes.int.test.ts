import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buy, correctionBody, postEntry } from '../setup/ledger.js';
import { acceptInvite, createShop, invite } from '../setup/shop.js';
import { smsTo, startTestApp, type TestApp } from '../setup/test-app.js';

describe('US-13: disputes (LED-6)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function disputed() {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    const sale = await buy(t, shop.owner, invited.accountId, { amount: 12_500 });
    const disputeId = randomUUID();
    const res = await t.post(
      `/v1/entries/${sale.body.entry.id}/disputes`,
      { id: disputeId, reason: 'I only took one bread' },
      { token: customer.accessToken },
    );
    return {
      shop,
      owner: shop.owner,
      customer,
      accountId: invited.accountId,
      sale,
      disputeId,
      res,
    };
  }

  it('the customer disputes with a reason; the merchant sees it and is told', async () => {
    const { owner, accountId, disputeId, res, sale } = await disputed();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: disputeId,
      entry_id: sale.body.entry.id,
      reason: 'I only took one bread',
      status: 'open',
    });
    const list = await t.get(`/v1/accounts/${accountId}/disputes`, { token: owner.accessToken });
    expect(list.body.disputes).toEqual([res.body]);
    await t.outbox.runOnce();
    expect(smsTo(t, owner.phone)).toContain('I only took one bread');
  });

  it('is idempotent on id', async () => {
    const { customer, sale, disputeId, res } = await disputed();
    const again = await t.post(
      `/v1/entries/${sale.body.entry.id}/disputes`,
      { id: disputeId, reason: 'I only took one bread' },
      { token: customer.accessToken },
    );
    expect(again.status).toBe(200);
    expect(again.body).toEqual(res.body);
  });

  it('only the customer disputes', async () => {
    const { owner, sale } = await disputed();
    const res = await t.post(
      `/v1/entries/${sale.body.entry.id}/disputes`,
      { id: randomUUID(), reason: 'x' },
      { token: owner.accessToken },
    );
    expect(res.status).toBe(403);
  });

  it('resolved by a correction both see; the original stays', async () => {
    const { owner, customer, accountId, sale, disputeId } = await disputed();
    const correction = await postEntry(
      t,
      owner,
      accountId,
      correctionBody(t, owner, accountId, sale.body.entry.id, -2_500, 'One bread, not two'),
    );
    const res = await t.post(
      `/v1/disputes/${disputeId}/resolve`,
      { correction_entry_id: correction.body.entry.id },
      { token: owner.accessToken },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'resolved',
      resolution_entry_id: correction.body.entry.id,
      resolved_by: owner.userId,
    });
    const entries = await t.get(`/v1/accounts/${accountId}/entries`, {
      token: customer.accessToken,
    });
    expect(entries.body.entries.map((e: { id: string }) => e.id)).toEqual([
      sale.body.entry.id,
      correction.body.entry.id,
    ]);
  });

  it('resolved by a note', async () => {
    const { owner, disputeId } = await disputed();
    const res = await t.post(
      `/v1/disputes/${disputeId}/resolve`,
      { note: 'Checked the camera: two breads.' },
      { token: owner.accessToken },
    );
    expect(res.body).toMatchObject({
      status: 'resolved',
      resolution_note: 'Checked the camera: two breads.',
    });
  });

  it('the correction must reference the disputed entry', async () => {
    const { owner, accountId, disputeId } = await disputed();
    const other = await buy(t, owner, accountId);
    const correction = await postEntry(
      t,
      owner,
      accountId,
      correctionBody(t, owner, accountId, other.body.entry.id, -100),
    );
    const res = await t.post(
      `/v1/disputes/${disputeId}/resolve`,
      { correction_entry_id: correction.body.entry.id },
      { token: owner.accessToken },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_resolution');
  });

  it('only the owner resolves', async () => {
    const { customer, disputeId } = await disputed();
    const res = await t.post(
      `/v1/disputes/${disputeId}/resolve`,
      { note: 'fine' },
      { token: customer.accessToken },
    );
    expect(res.status).toBe(403);
  });
});
