import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { uuidv7 } from '@mezgeb/shared';
import { and, asc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DB, type Db } from '../db/db.module.js';
import { device, notification } from '../db/schema.js';
import { t } from '../i18n/messages.js';
import { PushSender } from '../push/push-sender.js';
import { SmsGateway } from '../sms/sms-gateway.js';
import { NOTIFICATION_RULES, type NotificationRule } from './notification-rules.js';
import type { SmsPayload } from './outbox.service.js';

export const OUTBOX_MAX_ATTEMPTS = 5;
const BATCH = 50;
const RETRY_BACKOFF_MS = 30_000;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Row = typeof notification.$inferSelect;

/**
 * Sends due notifications (ADR-006, ADR-015): SMS through the gateway, pushes to every device of
 * the person that gave a token. A push that cannot go (no live token, provider failure) falls
 * back to an SMS when its event allows it. Rows are locked with SKIP LOCKED, so several API
 * instances never send the same row. Delivery is at-least-once.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly sms: SmsGateway,
    private readonly push: PushSender,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.OUTBOX_POLL_MS > 0) {
      this.timer = setInterval(() => void this.tick(), this.config.OUTBOX_POLL_MS);
    }
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error(`Outbox run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Sends one batch of due notifications. Returns the number sent. */
  async runOnce(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const now = this.clock.now();
      const due = await tx
        .select()
        .from(notification)
        .where(and(eq(notification.status, 'pending'), lte(notification.scheduledFor, now)))
        .orderBy(asc(notification.scheduledFor))
        .limit(BATCH)
        .for('update', { skipLocked: true });

      let sent = 0;
      for (const row of due) {
        try {
          if (row.channel === 'sms') await this.sendSms(row);
          else await this.sendPush(tx, row);
          await tx
            .update(notification)
            .set({ status: 'sent', sentAt: now, attempts: row.attempts + 1 })
            .where(eq(notification.id, row.id));
          sent++;
        } catch (err) {
          await this.failed(tx, row, now, err as Error);
        }
      }
      return sent;
    });
  }

  private async sendSms(row: Row): Promise<void> {
    const payload = row.payload as SmsPayload;
    if (!row.phone) throw new Error('SMS notification without a phone number');
    await this.sms.send({
      to: row.phone,
      text: t(payload.template, payload.language, payload.params),
    });
  }

  private async sendPush(tx: Tx, row: Row): Promise<void> {
    const payload = row.payload as SmsPayload;
    const tokens = row.userId
      ? (
          await tx
            .select({ id: device.id, token: device.pushToken })
            .from(device)
            .where(
              and(
                eq(device.userId, row.userId),
                isNotNull(device.pushToken),
                isNull(device.revokedAt),
              ),
            )
        ).filter(
          (d): d is { id: string; token: string } => d.token !== null && this.push.accepts(d.token),
        )
      : [];
    if (!this.push.enabled || tokens.length === 0) {
      throw new PushUnavailable('no live push token');
    }
    const rule = (NOTIFICATION_RULES as Record<string, NotificationRule>)[row.event];
    const body = t(payload.template, payload.language, payload.params);
    const { invalidTokens } = await this.push.send({
      tokens: tokens.map((d) => d.token),
      title: 'Nota',
      body,
      sound: rule?.sound ?? false,
      data: {
        event: row.event,
        ...(payload.head && {
          account_id: payload.head.accountId,
          seq: String(payload.head.seq),
          hash: payload.head.hash,
        }),
      },
    });
    if (invalidTokens.length > 0) {
      await tx
        .update(device)
        .set({ pushToken: null })
        .where(inArray(device.pushToken, invalidTokens));
    }
    if (invalidTokens.length === tokens.length) {
      throw new PushUnavailable('every push token was invalid');
    }
  }

  private async failed(tx: Tx, row: Row, now: Date, err: Error): Promise<void> {
    const payload = row.payload as SmsPayload;
    // A push that cannot go is not retried: it becomes an SMS when the event allows it.
    if (row.channel === 'push' && err instanceof PushUnavailable) {
      await tx.update(notification).set({ status: 'failed' }).where(eq(notification.id, row.id));
      if (payload.fallbackSms) {
        await tx.insert(notification).values({
          id: uuidv7(now.getTime()),
          userId: row.userId,
          phone: row.phone,
          merchantId: row.merchantId,
          event: row.event,
          payload: { ...payload, fallbackSms: undefined },
          channel: 'sms',
          scheduledFor: now,
          createdAt: now,
        });
      }
      return;
    }
    const attempts = row.attempts + 1;
    this.logger.warn(`${row.channel} ${row.id} attempt ${attempts} failed: ${err.message}`);
    await tx
      .update(notification)
      .set(
        attempts >= OUTBOX_MAX_ATTEMPTS
          ? { status: 'failed', attempts }
          : { attempts, scheduledFor: new Date(now.getTime() + attempts * RETRY_BACKOFF_MS) },
      )
      .where(eq(notification.id, row.id));
  }
}

class PushUnavailable extends Error {}
