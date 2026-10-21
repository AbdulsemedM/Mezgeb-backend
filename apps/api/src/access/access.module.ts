import { Global, Module } from '@nestjs/common';
import { AccountActionGuard, MerchantActionGuard } from './access.guards.js';
import { AccessService } from './access.service.js';

@Global()
@Module({
  providers: [AccessService, AccountActionGuard, MerchantActionGuard],
  exports: [AccessService, AccountActionGuard, MerchantActionGuard],
})
export class AccessModule {}
