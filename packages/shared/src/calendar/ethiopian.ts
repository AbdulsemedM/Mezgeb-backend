/**
 * Ethiopian (Amete Mihret) ↔ Gregorian conversion through Julian Day Numbers.
 *
 * The Ethiopian year has 12 months of 30 days and Pagume (month 13) of 5 days, or 6 in a leap
 * year (year % 4 === 3, the year before the Gregorian leap year).
 * Conversion is display-only (ADR-003); dates are stored in UTC.
 */

export interface YMD {
  year: number;
  month: number;
  day: number;
}

const ETHIOPIAN_EPOCH_JDN = 1724220; // JDN of the day before 1 Meskerem 1 (Amete Mihret)

export function gregorianToJdn({ year, month, day }: YMD): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

export function jdnToGregorian(jdn: number): YMD {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

export function isEthiopianLeapYear(year: number): boolean {
  return ((year % 4) + 4) % 4 === 3;
}

export function ethiopianMonthLength(year: number, month: number): number {
  if (month < 1 || month > 13) throw new Error(`Ethiopian month out of range: ${month}`);
  if (month < 13) return 30;
  return isEthiopianLeapYear(year) ? 6 : 5;
}

export function isValidEthiopian({ year, month, day }: YMD): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 13 &&
    day >= 1 &&
    day <= ethiopianMonthLength(year, month)
  );
}

export function ethiopianToJdn(date: YMD): number {
  if (!isValidEthiopian(date)) throw new Error(`Invalid Ethiopian date: ${JSON.stringify(date)}`);
  const { year, month, day } = date;
  return ETHIOPIAN_EPOCH_JDN + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + day;
}

export function jdnToEthiopian(jdn: number): YMD {
  // Estimate the year, then correct it against the exact start of year.
  let year = Math.floor(((jdn - ETHIOPIAN_EPOCH_JDN) * 4) / 1461) + 1;
  while (ethiopianToJdn({ year, month: 1, day: 1 }) > jdn) year--;
  while (ethiopianToJdn({ year: year + 1, month: 1, day: 1 }) <= jdn) year++;
  const dayOfYear = jdn - ethiopianToJdn({ year, month: 1, day: 1 });
  return { year, month: Math.floor(dayOfYear / 30) + 1, day: (dayOfYear % 30) + 1 };
}

export function gregorianToEthiopian(date: YMD): YMD {
  return jdnToEthiopian(gregorianToJdn(date));
}

export function ethiopianToGregorian(date: YMD): YMD {
  return jdnToGregorian(ethiopianToJdn(date));
}

/** Month names for display. TODO(i18n-review): Afaan Oromo names need native review. */
export const ETHIOPIAN_MONTHS = {
  am: [
    'መስከረም',
    'ጥቅምት',
    'ኅዳር',
    'ታኅሣሥ',
    'ጥር',
    'የካቲት',
    'መጋቢት',
    'ሚያዝያ',
    'ግንቦት',
    'ሰኔ',
    'ሐምሌ',
    'ነሐሴ',
    'ጳጉሜ',
  ],
  om: [
    'Fulbaana',
    'Onkoloolessa',
    'Sadaasa',
    'Muddee',
    'Amajjii',
    'Guraandhala',
    'Bitootessa',
    'Ebla',
    'Caamsaa',
    'Waxabajjii',
    'Adoolessa',
    'Hagayya',
    'Qaammee',
  ],
  en: [
    'Meskerem',
    'Tikimt',
    'Hidar',
    'Tahsas',
    'Tir',
    'Yekatit',
    'Megabit',
    'Miyazya',
    'Ginbot',
    'Sene',
    'Hamle',
    'Nehase',
    'Pagume',
  ],
} as const;
