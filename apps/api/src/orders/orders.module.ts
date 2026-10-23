import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/** Delivery orders (M9, ADR-014). */
@Module({
  imports: [LedgerModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
