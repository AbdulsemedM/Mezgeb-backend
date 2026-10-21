import { ethiopianToGregorian, gregorianToEthiopian } from '../calendar/ethiopian.js';
import {
  addDays,
  compareLocalDates,
  diffDays,
  formatLocalDate,
  type LocalDate,
  parseLocalDate,
} from '../calendar/local.js';

export type PeriodType = 'weekly' | 'biweekly' | 'monthly' | 'custom_days';
export type Calendar = 'ethiopian' | 'gregorian';

/** A limit's time period (spec "Limits engine rules"; account_limit / representative columns). */
export interface Period {
  type: PeriodType;
  /** Required for custom_days. */
  days?: number | null;
  /** Required for monthly: the setter's calendar (ADR-003, ADR-004). */
  calendar?: Calendar | null;
}

/**
 * `start` + `n` periods (ADR-007). Always counted from `start`, never chained, so a monthly
 * period anchored on the 31st comes back to the 31st after a short month.
 */
export function addPeriod(start: LocalDate, period: Period, n = 1): LocalDate {
  switch (period.type) {
    case 'weekly':
      return addDays(start, 7 * n);
    case 'biweekly':
      return addDays(start, 14 * n);
    case 'custom_days':
      if (!period.days || period.days < 1) throw new Error('custom_days period needs days >= 1');
      return addDays(start, period.days * n);
    case 'monthly':
      if (period.calendar === 'gregorian') return addGregorianMonths(start, n);
      if (period.calendar === 'ethiopian') return addEthiopianMonths(start, n);
      throw new Error('monthly period needs a calendar');
  }
}

function addGregorianMonths(start: LocalDate, n: number): LocalDate {
  const { year, month, day } = parseLocalDate(start);
  const index = year * 12 + (month - 1) + n;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return formatLocalDate({ year: y, month: m, day: Math.min(day, lastDay) });
}

/**
 * Ethiopian billing months: the 12 thirty-day months, with Pagume folded into Nehase
 * (ADR-003). A start inside Pagume counts as Nehase 30.
 */
function addEthiopianMonths(start: LocalDate, n: number): LocalDate {
  const ethiopian = gregorianToEthiopian(parseLocalDate(start));
  const year = ethiopian.year;
  let { month, day } = ethiopian;
  if (month === 13) {
    month = 12;
    day = 30;
  }
  const index = year * 12 + (month - 1) + n;
  return formatLocalDate(
    ethiopianToGregorian({ year: Math.floor(index / 12), month: (index % 12) + 1, day }),
  );
}

export interface Window {
  /** Inclusive. */
  start: LocalDate;
  /** Exclusive. */
  end: LocalDate;
}

/**
 * The rolling period containing `today`, counted from `anchor` (ADR-007: representative
 * limits). Before the anchor, the first period.
 */
export function rollingWindow(anchor: LocalDate, period: Period, today: LocalDate): Window {
  if (compareLocalDates(today, anchor) < 0)
    return { start: anchor, end: addPeriod(anchor, period) };

  // Estimate k, then correct; addPeriod is monotonic in k.
  const approxDays =
    period.type === 'weekly'
      ? 7
      : period.type === 'biweekly'
        ? 14
        : period.type === 'custom_days'
          ? period.days!
          : 30;
  let k = Math.max(0, Math.floor(diffDays(anchor, today) / approxDays) - 1);
  while (compareLocalDates(addPeriod(anchor, period, k + 1), today) <= 0) k++;
  while (k > 0 && compareLocalDates(addPeriod(anchor, period, k), today) > 0) k--;
  return { start: addPeriod(anchor, period, k), end: addPeriod(anchor, period, k + 1) };
}
