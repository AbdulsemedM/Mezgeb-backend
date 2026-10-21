// Generates test-vectors/signing.json (ADR-001). Written independently of src/ so the vectors
// check the implementation rather than echo it: its own key-sorted JSON (sufficient for these
// ASCII-keyed payloads) and Node's crypto for SHA-256 and ECDSA.
//
//   node scripts/gen-signing-vectors.mjs            # re-sign with the stored test key
//   node scripts/gen-signing-vectors.mjs --new-key  # also make a new test key
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const out = new URL('../test-vectors/signing.json', import.meta.url);
const jcs = (v) =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(jcs).join(',')}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`)
          .join(',')}}`;
const sha256 = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

let privateKey;
if (!process.argv.includes('--new-key') && existsSync(out)) {
  const prev = JSON.parse(readFileSync(out, 'utf8'));
  privateKey = createPrivateKey({
    key: Buffer.from(prev.test_key.private_pkcs8_b64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
} else {
  privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
}
const publicKey = createPublicKey(privateKey);

const ACCOUNT = '01a15f64-0000-7000-8000-00000000a001';
const DEVICE = '01a15f64-0000-7000-8000-00000000d001';
const payloads = [
  {
    name: 'genesis: detailed purchase taken by the customer',
    seq: 1,
    received_at: '2026-10-21T08:00:01.250Z',
    origin: 'device',
    payload: {
      id: '01a15f64-0000-7000-8000-00000000e001',
      account_id: ACCOUNT,
      type: 'purchase',
      amount: 12500,
      lines: [
        {
          name: 'Eggs',
          qty: '6',
          unit: 'pc',
          unit_price: 1500,
          amount: 9000,
          item_id: null,
          source: 'photo',
        },
        {
          name: 'Sugar',
          qty: '1.5',
          unit: 'kg',
          unit_price: 2000,
          amount: 3000,
          item_id: '01a15f64-0000-7000-8000-00000000c001',
          source: 'manual',
        },
        {
          name: 'Bread',
          qty: null,
          unit: null,
          unit_price: null,
          amount: 500,
          item_id: null,
          source: 'manual',
        },
      ],
      taken_by_type: 'customer',
      representative_id: null,
      order_id: null,
      ref_entry_id: null,
      reason: null,
      device_id: DEVICE,
      device_seq: 1,
      recorded_at: '2026-10-21T07:59:58.000Z',
    },
  },
  {
    name: 'correction with a negative amount and an Amharic reason',
    seq: 2,
    received_at: '2026-10-21T09:30:00.000Z',
    origin: 'device',
    payload: {
      id: '01a15f64-0000-7000-8000-00000000e002',
      account_id: ACCOUNT,
      type: 'correction',
      amount: -500,
      lines: [
        {
          name: 'Bread',
          qty: null,
          unit: null,
          unit_price: null,
          amount: -500,
          item_id: null,
          source: 'manual',
        },
      ],
      taken_by_type: null,
      representative_id: null,
      order_id: null,
      ref_entry_id: '01a15f64-0000-7000-8000-00000000e001',
      reason: 'ዳቦ ተመልሷል (bread returned)',
      device_id: DEVICE,
      device_seq: 2,
      recorded_at: '2026-10-21T09:29:55.123Z',
    },
  },
  {
    name: 'server-origin payment (payment confirmation): no device, no signature',
    seq: 3,
    received_at: '2026-10-22T10:00:00.000Z',
    origin: 'server',
    payload: {
      id: '01a15f64-0000-7000-8000-00000000e003',
      account_id: ACCOUNT,
      type: 'payment',
      amount: 10000,
      lines: [],
      taken_by_type: null,
      representative_id: null,
      order_id: null,
      ref_entry_id: null,
      reason: null,
      device_id: null,
      device_seq: null,
      recorded_at: '2026-10-22T10:00:00.000Z',
    },
  },
];

let prevHash = '0'.repeat(64);
const cases = payloads.map((p) => {
  const canonical = jcs(p.payload);
  const deviceSig =
    p.origin === 'device'
      ? sign('sha256', Buffer.from(canonical, 'utf8'), {
          key: privateKey,
          dsaEncoding: 'der',
        }).toString('base64')
      : null;
  if (
    deviceSig &&
    !verify(
      'sha256',
      Buffer.from(canonical, 'utf8'),
      { key: publicKey, dsaEncoding: 'der' },
      Buffer.from(deviceSig, 'base64'),
    )
  ) {
    throw new Error('self-check failed');
  }
  const payloadHash = sha256(canonical);
  const link = {
    seq: p.seq,
    prev_hash: prevHash,
    payload_hash: payloadHash,
    device_sig: deviceSig,
    received_at: p.received_at,
  };
  const linkCanonical = jcs(link);
  const hash = sha256(linkCanonical);
  prevHash = hash;
  return {
    name: p.name,
    payload: p.payload,
    canonical,
    device_sig: deviceSig,
    payload_hash: payloadHash,
    link,
    link_canonical: linkCanonical,
    hash,
  };
});

writeFileSync(
  out,
  JSON.stringify(
    {
      description:
        'ADR-001 chain: payload -> JCS canonical (UTF-8) -> ECDSA P-256/SHA-256 DER signature by test_key -> payload_hash = sha256(canonical) -> hash = sha256(JCS(link)). Cases form one chain (prev_hash links). ECDSA is randomized: verify device_sig, do not compare it byte-for-byte with a fresh signature. Regenerate with scripts/gen-signing-vectors.mjs.',
      test_key: {
        warning: 'TEST KEY ONLY. Never use outside tests.',
        public_spki_b64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        private_pkcs8_b64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      },
      genesis_hash: '0'.repeat(64),
      cases,
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${cases.length} cases`);
