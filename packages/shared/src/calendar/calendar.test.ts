import { describe, expect, it } from 'vitest';
import { addPeriod, type Period, rollingWindow } from '../limits/periods.js';
import { loadVectors } from '../test-vectors.js';
import {
  ethiopianMonthLength,
  ethiopianToGregorian,
  ethiopianToJdn,
  gregorianToEthiopian,
  gregorianToJdn,
  isEthiopianLeapYear,
  jdnToEthiopian,
  jdnToGregorian,
} from './ethiopian.js';
import {
  addDays,
  diffDays,
  formatLocalDate,
  localDate,
  parseLocalDate,
  startOfLocalDay,
} from './local.js';

interface CalendarVectors {
  conversions: { ethiopian: [number, number, number]; gregorian: string }[];
  invalid_ethiopian: [number, number, number][];
  local_date: { instant: string; local: string }[];
  start_of_local_day: { local: string; instant: string }[];
  add_period: { start: string; period: Period; due: string }[];
  rolling_window: { anchor: string; period: Period; today: string; start: string; end: string }[];
}

const v = loadVectors<CalendarVectors>('calendar');
const ymd = ([year, month, day]: [number, number, number]) => ({ year, month, day });

describe('Ethiopian calendar (test-vectors/calendar.json)', () => {
  it.each(v.conversions)('$ethiopian ↔ $gregorian', ({ ethiopian, gregorian }) => {
    expect(formatLocalDate(ethiopianToGregorian(ymd(ethiopian)))).toBe(gregorian);
    expect(gregorianToEthiopian(parseLocalDate(gregorian))).toEqual(ymd(ethiopian));
  });

  it.each(v.invalid_ethiopian)('rejects invalid Ethiopian date %j', (...date) => {
    expect(() => ethiopianToJdn(ymd(date as [number, number, number]))).toThrow();
  });

  it('round-trips every day from 1990 to 2060', () => {
    const from = gregorianToJdn({ year: 1990, month: 1, day: 1 });
    const to = gregorianToJdn({ year: 2060, month: 12, day: 31 });
    let prev = jdnToEthiopian(from - 1);
    for (let jdn = from; jdn <= to; jdn++) {
      const g = jdnToGregorian(jdn);
      expect(gregorianToJdn(g)).toBe(jdn);
      const e = jdnToEthiopian(jdn);
      expect(ethiopianToJdn(e)).toBe(jdn);
      // Each day is the previous one + 1 in the Ethiopian calendar.
      const lastOfMonth = prev.day === ethiopianMonthLength(prev.year, prev.month);
      const expected = !lastOfMonth
        ? { ...prev, day: prev.day + 1 }
        : prev.month === 13
          ? { year: prev.year + 1, month: 1, day: 1 }
          : { year: prev.year, month: prev.month + 1, day: 1 };
      expect(e).toEqual(expected);
      prev = e;
    }
  });

  it('Pagume has 6 days exactly when year % 4 == 3', () => {
    for (let year = 2000; year < 2040; year++) {
      expect(ethiopianMonthLength(year, 13)).toBe(year % 4 === 3 ? 6 : 5);
      expect(isEthiopianLeapYear(year)).toBe(year % 4 === 3);
    }
  });

  it('a leap Ethiopian year precedes a Gregorian leap year (Enkutatash on Sep 12)', () => {
    for (let year = 2000; year < 2040; year++) {
      const newYear = ethiopianToGregorian({ year: year + 1, month: 1, day: 1 });
      expect(newYear.month).toBe(9);
      expect(newYear.day).toBe(isEthiopianLeapYear(year) ? 12 : 11);
    }
  });
});

describe('Addis Ababa local dates', () => {
  it.each(v.local_date)('$instant is $local', ({ instant, local }) => {
    expect(localDate(new Date(instant))).toBe(local);
  });

  it.each(v.start_of_local_day)('$local starts at $instant', ({ local, instant }) => {
    expect(startOfLocalDay(local).toISOString()).toBe(instant);
  });

  it('rejects impossible dates', () => {
    expect(() => parseLocalDate('2026-02-30')).toThrow();
    expect(() => parseLocalDate('2026-13-01')).toThrow();
    expect(() => parseLocalDate('26-1-1')).toThrow();
  });

  it('adds and diffs days across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(diffDays('2026-10-01', '2026-10-19')).toBe(18);
  });
});

describe('periods', () => {
  it.each(v.add_period)(
    '$start + $period.type ($period.calendar) = $due',
    ({ start, period, due }) => {
      expect(addPeriod(start, period)).toBe(due);
    },
  );

  it.each(v.rolling_window)(
    'rolling $period.type from $anchor on $today',
    ({ anchor, period, today, start, end }) => {
      expect(rollingWindow(anchor, period, today)).toEqual({ start, end });
    },
  );

  it('monthly periods count from the anchor, never chain', () => {
    const p: Period = { type: 'monthly', calendar: 'gregorian' };
    expect(addPeriod('2026-01-31', p, 1)).toBe('2026-02-28');
    expect(addPeriod('2026-01-31', p, 2)).toBe('2026-03-31');
    expect(addPeriod('2026-01-31', p, 12)).toBe('2027-01-31');
  });

  it('every Ethiopian monthly period from a Nehase/Pagume start lands on Meskerem', () => {
    const p: Period = { type: 'monthly', calendar: 'ethiopian' };
    for (let day = 1; day <= 30; day++) {
      const start = formatLocalDate(ethiopianToGregorian({ year: 2018, month: 12, day }));
      expect(gregorianToEthiopian(parseLocalDate(addPeriod(start, p)))).toEqual({
        year: 2019,
        month: 1,
        day,
      });
    }
    for (let day = 1; day <= 5; day++) {
      const start = formatLocalDate(ethiopianToGregorian({ year: 2018, month: 13, day }));
      expect(gregorianToEthiopian(parseLocalDate(addPeriod(start, p)))).toEqual({
        year: 2019,
        month: 1,
        day: 30,
      });
    }
  });

  it('rolling windows tile time without gaps', () => {
    const periods: Period[] = [
      { type: 'weekly' },
      { type: 'custom_days', days: 10 },
      { type: 'monthly', calendar: 'gregorian' },
      { type: 'monthly', calendar: 'ethiopian' },
    ];
    for (const period of periods) {
      let day = '2026-01-31';
      for (let i = 0; i < 400; i++) {
        const w = rollingWindow('2026-01-31', period, day);
        expect(w.start <= day && day < w.end).toBe(true);
        day = addDays(day, 1);
      }
    }
  });

  it('rejects incomplete periods', () => {
    expect(() => addPeriod('2026-10-01', { type: 'monthly' })).toThrow(/calendar/);
    expect(() => addPeriod('2026-10-01', { type: 'custom_days' })).toThrow(/days/);
  });
});
