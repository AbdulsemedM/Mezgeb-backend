import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { CronController } from './cron.controller.js';

/** Mounted by AppModule only when CRON_SECRET is set (ADR-017). */
@Module({ imports: [LedgerModule, OutboxModule], controllers: [CronController] })
export class CronModule {}
