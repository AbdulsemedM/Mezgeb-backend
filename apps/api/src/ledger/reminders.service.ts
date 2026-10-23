import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { evaluateLimits, formatBirr } from '@mezgeb/shared';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DB, type Db } from '../db/db.module.js';
import {
  account,
  accountLimit,
  appUser,
  merchant,
  notification,
  paymentReport,
} from '../db/schema.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { displayDate } from '../statements/statements.service.js';
import { limitsInputFor } from './limits.service.js';

const DAY_MS = 24 * 60 * 60_000;
const REPORT_REMINDER_AFTER_MS = 2 * DAY_MS;

/**
 * M10 scheduled notices (ADR-015): "time limit in 3 days" and "time limit reached" (ADR-007 due
 * dates) and PAY-6, the owner's reminder for a payment report not reviewed in 48 hours. Each
 * notice carries a key, so a run never sends the same reminder twice.
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RemindersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly outbox: OutboxService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.REMINDERS_INTERVAL_MS > 0) {
      this.timer = setInterval(
        () => void this.runOnce().catch((e: Error) => this.logger.error(e.message)),
        this.config.REMINDERS_INTERVAL_MS,
      );
    }
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Returns the number of reminders queued. */
  async runOnce(): Promise<number> {
    return (await this.dueDates()) + (await this.unreviewedReports());
  }

  private async dueDates(): Promise<number> {
    const now = this.clock.now();
    const rows = await this.db
      .selectDistinct({ account, merchant, customer: appUser })
      .from(account)
      .innerJoin(accountLimit, eq(accountLimit.accountId, account.id))
      .innerJoin(merchant, eq(merchant.id, account.merchantId))
      .innerJoin(appUser, eq(appUser.id, account.customerUserId))
      .where(and(eq(account.status, 'active'), sql`${accountLimit.periodType} IS NOT NULL`));
    let queued = 0;
    for (const { account: acct, merchant: shop, customer } of rows) {
      if (acct.balanceSantim <= 0) continue;
      const time = evaluateLimits(await limitsInputFor(this.db, acct, 0, now)).time;
      if (!time.due_date || (time.state !== 'due_soon' && time.state !== 'due')) continue;
      const event = time.state === 'due_soon' ? 'due_soon' : 'due_today';
      const key = `${event}:${acct.id}:${time.due_date}`;
      if (await this.sent(key)) continue;
      const lang = customer.language;
      const balance = formatBirr(acct.balanceSantim, lang);
      await this.db.transaction(async (tx) => {
        await this.outbox.notify(tx, {
          userId: customer.id,
          phone: customer.phone,
          merchantId: shop.id,
          event,
          template: event === 'due_soon' ? 'sms.due_soon' : 'sms.due_today',
          params: {
            shop: shop.shopName,
            balance,
            date: displayDate(time.due_date!, lang, customer.calendarPref ?? 'ethiopian'),
          },
          language: lang,
          key,
        });
        if (event === 'due_today') {
          const [owner] = await tx.select().from(appUser).where(eq(appUser.id, shop.ownerUserId));
          if (owner) {
            await this.outbox.notify(tx, {
              userId: owner.id,
              phone: owner.phone,
              merchantId: shop.id,
              event,
              template: 'sms.due_today_shop',
              params: {
                customer: acct.nickname ?? customer.name ?? customer.phone,
                balance: formatBirr(acct.balanceSantim, owner.language),
              },
              language: owner.language,
              key: `${key}:shop`,
            });
          }
        }
      });
      queued++;
    }
    return queued;
  }

  private async unreviewedReports(): Promise<number> {
    const now = this.clock.now();
    const rows = await this.db
      .select({ report: paymentReport, account, merchant, customer: appUser })
      .from(paymentReport)
      .innerJoin(account, eq(account.id, paymentReport.accountId))
      .innerJoin(merchant, eq(merchant.id, account.merchantId))
      .innerJoin(appUser, eq(appUser.id, account.customerUserId))
      .where(
        and(
          eq(paymentReport.status, 'reported'),
          lte(paymentReport.createdAt, new Date(now.getTime() - REPORT_REMINDER_AFTER_MS)),
        ),
      );
    let queued = 0;
    for (const { report, account: acct, merchant: shop, customer } of rows) {
      const key = `payment_report_reminder:${report.id}`;
      if (await this.sent(key)) continue;
      await this.db.transaction(async (tx) => {
        const [owner] = await tx.select().from(appUser).where(eq(appUser.id, shop.ownerUserId));
        if (!owner) return;
        await this.outbox.notify(tx, {
          userId: owner.id,
          phone: owner.phone,
          merchantId: shop.id,
          event: 'payment_report_reminder',
          template: 'sms.payment_report_reminder',
          params: {
            customer: acct.nickname ?? customer.name ?? customer.phone,
            amount: formatBirr(report.amount, owner.language),
          },
          language: owner.language,
          key,
        });
      });
      queued++;
    }
    return queued;
  }

  private async sent(key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          sql`${notification.payload}->>'key' = ${key}`,
          inArray(notification.status, ['pending', 'sent', 'failed', 'cancelled']),
        ),
      )
      .limit(1);
    return !!row;
  }
}
