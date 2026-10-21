import { gregorianToJdn, jdnToGregorian, type YMD } from './ethiopian.js';

/**
 * Local calendar dates in Africa/Addis_Ababa (fixed UTC+3, no DST; ADR-007), written as
 * Gregorian `YYYY-MM-DD`. Billing periods and due dates are local dates.
 */
export type LocalDate = string;

export const ADDIS_OFFSET_MS = 3 * 60 * 60_000;

export function parseLocalDate(date: LocalDate): YMD {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a local date (YYYY-MM-DD): ${date}`);
  const ymd = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (toJdnCheck(ymd) !== date) {
    throw new Error(`Invalid date: ${date}`);
  }
  return ymd;
}

export function formatLocalDate({ year, month, day }: YMD): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The Addis Ababa calendar date of an instant. */
export function localDate(instant: Date): LocalDate {
  const t = new Date(instant.getTime() + ADDIS_OFFSET_MS);
  return formatLocalDate({
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
  });
}

/** 00:00 Addis Ababa time on `date`, as an instant. */
export function startOfLocalDay(date: LocalDate): Date {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day) - ADDIS_OFFSET_MS);
}

export function localDateToJdn(date: LocalDate): number {
  return gregorianToJdn(parseLocalDate(date));
}

export function jdnToLocalDate(jdn: number): LocalDate {
  return formatLocalDate(jdnToGregorian(jdn));
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return jdnToLocalDate(localDateToJdn(date) + days);
}

/** `b − a` in days. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return localDateToJdn(b) - localDateToJdn(a);
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0; // ISO dates sort lexicographically
}

function toJdnCheck(ymd: YMD): LocalDate {
  // Round-trips through JDN, which normalizes impossible dates like 2026-02-30.
  return formatLocalDate(jdnToGregorian(gregorianToJdn(ymd)));
}
