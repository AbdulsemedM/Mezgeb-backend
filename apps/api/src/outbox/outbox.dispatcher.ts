import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DB, type Db } from '../db/db.module.js';
import { notification } from '../db/schema.js';
import { t } from '../i18n/messages.js';
import { SmsGateway } from '../sms/sms-gateway.js';
import type { SmsPayload } from './outbox.service.js';

export const OUTBOX_MAX_ATTEMPTS = 5;
const BATCH = 50;
const RETRY_BACKOFF_MS = 30_000;

/**
 * Minimal outbox processor until M10 (ADR-006): sends pending SMS rows. Rows are locked with
 * SKIP LOCKED, so several API instances never send the same row. Delivery is at-least-once.
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

  /** Sends one batch of due SMS. Returns the number of rows sent. */
  async runOnce(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const now = this.clock.now();
      const due = await tx
        .select()
        .from(notification)
        .where(
          and(
            eq(notification.status, 'pending'),
            eq(notification.channel, 'sms'),
            lte(notification.scheduledFor, now),
          ),
        )
        .orderBy(asc(notification.scheduledFor))
        .limit(BATCH)
        .for('update', { skipLocked: true });

      let sent = 0;
      for (const row of due) {
        const payload = row.payload as SmsPayload;
        try {
          if (!row.phone) throw new Error('SMS notification without a phone number');
          await this.sms.send({
            to: row.phone,
            text: t(payload.template, payload.language, payload.params),
          });
          await tx
            .update(notification)
            .set({ status: 'sent', sentAt: now, attempts: row.attempts + 1 })
            .where(eq(notification.id, row.id));
          sent++;
        } catch (err) {
          const attempts = row.attempts + 1;
          this.logger.warn(`SMS ${row.id} attempt ${attempts} failed: ${(err as Error).message}`);
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
      return sent;
    });
  }
}
