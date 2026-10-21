import { type LocalDate, localDate } from '../calendar/local.js';

export type EntryType = 'purchase' | 'payment' | 'correction';

export interface LedgerEntry {
  seq: number;
  type: EntryType;
  /** Santim. Purchase and payment positive; correction a signed delta (ADR-004). */
  amount: number;
  /** RFC 3339 UTC. */
  recorded_at: string;
}

/** The entry's effect on the balance: + purchase, + correction delta, − payment. */
export function balanceDelta(e: Pick<LedgerEntry, 'type' | 'amount'>): number {
  return e.type === 'payment' ? -e.amount : e.amount;
}

export interface LedgerState {
  /** Σ purchase + Σ correction − Σ payment. */
  balance: number;
  /** Local date of the entry that opened the current unpaid period, or null if none is open. */
  periodStart: LocalDate | null;
}

/**
 * Walks the ledger in `seq` order (ADR-007). A period opens at the first entry that takes the
 * balance from ≤ 0 to > 0 and closes when the balance returns to ≤ 0. Partial payments keep it
 * open.
 */
export function ledgerState(entries: readonly LedgerEntry[]): LedgerState {
  let balance = 0;
  let periodStart: LocalDate | null = null;
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    const before = balance;
    balance += balanceDelta(e);
    if (before <= 0 && balance > 0) periodStart = localDate(new Date(e.recorded_at));
    else if (balance <= 0) periodStart = null;
  }
  return { balance, periodStart };
}
