import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { InvitesController } from './invites.controller.js';

@Module({
  controllers: [AccountsController, InvitesController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
