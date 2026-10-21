import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  type AcceptAccount,
  acceptAccountSchema,
  type CreateAccount,
  createAccountSchema,
  type ListAccountsQuery,
  listAccountsQuerySchema,
  type UpdateAccount,
  updateAccountSchema,
} from '@mezgeb/shared';
import type { Response } from 'express';
import { AccountActionRequired, CurrentAccountAccess } from '../access/access.guards.js';
import type { AccountAccess } from '../access/access.service.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import type { AccountView } from './account.views.js';
import { AccountsService } from './accounts.service.js';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** 201 when created, 200 for an idempotent retry. Permission checked against body.merchant_id. */
  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccount,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountView> {
    const { created, view } = await this.accounts.create(auth.userId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(listAccountsQuerySchema)) q: ListAccountsQuery,
  ): Promise<{ accounts: AccountView[]; next_after: string | null }> {
    return this.accounts.list(auth.userId, q);
  }

  @Get(':id')
  @AccountActionRequired('view_account')
  get(@CurrentAccountAccess() a: AccountAccess): Promise<AccountView> {
    return this.accounts.get(a);
  }

  /** Field-level permissions are checked in the service. */
  @Patch(':id')
  @AccountActionRequired('view_account')
  update(
    @CurrentAccountAccess() a: AccountAccess,
    @Body(new ZodValidationPipe(updateAccountSchema)) body: UpdateAccount,
  ): Promise<AccountView> {
    return this.accounts.update(a, body);
  }

  @Post(':id/accept')
  @AccountActionRequired('accept_terms')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentAccountAccess() a: AccountAccess,
    @Body(new ZodValidationPipe(acceptAccountSchema)) body: AcceptAccount,
  ): Promise<AccountView> {
    return this.accounts.accept(a, body);
  }
}
