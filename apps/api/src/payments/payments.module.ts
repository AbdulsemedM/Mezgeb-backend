import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/** Payments and pay-me (M8, ADR-013). */
@Module({
  imports: [LedgerModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
