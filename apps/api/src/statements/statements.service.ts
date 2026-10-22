import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ETHIOPIAN_MONTHS,
  formatBirr,
  gregorianToEthiopian,
  type Language,
  type LocalDate,
  localDate,
  parseLocalDate,
  startOfLocalDay,
  addDays,
} from '@mezgeb/shared';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { AccountAccess } from '../access/access.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser, entry, entryLine, representative } from '../db/schema.js';
import { t } from '../i18n/messages.js';
import { renderStatementPdf } from './statement.pdf.js';

export interface StatementRow {
  /** The requester's calendar, in words. */
  date: string;
  what: string;
  who: string;
  /** Signed santim: purchases and corrections as recorded, payments negative. */
  amount: number;
  balance: number;
}

/** Everything the PDF shows, already in the requester's language and calendar. */
export interface Statement {
  language: Language;
  title: string;
  shop: string;
  customer: string;
  period: string;
  opening: number;
  rows: StatementRow[];
  closing: number;
  /** The last entry in the period (ADR-001 receipt), or null when nothing was recorded. */
  head: { seq: number; hash: string } | null;
  generated: string;
}

const GREGORIAN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A local date in the reader's calendar (ADR-003): "12 Tikimt 2019" or "22 Oct 2026". */
export function displayDate(
  date: LocalDate,
  language: Language,
  calendar: 'ethiopian' | 'gregorian',
): string {
  const g = parseLocalDate(date);
  if (calendar === 'ethiopian') {
    const e = gregorianToEthiopian(g);
    const month = ETHIOPIAN_MONTHS[language][e.month - 1];
    return language === 'am' ? `${month} ${e.day} ${e.year} ዓ.ም.` : `${e.day} ${month} ${e.year}`;
  }
  if (language === 'en') return `${g.day} ${GREGORIAN_MONTHS[g.month - 1]} ${g.year}`;
  return `${String(g.day).padStart(2, '0')}/${String(g.month).padStart(2, '0')}/${g.year}`;
}

/** Credit for payments: they lower what is owed. */
const signed = (type: string, amount: number) => (type === 'payment' ? -amount : amount);

/**
 * LED-7 / US-14: one account's statement for a period, in the requester's language and
 * calendar, as a PDF. Owner and customer only (ADR-003); the customer's copy never shows the
 * shop's nickname for them (CLAUDE.md rule 8).
 */
@Injectable()
export class StatementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** `from` and `to` are Addis local dates, both included. */
  async build(
    a: AccountAccess,
    userId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<Statement> {
    if (from > to) {
      throw new AppError(
        'invalid_period',
        'The period ends before it starts',
        HttpStatus.BAD_REQUEST,
      );
    }
    const [reader] = await this.db.select().from(appUser).where(eq(appUser.id, userId));
    const [customer] = await this.db
      .select()
      .from(appUser)
      .where(eq(appUser.id, a.account.customerUserId));
    const language = reader!.language;
    const calendar = reader!.calendarPref ?? 'ethiopian';
    const start = startOfLocalDay(from);
    const end = startOfLocalDay(addDays(to, 1));

    const before = await this.db
      .select({ type: entry.type, amount: entry.amount })
      .from(entry)
      .where(and(eq(entry.accountId, a.account.id), lt(entry.recordedAt, start)));
    const opening = before.reduce((sum, e) => sum + signed(e.type, e.amount), 0);

    const rows = (
      await this.db
        .select()
        .from(entry)
        .where(eq(entry.accountId, a.account.id))
        .orderBy(asc(entry.recordedAt), asc(entry.seq))
    ).filter((e) => e.recordedAt >= start && e.recordedAt < end);
    const lines = rows.length
      ? await this.db
          .select()
          .from(entryLine)
          .where(
            inArray(
              entryLine.entryId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(entryLine.lineNo))
      : [];
    const repIds = [...new Set(rows.map((r) => r.representativeId).filter((id) => id !== null))];
    const reps = repIds.length
      ? await this.db.select().from(representative).where(inArray(representative.id, repIds))
      : [];

    let balance = opening;
    const out: StatementRow[] = rows.map((e) => {
      const amount = signed(e.type, e.amount);
      balance += amount;
      const items = lines.filter((l) => l.entryId === e.id).map((l) => l.name);
      const kind = t(`statement.${e.type}`, language);
      const detail = e.type === 'purchase' ? items.join(', ') : (e.reason ?? '');
      let who = '';
      if (e.takenByType === 'customer') who = t('statement.who_customer', language);
      if (e.takenByType === 'delivery') who = t('statement.who_delivery', language);
      if (e.takenByType === 'representative') {
        who = reps.find((r) => r.id === e.representativeId)?.name ?? '';
      }
      return {
        date: displayDate(localDate(e.recordedAt), language, calendar),
        what: detail ? `${kind}: ${detail}` : kind,
        who,
        amount,
        balance,
      };
    });
    const last = rows.at(-1);
    const customerName =
      a.role === 'customer'
        ? (customer!.name ?? customer!.phone)
        : [a.account.nickname, customer!.name, customer!.phone]
            .filter((x): x is string => !!x)
            .join(' · ');

    return {
      language,
      title: t('statement.title', language),
      shop: a.merchant.shopName,
      customer: customerName,
      period: `${displayDate(from, language, calendar)} – ${displayDate(to, language, calendar)}`,
      opening,
      rows: out,
      closing: balance,
      head: last ? { seq: last.seq, hash: last.hash } : null,
      generated: t('statement.generated', language, {
        date: displayDate(localDate(this.clock.now()), language, calendar),
      }),
    };
  }

  async pdf(a: AccountAccess, userId: string, from: LocalDate, to: LocalDate): Promise<Buffer> {
    return renderStatementPdf(await this.build(a, userId, from, to), (santim, language) =>
      formatBirr(santim, language),
    );
  }
}
