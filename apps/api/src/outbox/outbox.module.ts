import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { OutboxDispatcher } from './outbox.dispatcher.js';
import { OutboxService } from './outbox.service.js';

/** Write-side helpers every module uses inside its transactions. */
@Global()
@Module({
  providers: [OutboxService, OutboxDispatcher, AuditService],
  exports: [OutboxService, OutboxDispatcher, AuditService],
})
export class OutboxModule {}
