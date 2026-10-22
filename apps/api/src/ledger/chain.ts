import {
  buildSigningPayload,
  entryHash,
  GENESIS_HASH,
  payloadHash,
  type SigningPayload,
  signingBytes,
} from '@mezgeb/shared';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/db.module.js';
import { account, device, entry, entryLine } from '../db/schema.js';
import { verifyDeviceSignature } from '../devices/device-key.js';
import { type EntryLineRow, type EntryRow, linesByEntry } from './entry.views.js';

/** The ADR-001 signing payload, rebuilt byte for byte from the stored row and its lines. */
export function payloadOf(e: EntryRow, lines: EntryLineRow[]): SigningPayload {
  return buildSigningPayload({
    id: e.id,
    account_id: e.accountId,
    type: e.type,
    amount: e.amount,
    lines: [...lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        name: l.name,
        qty: l.qty,
        unit: l.unit,
        unit_price: l.unitPrice,
        amount: l.amount,
        item_id: l.itemId,
        source: l.source,
      })),
    taken_by_type: e.takenByType,
    representative_id: e.representativeId,
    order_id: e.orderId,
    ref_entry_id: e.refEntryId,
    reason: e.reason,
    device_id: e.deviceId,
    device_seq: e.deviceSeq,
    recorded_at: e.recordedAt.toISOString(),
  });
}

export type ChainVerification =
  | { ok: true; checked: number; head: { seq: number; hash: string } }
  | {
      ok: false;
      checked: number;
      first_bad_seq: number;
      reason: 'seq_gap' | 'prev_hash' | 'payload_hash' | 'hash' | 'head';
    };

/**
 * Recomputes the chain of one account from genesis (ADR-001 "Verification"): seq contiguity,
 * prev_hash links, the payload hash of every row, every entry hash, and the account head.
 * Signatures were verified at insert; the hash covers them, so a changed signature fails too.
 */
export async function verifyAccountChain(db: Db, accountId: string): Promise<ChainVerification> {
  const rows = await db
    .select()
    .from(entry)
    .where(eq(entry.accountId, accountId))
    .orderBy(asc(entry.seq));
  const lines = rows.length
    ? await db
        .select()
        .from(entryLine)
        .where(
          inArray(
            entryLine.entryId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  const grouped = linesByEntry(lines);
  const deviceIds = [
    ...new Set(rows.map((r) => r.deviceId).filter((d): d is string => d !== null)),
  ];
  const keys = new Map(
    deviceIds.length
      ? (
          await db
            .select({ id: device.id, publicKey: device.publicKey })
            .from(device)
            .where(inArray(device.id, deviceIds))
        ).map((d) => [d.id, d.publicKey] as const)
      : [],
  );

  let prev = GENESIS_HASH;
  let checked = 0;
  for (const [i, e] of rows.entries()) {
    const bad = (reason: Extract<ChainVerification, { ok: false }>['reason']) =>
      ({ ok: false, checked, first_bad_seq: e.seq, reason }) as const;
    if (e.seq !== i + 1) return bad('seq_gap');
    if (e.prevHash !== prev) return bad('prev_hash');
    const payload = payloadOf(e, grouped.get(e.id) ?? []);
    const ph = await payloadHash(payload);
    const hash = await entryHash({
      seq: e.seq,
      prev_hash: e.prevHash,
      payload_hash: ph,
      device_sig: e.deviceSig,
      received_at: e.receivedAt.toISOString(),
    });
    if (hash !== e.hash) {
      // Tell the operator what changed: content (the signature no longer matches) or the hash.
      const key = e.deviceId ? keys.get(e.deviceId) : undefined;
      const contentChanged =
        key !== undefined &&
        e.deviceSig !== null &&
        !verifyDeviceSignature(key, signingBytes(payload), e.deviceSig);
      return bad(contentChanged ? 'payload_hash' : 'hash');
    }
    prev = e.hash;
    checked++;
  }

  const [head] = await db
    .select({ seq: account.lastSeq, hash: account.lastHash })
    .from(account)
    .where(eq(account.id, accountId));
  if (!head || head.seq !== rows.length || head.hash !== prev) {
    return { ok: false, checked, first_bad_seq: rows.length + 1, reason: 'head' };
  }
  return { ok: true, checked, head };
}

/** Accounts with entries received since `since` (for the nightly check). */
export async function accountsChangedSince(db: Db, since: Date): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: entry.accountId })
    .from(entry)
    .where(and(gte(entry.receivedAt, since)));
  return rows.map((r) => r.id);
}
