import { addDays, compareLocalDates, type LocalDate, localDate } from '../calendar/local.js';
import { assertSantim } from '../money.js';
import { addPeriod, type Period } from './periods.js';

/**
 * The limits engine (spec "Limits engine rules", ADR-003, ADR-007). Pure: the caller supplies
 * the ledger facts; the engine decides. Shared by the API, the PWA and (ported) the Flutter app,
 * which checks offline against the last synced state.
 */

export type LimitStatus = 'ok' | 'warn80' | 'block100' | 'hard_stop';
export type Threshold = '80' | '100';
export type TimeState = 'none' | 'running' | 'due_soon' | 'due' | 'overdue';
export type LimitFlag = 'over_limit' | 'over_hard_stop' | 'rep_over_limit';

export interface SideLimit {
  /** Santim, or null for a time-only limit. */
  value: number | null;
  period: Period | null;
  mode: 'alert' | 'hard_stop';
}

export interface RepresentativeLimit {
  value: number | null;
  /** The representative's purchases in their current rolling period (see rollingWindow). */
  spentInPeriod: number;
}

export interface LimitsInput {
  merchant: SideLimit | null;
  customer: SideLimit | null;
  representative?: RepresentativeLimit | null;
  /** Current open balance before this purchase. */
  openBalance: number;
  /** From ledgerState(); null if no unpaid period is open. */
  periodStart: LocalDate | null;
  /** The new purchase in santim; 0 to evaluate the current state only. */
  amount: number;
  now: Date;
  /** A one-time raise the customer approved for this purchase (M8). */
  oneTimeRaise?: number;
}

export interface ValueResult {
  status: LimitStatus;
  /** Lower of the two sides' values (raised by oneTimeRaise on the customer side), or null. */
  effective_limit: number | null;
  projected_balance: number;
  /** Thresholds this purchase crosses, so alerts fire once (ADR-007). */
  crossed: Threshold[];
}

export interface RepresentativeResult {
  status: Exclude<LimitStatus, 'hard_stop'>;
  limit: number;
  projected_spend: number;
  crossed: Threshold[];
}

export interface TimeResult {
  state: TimeState;
  /** The earlier of the two sides' due dates (local), or null. */
  due_date: LocalDate | null;
  merchant_due_date: LocalDate | null;
  customer_due_date: LocalDate | null;
  period_start: LocalDate | null;
}

export interface LimitsResult {
  /** Worst of the value and representative checks. */
  status: LimitStatus;
  value: ValueResult;
  representative: RepresentativeResult | null;
  time: TimeResult;
  flags: LimitFlag[];
}

const SEVERITY: Record<LimitStatus, number> = { ok: 0, warn80: 1, block100: 2, hard_stop: 3 };
export const DUE_SOON_DAYS = 3;
export const OVERDUE_AFTER_DAYS = 7;

export function evaluateLimits(input: LimitsInput): LimitsResult {
  assertSantim(input.openBalance, 'openBalance');
  assertSantim(input.amount, 'amount');
  if (input.amount < 0) throw new Error('amount must not be negative');
  const raise = input.oneTimeRaise ?? 0;
  assertSantim(raise, 'oneTimeRaise');

  const before = input.openBalance;
  const projected = before + input.amount;

  // Value limit: the stricter side applies; the customer's side may carry a one-time raise.
  const customerValue = input.customer?.value != null ? input.customer.value + raise : null;
  const values = [input.merchant?.value ?? null, customerValue].filter(
    (v): v is number => v !== null,
  );
  const effective = values.length > 0 ? Math.min(...values) : null;

  const flags: LimitFlag[] = [];
  let valueStatus: LimitStatus = effective === null ? 'ok' : level(projected, effective);
  if (valueStatus === 'block100') flags.push('over_limit');
  // Hard stop only for the customer's own hard-stop limit (ADR-007).
  if (input.customer?.mode === 'hard_stop' && customerValue !== null && projected > customerValue) {
    valueStatus = 'hard_stop';
    flags.push('over_hard_stop');
  }
  const value: ValueResult = {
    status: valueStatus,
    effective_limit: effective,
    projected_balance: projected,
    crossed: effective === null ? [] : crossed(before, projected, effective),
  };

  let representative: RepresentativeResult | null = null;
  const rep = input.representative;
  if (rep?.value != null) {
    assertSantim(rep.spentInPeriod, 'spentInPeriod');
    const spent = rep.spentInPeriod + input.amount;
    const status = level(spent, rep.value);
    if (status === 'block100') flags.push('rep_over_limit');
    representative = {
      status,
      limit: rep.value,
      projected_spend: spent,
      crossed: crossed(rep.spentInPeriod, spent, rep.value),
    };
  }

  const status = [value.status, representative?.status ?? 'ok'].reduce<LimitStatus>(
    (worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst),
    'ok',
  );

  return { status, value, representative, time: timeResult(input, projected), flags };
}

/** ok below 80%, warn80 from 80% up to and including 100%, block100 above (ADR-007). */
function level(amount: number, limit: number): Exclude<LimitStatus, 'hard_stop'> {
  if (amount > limit) return 'block100';
  if (amount * 100 >= limit * 80) return 'warn80';
  return 'ok';
}

function crossed(before: number, after: number, limit: number): Threshold[] {
  const out: Threshold[] = [];
  if (before * 100 < limit * 80 && after * 100 >= limit * 80) out.push('80');
  if (before < limit && after >= limit) out.push('100');
  return out;
}

function timeResult(input: LimitsInput, projected: number): TimeResult {
  const today = localDate(input.now);
  // A purchase with no open period starts one today (ADR-007).
  const start = projected > 0 ? (input.periodStart ?? (input.amount > 0 ? today : null)) : null;
  const dueFor = (side: SideLimit | null) =>
    start && side?.period ? addPeriod(start, side.period) : null;
  const merchantDue = dueFor(input.merchant);
  const customerDue = dueFor(input.customer);
  const due =
    [merchantDue, customerDue]
      .filter((d): d is LocalDate => d !== null)
      .sort(compareLocalDates)[0] ?? null;

  let state: TimeState = 'none';
  if (due) {
    if (compareLocalDates(today, addDays(due, OVERDUE_AFTER_DAYS)) >= 0) state = 'overdue';
    else if (compareLocalDates(today, due) >= 0) state = 'due';
    else if (compareLocalDates(today, addDays(due, -DUE_SOON_DAYS)) >= 0) state = 'due_soon';
    else state = 'running';
  }
  return {
    state,
    due_date: due,
    merchant_due_date: merchantDue,
    customer_due_date: customerDue,
    period_start: start,
  };
}
