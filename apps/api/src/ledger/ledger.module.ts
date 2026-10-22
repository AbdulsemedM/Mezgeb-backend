import { Module } from '@nestjs/common';
import { DisputesService } from './disputes.service.js';
import { EntriesService } from './entries.service.js';
import { LedgerController } from './ledger.controller.js';
import { LimitsService } from './limits.service.js';

/** Entries, chain, limits, disputes and the catalogue (M5, ADR-001, ADR-008). */
@Module({
  controllers: [LedgerController],
  providers: [EntriesService, LimitsService, DisputesService],
  exports: [EntriesService, LimitsService, DisputesService],
})
export class LedgerModule {}
