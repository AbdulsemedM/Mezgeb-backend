import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { AccountsService, type InviteView } from './accounts.service.js';

/** ADR-016: the PWA's invite screen, before sign-in. */
@Controller('invites')
export class InvitesController {
  constructor(private readonly accounts: AccountsService) {}

  @Public()
  @Get(':code')
  resolve(@Param('code') code: string): Promise<InviteView> {
    return this.accounts.resolveInvite(code);
  }
}
