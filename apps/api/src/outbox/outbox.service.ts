import { Inject, Injectable } from '@nestjs/common';
import { type Language, uuidv7 } from '@mezgeb/shared';
import { and, count, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import type { Db } from '../db/db.module.js';
import { device, merchant, notification } from '../db/schema.js';
import type { MessageKey } from '../i18n/messages.js';
import { PushSender } from '../push/push-sender.js';
import {
  afterQuietHours,
  NOTIFICATION_RULES,
  type NotificationEvent,
  type NotificationRule,
  startOfAddisMonth,
} from './notification-rules.js';

export interface Notice {
  /** App user, or null for a representative reached by SMS only. */
  userId: string | null;
  phone: string;
  /** A row of the notifications matrix (`NOTIFICATION_RULES`). */
  event: NotificationEvent;
  template: MessageKey;
  params: Record<string, string | number>;
  language: Language;
  /** The shop it is about: its plan caps SMS. */
  merchantId?: string;
  /** Carried in push payloads: the account and its head (ADR-001 receipts). */
  head?: { accountId: string; seq: number; hash: string };
  /** Scheduled reminders: the same key is never sent twice. */
  key?: string;
}

/** Payload stored on an outbox row; rendered by the dispatcher at send time. */
export interface SmsPayload {
  template: MessageKey;
  params: Record<string, string | number>;
  language: Language;
  head?: Notice['head'];
  /** Push rows: whether to fall back to SMS when the push cannot go. */
  fallbackSms?: boolean;
  /** Why an SMS was not sent (e.g. the monthly cap). */
  cancelledReason?: string;
  key?: string;
}

type Tx = Pick<Db, 'insert' | 'select'>;

/**
 * Writes notifications in the caller's transaction, so they exist iff the change committed
 * (ADR-006). Routing per the notifications matrix (ADR-015): push when the person has the app
 * with a push token and push is configured, SMS otherwise or as well; non-urgent notices wait
 * for the end of quiet hours; SMS beyond the shop's monthly cap are recorded but not sent.
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly push: PushSender,
  ) {}

  async notify(tx: Tx, n: Notice): Promise<void> {
    const rule: NotificationRule = NOTIFICATION_RULES[n.event];
    const now = this.clock.now();
    const when = rule.urgent ? now : afterQuietHours(now);
    const payload: SmsPayload = {
      template: n.template,
      params: n.params,
      language: n.language,
      ...(n.head && { head: n.head }),
      ...(n.key && { key: n.key }),
    };

    const canPush =
      rule.channel !== 'sms' &&
      this.push.enabled &&
      n.userId !== null &&
      (await this.hasToken(tx, n.userId));
    if (canPush) {
      await this.insert(tx, n, 'push', when, { ...payload, fallbackSms: rule.channel === 'push' });
    }
    if (rule.channel !== 'push' || !canPush) await this.sms(tx, n, rule, when, payload);
  }

  /** An SMS row, or a cancelled one when the shop used its SMS for the month. */
  async sms(
    tx: Tx,
    n: Notice,
    rule: NotificationRule,
    when: Date,
    payload: SmsPayload,
  ): Promise<void> {
    const capped = !rule.uncapped && !!n.merchantId && (await this.overCap(tx, n.merchantId));
    await this.insert(
      tx,
      n,
      'sms',
      when,
      capped ? { ...payload, cancelledReason: 'sms_cap' } : payload,
      capped ? 'cancelled' : 'pending',
    );
  }

  private async insert(
    tx: Tx,
    n: Notice,
    channel: 'push' | 'sms',
    when: Date,
    payload: SmsPayload,
    status: 'pending' | 'cancelled' = 'pending',
  ): Promise<void> {
    const now = this.clock.now();
    await tx.insert(notification).values({
      id: uuidv7(now.getTime()),
      userId: n.userId,
      phone: n.phone,
      merchantId: n.merchantId ?? null,
      event: n.event,
      payload,
      channel,
      status,
      scheduledFor: when,
      createdAt: now,
    });
  }

  private async hasToken(tx: Tx, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ n: count() })
      .from(device)
      .where(and(eq(device.userId, userId), isNotNull(device.pushToken), isNull(device.revokedAt)));
    return (row?.n ?? 0) > 0;
  }

  private async overCap(tx: Tx, merchantId: string): Promise<boolean> {
    const [shop] = await tx
      .select({ plan: merchant.plan })
      .from(merchant)
      .where(eq(merchant.id, merchantId));
    if (!shop) return false;
    const cap = {
      free: this.config.SMS_CAP_FREE,
      shop: this.config.SMS_CAP_SHOP,
      shop_plus: this.config.SMS_CAP_SHOP_PLUS,
    }[shop.plan];
    const [used] = await tx
      .select({ n: count() })
      .from(notification)
      .where(
        and(
          eq(notification.merchantId, merchantId),
          eq(notification.channel, 'sms'),
          inArray(notification.status, ['pending', 'sent']),
          gte(notification.createdAt, startOfAddisMonth(this.clock.now())),
        ),
      );
    return (used?.n ?? 0) >= cap;
  }
}
