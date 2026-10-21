import { describe, expect, it } from 'vitest';
import { loadVectors } from '../test-vectors.js';
import { evaluateLimits, type LimitsInput, type SideLimit } from './engine.js';
import { type LedgerEntry, ledgerState } from './period-start.js';

interface LimitsVectors {
  evaluate: { name: string; input: Omit<LimitsInput, 'now'> & { now: string }; expected: object }[];
  ledger_state: {
    name: string;
    entries: LedgerEntry[];
    balance: number;
    periodStart: string | null;
  }[];
}

const v = loadVectors<LimitsVectors>('limits');
const run = (input: LimitsVectors['evaluate'][number]['input']) =>
  evaluateLimits({ ...input, now: new Date(input.now) });

describe('limits engine (test-vectors/limits.json)', () => {
  it.each(v.evaluate)('$name', ({ input, expected }) => {
    expect(run(input)).toMatchObject(expected);
  });

  it.each(v.ledger_state)('ledger state: $name', ({ entries, balance, periodStart }) => {
    expect(ledgerState(entries)).toEqual({ balance, periodStart });
  });
});

describe('limits engine properties', () => {
  const now = new Date('2026-10-10T09:00:00.000Z');
  const alert = (value: number): SideLimit => ({ value, period: null, mode: 'alert' });
  const base: LimitsInput = {
    merchant: null,
    customer: null,
    openBalance: 0,
    periodStart: null,
    amount: 0,
    now,
  };

  it('the stricter side always applies, whichever side it is', () => {
    for (const [m, c] of [
      [300, 500],
      [500, 300],
    ] as const) {
      const r = evaluateLimits({ ...base, merchant: alert(m), customer: alert(c), amount: 1 });
      expect(r.value.effective_limit).toBe(Math.min(m, c));
    }
  });

  it('status never improves as the amount grows', () => {
    const order = ['ok', 'warn80', 'block100', 'hard_stop'];
    const customer: SideLimit = { value: 10_000, period: null, mode: 'hard_stop' };
    let last = 0;
    for (let amount = 0; amount <= 15_000; amount += 50) {
      const r = evaluateLimits({
        ...base,
        customer,
        merchant: alert(12_000),
        openBalance: 1_000,
        amount,
      });
      const s = order.indexOf(r.status);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it('crossing 80% happens exactly once on the way up', () => {
    let balance = 0;
    let crossings = 0;
    for (let i = 0; i < 100; i++) {
      const r = evaluateLimits({
        ...base,
        customer: alert(10_000),
        openBalance: balance,
        amount: 137,
      });
      if (r.value.crossed.includes('80')) crossings++;
      balance += 137;
    }
    expect(crossings).toBe(1);
  });

  it('a partial payment keeps the due date; a full one ends the period', () => {
    const weekly: SideLimit = { value: null, period: { type: 'weekly' }, mode: 'alert' };
    const entries: LedgerEntry[] = [
      { seq: 1, type: 'purchase', amount: 1000, recorded_at: '2026-10-01T08:00:00.000Z' },
      { seq: 2, type: 'payment', amount: 400, recorded_at: '2026-10-03T08:00:00.000Z' },
    ];
    const partial = ledgerState(entries);
    expect(
      evaluateLimits({
        ...base,
        customer: weekly,
        openBalance: partial.balance,
        periodStart: partial.periodStart,
      }).time.due_date,
    ).toBe('2026-10-08');

    const full = ledgerState([
      ...entries,
      { seq: 3, type: 'payment', amount: 600, recorded_at: '2026-10-04T08:00:00.000Z' },
    ]);
    expect(full).toEqual({ balance: 0, periodStart: null });
    // The next purchase starts a new period today.
    expect(
      evaluateLimits({ ...base, customer: weekly, openBalance: 0, periodStart: null, amount: 500 })
        .time,
    ).toMatchObject({ period_start: '2026-10-10', due_date: '2026-10-17' });
  });

  it('rejects floats and negative amounts', () => {
    expect(() => evaluateLimits({ ...base, amount: 1.5 })).toThrow(/integer/);
    expect(() => evaluateLimits({ ...base, amount: -1 })).toThrow(/negative/);
    expect(() => evaluateLimits({ ...base, openBalance: 0.5 })).toThrow(/integer/);
  });
});
