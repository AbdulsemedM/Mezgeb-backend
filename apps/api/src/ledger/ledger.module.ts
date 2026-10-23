import { Module } from '@nestjs/common';
import { CorrectionRequestsService } from './correction-requests.service.js';
import { DisputesService } from './disputes.service.js';
import { EntriesService } from './entries.service.js';
import { LedgerController } from './ledger.controller.js';
import { LimitsService } from './limits.service.js';
import { RaisesService } from './raises.service.js';
import { RemindersService } from './reminders.service.js';

/** Entries, chain, limits, disputes and the catalogue (M5, ADR-001, ADR-008). */
@Module({
  controllers: [LedgerController],
  providers: [
    EntriesService,
    LimitsService,
    DisputesService,
    RaisesService,
    CorrectionRequestsService,
    RemindersService,
  ],
  exports: [
    EntriesService,
    LimitsService,
    DisputesService,
    CorrectionRequestsService,
    RemindersService,
  ],
})
export class LedgerModule {}
