import { createPrivateKey, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CURRENT_TERMS_VERSION } from '@mezgeb/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogueItem, entry } from '../../src/db/schema.js';
import { login, refreshBody, type TestDevice } from '../setup/auth.js';
import { buy, postEntry, purchaseBody } from '../setup/ledger.js';
import { acceptInvite, createShop, invite } from '../setup/shop.js';
import { startTestApp, type TestApp } from '../setup/test-app.js';

interface SigningVectors {
  test_key: { public_spki_b64: string; private_pkcs8_b64: string };
  cases: {
    name: string;
    payload: Record<string, unknown> & { device_id: string | null; account_id: string };
    device_sig: string | null;
    payload_hash: string;
    link: { received_at: string };
    hash: string;
  }[];
}

describe('chain (ADR-001)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  async function activeAccount() {
    const shop = await createShop(t);
    const invited = await invite(t, shop);
    await acceptInvite(t, invited);
    return { owner: shop.owner, accountId: invited.accountId };
  }

  it('50 parallel writes to one account: contiguous seq and a valid chain', async () => {
    const { owner, accountId } = await activeAccount();
    const bodies = Array.from({ length: 50 }, () =>
      purchaseBody(t, owner, accountId, { amount: 100 }),
    );
    const results = await Promise.all(bodies.map((b) => postEntry(t, owner, accountId, b)));
    expect(results.map((r) => r.status)).toEqual(Array(50).fill(201));
    expect(results.map((r) => r.body.entry.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );

    const verify = await t.get(`/v1/accounts/${accountId}/chain/verify`, {
      token: owner.accessToken,
    });
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({ ok: true, head: { seq: 50 }, checked: 50 });
    const account = await t.get(`/v1/accounts/${accountId}`, { token: owner.accessToken });
    expect(account.body.balance_santim).toBe(5_000);
  });

  it('a tampered row is reported at its seq', async () => {
    const { owner, accountId } = await activeAccount();
    for (let i = 0; i < 3; i++) await buy(t, owner, accountId, { amount: 1_000 + i });
    const db = t.db!.db;
    // Simulate tampering below the API: switch off the append-only trigger for this session.
    await db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE entry DISABLE TRIGGER USER`);
      await tx
        .update(entry)
        .set({ amount: 9_999 })
        .where(sql`account_id = ${accountId} AND seq = 2`);
      await tx.execute(sql`ALTER TABLE entry ENABLE TRIGGER USER`);
    });
    const verify = await t.get(`/v1/accounts/${accountId}/chain/verify`, {
      token: owner.accessToken,
    });
    expect(verify.body).toMatchObject({ ok: false, first_bad_seq: 2, reason: 'payload_hash' });
  });
});

describe('signing vectors through the API (packages/shared/test-vectors/signing.json)', () => {
  let t: TestApp;

  // Own app: the vectors fix received_at, so the clock must start before them.
  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('device entries posted through the API get exactly the vector hashes', async () => {
    const v = JSON.parse(
      readFileSync(
        new URL('../../../../packages/shared/test-vectors/signing.json', import.meta.url),
        'utf8',
      ),
    ) as SigningVectors;
    const deviceCases = v.cases.filter((c) => c.device_sig !== null);
    const first = deviceCases[0]!;
    const device: TestDevice = {
      id: first.payload.device_id!,
      publicKey: v.test_key.public_spki_b64,
      privateKey: createPrivateKey({
        key: Buffer.from(v.test_key.private_pkcs8_b64, 'base64'),
        format: 'der',
        type: 'pkcs8',
      }),
    };

    const owner = await login(t, { device });
    const merchantId = randomUUID();
    await t.post(
      '/v1/merchants',
      { id: merchantId, shop_name: 'Vector Shop', terms_version: CURRENT_TERMS_VERSION },
      { token: owner.accessToken },
    );
    const accountId = first.payload.account_id;
    const inviteRes = await t.post(
      '/v1/accounts',
      { id: accountId, merchant_id: merchantId, phone: '0912000001' },
      { token: owner.accessToken },
    );
    expect(inviteRes.status).toBe(201);
    // Items the vectors reference must exist in this shop's catalogue.
    for (const c of deviceCases) {
      for (const line of c.payload.lines as { item_id: string | null; name: string }[]) {
        if (line.item_id) {
          await t
            .db!.db.insert(catalogueItem)
            .values({ id: line.item_id, merchantId, name: line.name, createdBy: owner.userId })
            .onConflictDoNothing();
        }
      }
    }

    let token: string;
    let refreshToken = owner.refreshToken;
    for (const c of deviceCases) {
      t.clock.set(new Date(c.link.received_at));
      // The access token lives 15 minutes; renew it at the vector's time.
      const renewed = await t.post('/v1/auth/refresh', refreshBody(device, refreshToken));
      expect(renewed.status).toBe(200);
      token = renewed.body.access_token;
      refreshToken = renewed.body.refresh_token;
      t.clock.set(new Date(c.link.received_at));

      const { account_id: _accountId, ...body } = c.payload;
      const res = await t.post(
        `/v1/accounts/${accountId}/entries`,
        { ...body, device_sig: c.device_sig },
        { token },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.entry.hash).toBe(c.hash);
      const [row] = await t
        .db!.db.select()
        .from(entry)
        .where(eq(entry.id, c.payload.id as string));
      expect(row!.hash).toBe(c.hash);
    }
  });
});
