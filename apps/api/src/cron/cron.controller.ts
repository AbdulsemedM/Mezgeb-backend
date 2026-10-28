import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, HttpStatus, Inject } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { AppError } from '../common/app-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { RemindersService } from '../ledger/reminders.service.js';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher.js';

/** Batches per run, so one call stays well inside the function time limit. */
const MAX_OUTBOX_RUNS = 20;

/**
 * ADR-017: on serverless hosts the in-process timers do not run, so Vercel Cron calls this once
 * a day with `Authorization: Bearer <CRON_SECRET>`. Mounted only when CRON_SECRET is set.
 */
@Public()
@Controller('cron')
export class CronController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reminders: RemindersService,
    private readonly outbox: OutboxDispatcher,
  ) {}

  /** Queues due reminders, then sends what the outbox holds (deferred and retried notices). */
  @Get('daily')
  async daily(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<{ reminders: number; sent: number }> {
    if (!this.authorized(authorization)) {
      throw new AppError('unauthorized', 'Missing or invalid cron secret', HttpStatus.UNAUTHORIZED);
    }
    const reminders = await this.reminders.runOnce();
    let sent = 0;
    for (let i = 0; i < MAX_OUTBOX_RUNS; i++) {
      const n = await this.outbox.runOnce();
      sent += n;
      if (n === 0) break;
    }
    return { reminders, sent };
  }

  private authorized(header: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.config.CRON_SECRET ?? ''}`);
    const given = Buffer.from(header ?? '');
    return (
      this.config.CRON_SECRET !== undefined &&
      given.length === expected.length &&
      timingSafeEqual(given, expected)
    );
  }
}
