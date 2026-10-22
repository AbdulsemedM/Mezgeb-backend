import type { entry, entryLine } from '../db/schema.js';

export type EntryRow = typeof entry.$inferSelect;
export type EntryLineRow = typeof entryLine.$inferSelect;

export interface EntryLineView {
  line_no: number;
  name: string;
  qty: string | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  item_id: string | null;
  source: EntryLineRow['source'];
}

/** Everything both parties may see about an entry, including its chain receipt. */
export interface EntryView {
  id: string;
  account_id: string;
  type: EntryRow['type'];
  amount: number;
  lines: EntryLineView[];
  taken_by_type: EntryRow['takenByType'];
  representative_id: string | null;
  order_id: string | null;
  ref_entry_id: string | null;
  reason: string | null;
  seq: number;
  prev_hash: string;
  hash: string;
  received_at: string;
  recorded_at: string;
  origin: EntryRow['origin'];
  device_id: string | null;
  device_seq: number | null;
  device_sig: string | null;
  flags: EntryRow['flags'];
  created_by: string;
}

export function entryView(e: EntryRow, lines: EntryLineRow[]): EntryView {
  return {
    id: e.id,
    account_id: e.accountId,
    type: e.type,
    amount: e.amount,
    lines: [...lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        line_no: l.lineNo,
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
    seq: e.seq,
    prev_hash: e.prevHash,
    hash: e.hash,
    received_at: e.receivedAt.toISOString(),
    recorded_at: e.recordedAt.toISOString(),
    origin: e.origin,
    device_id: e.deviceId,
    device_seq: e.deviceSeq,
    device_sig: e.deviceSig,
    flags: e.flags,
    created_by: e.createdBy,
  };
}

/** Lines grouped by entry id. */
export function linesByEntry(lines: EntryLineRow[]): Map<string, EntryLineRow[]> {
  const out = new Map<string, EntryLineRow[]>();
  for (const l of lines) out.set(l.entryId, [...(out.get(l.entryId) ?? []), l]);
  return out;
}
