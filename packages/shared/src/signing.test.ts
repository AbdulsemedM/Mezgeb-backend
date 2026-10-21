import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash.js';
import { canonicalize } from './jcs.js';
import {
  buildSigningPayload,
  type ChainLink,
  entryHash,
  GENESIS_HASH,
  isCanonicalTimestamp,
  payloadHash,
  type SigningInput,
  type SigningPayload,
  signingBytes,
} from './signing.js';
import { loadVectors } from './test-vectors.js';

interface SigningVectors {
  test_key: { public_spki_b64: string };
  genesis_hash: string;
  cases: {
    name: string;
    payload: SigningPayload;
    canonical: string;
    device_sig: string | null;
    payload_hash: string;
    link: ChainLink;
    link_canonical: string;
    hash: string;
  }[];
}

const v = loadVectors<SigningVectors>('signing');
const publicKey = createPublicKey({
  key: Buffer.from(v.test_key.public_spki_b64, 'base64'),
  format: 'der',
  type: 'spki',
});

describe('signing payload and chain (test-vectors/signing.json, ADR-001)', () => {
  it('genesis hash is 64 zeros', () => {
    expect(GENESIS_HASH).toBe(v.genesis_hash);
  });

  describe.each(v.cases)('$name', (c) => {
    it('canonical bytes match', () => {
      expect(new TextDecoder().decode(signingBytes(buildSigningPayload(c.payload)))).toBe(
        c.canonical,
      );
    });

    it('device signature verifies over the canonical bytes', () => {
      if (c.device_sig === null) return;
      const ok = verify(
        'sha256',
        signingBytes(buildSigningPayload(c.payload)),
        { key: publicKey, dsaEncoding: 'der' },
        Buffer.from(c.device_sig, 'base64'),
      );
      expect(ok).toBe(true);
    });

    it('payload_hash and chain hash match', async () => {
      expect(await payloadHash(buildSigningPayload(c.payload))).toBe(c.payload_hash);
      expect(canonicalize(c.link)).toBe(c.link_canonical);
      expect(await entryHash(c.link)).toBe(c.hash);
    });
  });

  it('cases form one chain', () => {
    let prev = GENESIS_HASH;
    for (const c of v.cases) {
      expect(c.link.prev_hash).toBe(prev);
      prev = c.hash;
    }
  });

  it('fills every absent optional field with null, never omits it', () => {
    const p = buildSigningPayload({
      id: 'e',
      account_id: 'a',
      type: 'purchase',
      amount: 500,
      recorded_at: '2026-10-21T08:00:00.000Z',
      taken_by_type: 'customer',
      lines: [{ name: 'Bread', amount: 500 }],
    });
    expect(Object.keys(p).sort()).toEqual(
      [
        'id',
        'account_id',
        'type',
        'amount',
        'lines',
        'taken_by_type',
        'representative_id',
        'order_id',
        'ref_entry_id',
        'reason',
        'device_id',
        'device_seq',
        'recorded_at',
      ].sort(),
    );
    expect(p.lines[0]).toEqual({
      name: 'Bread',
      qty: null,
      unit: null,
      unit_price: null,
      amount: 500,
      item_id: null,
      source: 'manual',
    });
    expect(p.reason).toBeNull();
  });

  it('any change to the payload changes the hash (tamper evidence)', async () => {
    const base = v.cases[0]!.payload;
    const original = await payloadHash(buildSigningPayload(base));
    const tampered = await payloadHash(buildSigningPayload({ ...base, amount: base.amount + 1 }));
    expect(tampered).not.toBe(original);
  });

  const valid: SigningInput = {
    id: 'e',
    account_id: 'a',
    type: 'purchase',
    amount: 100,
    recorded_at: '2026-10-21T08:00:00.000Z',
  };

  it.each([
    ['a float amount', { ...valid, amount: 1.5 }],
    ['a timestamp without milliseconds', { ...valid, recorded_at: '2026-10-21T08:00:00Z' }],
    ['a timestamp with an offset', { ...valid, recorded_at: '2026-10-21T11:00:00.000+03:00' }],
    ['a non-canonical qty', { ...valid, lines: [{ name: 'x', amount: 100, qty: '1.50' }] }],
    ['a zero device_seq', { ...valid, device_seq: 0 }],
  ])('rejects %s', (_label, input) => {
    expect(() => buildSigningPayload(input as SigningInput)).toThrow();
  });

  it('canonical timestamps are exactly toISOString output', () => {
    expect(isCanonicalTimestamp('2026-10-21T08:00:00.000Z')).toBe(true);
    expect(isCanonicalTimestamp('2026-02-30T08:00:00.000Z')).toBe(false);
    expect(isCanonicalTimestamp('2026-10-21T08:00:00.1234Z')).toBe(false);
  });

  it('sha256Hex matches a known digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
