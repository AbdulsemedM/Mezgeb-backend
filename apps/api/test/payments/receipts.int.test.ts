import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_RECEIPT_BYTES } from '../../src/payments/payments.service.js';
import { buy } from '../setup/ledger.js';
import { acceptInvite, addStaff, createShop, invite } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

/** ADR-016: receipt photos on payment reports, and pay-me `seen`, for the PWA. */
describe('receipt photos and pay-me seen (ADR-016)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function reported() {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    await buy(t, shop.owner, invited.accountId, { amount: 10_000 });
    const report = await t.post(
      `/v1/accounts/${invited.accountId}/payment-reports`,
      { id: randomUUID(), amount: 5_000, method: 'telebirr', reference: 'TB9X01' },
      { token: customer.accessToken },
    );
    expect(report.body.has_receipt).toBe(false);
    return { shop, customer, accountId: invited.accountId, reportId: report.body.id as string };
  }

  /** A tiny JPEG-looking body; the server stores bytes as given. */
  const jpeg = (size = 2_000) => {
    const b = new Uint8Array(size);
    b.set([0xff, 0xd8, 0xff]);
    return b;
  };

  const put = (token: string, reportId: string, body: Uint8Array | string, type = 'image/jpeg') =>
    fetch(`${t.baseUrl}/v1/payment-reports/${reportId}/receipt`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': type },
      body,
    });

  const get = (token: string, reportId: string) =>
    fetch(`${t.baseUrl}/v1/payment-reports/${reportId}/receipt`, {
      headers: { authorization: `Bearer ${token}` },
    });

  it('the customer attaches a photo; owner and customer can see it, staff cannot', async () => {
    const { shop, customer, accountId, reportId } = await reported();
    const staff = await addStaff(t, shop);
    const res = await put(customer.accessToken, reportId, jpeg());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).has_receipt).toBe(true);

    for (const user of [shop.owner, customer]) {
      const photo = await get(user.accessToken, reportId);
      expect(photo.status).toBe(200);
      expect(photo.headers.get('content-type')).toBe('image/jpeg');
      expect(new Uint8Array(await photo.arrayBuffer())).toEqual(jpeg());
    }
    expect((await get(staff.accessToken, reportId)).status).toBe(403);

    const list = await t.get(`/v1/accounts/${accountId}/payment-reports`, {
      token: shop.owner.accessToken,
    });
    expect(list.body.payment_reports[0].has_receipt).toBe(true);
  });

  it('sending again replaces the photo (safe to retry)', async () => {
    const { customer, reportId } = await reported();
    expect((await put(customer.accessToken, reportId, jpeg(1_000))).status).toBe(200);
    expect((await put(customer.accessToken, reportId, jpeg(3_000))).status).toBe(200);
    const photo = await get(customer.accessToken, reportId);
    expect((await photo.arrayBuffer()).byteLength).toBe(3_000);
  });

  it('refuses other types, empty and too large photos', async () => {
    const { customer, reportId } = await reported();
    const gif = await put(customer.accessToken, reportId, jpeg(), 'image/gif');
    expect(gif.status).toBe(415);
    expect(((await gif.json()) as any).code).toBe('unsupported_receipt_type');
    const big = await put(customer.accessToken, reportId, jpeg(MAX_RECEIPT_BYTES + 1));
    expect(big.status).toBe(413);
    expect(((await big.json()) as any).code).toBe('receipt_too_large');
  });

  it('only the customer attaches, and only before the shop reviews', async () => {
    const { shop, customer, reportId } = await reported();
    expect((await put(shop.owner.accessToken, reportId, jpeg())).status).toBe(403);
    await t.post(`/v1/payment-reports/${reportId}/confirm`, {}, { token: shop.owner.accessToken });
    const late = await put(customer.accessToken, reportId, jpeg());
    expect(late.status).toBe(409);
    expect(((await late.json()) as any).code).toBe('payment_report_reviewed');
  });

  it('no photo yet is 404', async () => {
    const { customer, reportId } = await reported();
    expect((await get(customer.accessToken, reportId)).status).toBe(404);
  });

  it('pay-me: the customer opening it marks it seen, once', async () => {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    const customer = await acceptInvite(t, invited);
    await buy(t, shop.owner, invited.accountId, { amount: 10_000 });
    const payme = await t.post(
      `/v1/accounts/${invited.accountId}/payme-requests`,
      { id: randomUUID(), amount: 10_000 },
      { token: shop.owner.accessToken },
    );
    expect(payme.body.status).toBe('sent');

    expect(
      (
        await t.post(
          `/v1/payme-requests/${payme.body.id}/seen`,
          {},
          { token: shop.owner.accessToken },
        )
      ).status,
    ).toBe(403);
    const seen = await t.post(
      `/v1/payme-requests/${payme.body.id}/seen`,
      {},
      { token: customer.accessToken },
    );
    expect(seen.status).toBe(200);
    expect(seen.body.status).toBe('seen');
    const again = await t.post(
      `/v1/payme-requests/${payme.body.id}/seen`,
      {},
      { token: customer.accessToken },
    );
    expect(again.body.status).toBe('seen');
  });
});
