import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { RepresentativesModule } from '../representatives/representatives.module.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

/** POST /v1/sync (M7, ADR-010). */
@Module({
  imports: [OrdersModule, AccountsModule, LedgerModule, RepresentativesModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
