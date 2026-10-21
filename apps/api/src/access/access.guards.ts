import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from '../auth/auth.decorators.js';
import { type AccountAccess, AccessService, type MerchantAccess } from './access.service.js';
import type { AccountAction, MerchantAction } from './permissions.js';

const ACCOUNT_ACTION = 'mezgeb:accountAction';
const MERCHANT_ACTION = 'mezgeb:merchantAction';

interface AccessRequest extends AuthedRequest {
  accountAccess?: AccountAccess;
  merchantAccess?: MerchantAccess;
}

/** Route on `/…/:id` where `:id` is an account: requires `action` for the caller's role. */
@Injectable()
export class AccountActionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<AccountAction>(ACCOUNT_ACTION, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<AccessRequest>();
    req.accountAccess = await this.access.requireAccount(
      req.auth!.userId,
      String(req.params.id),
      action,
    );
    return true;
  }
}

/** Route on `/merchants/:id`: requires `action` for the caller's role in that shop. */
@Injectable()
export class MerchantActionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<MerchantAction>(MERCHANT_ACTION, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<AccessRequest>();
    req.merchantAccess = await this.access.requireMerchant(
      req.auth!.userId,
      String(req.params.id),
      action,
    );
    return true;
  }
}

export const AccountActionRequired = (action: AccountAction) =>
  applyDecorators(SetMetadata(ACCOUNT_ACTION, action), UseGuards(AccountActionGuard));

export const MerchantActionRequired = (action: MerchantAction) =>
  applyDecorators(SetMetadata(MERCHANT_ACTION, action), UseGuards(MerchantActionGuard));

export const CurrentAccountAccess = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): AccountAccess =>
    ctx.switchToHttp().getRequest<AccessRequest>().accountAccess!,
);

export const CurrentMerchantAccess = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): MerchantAccess =>
    ctx.switchToHttp().getRequest<AccessRequest>().merchantAccess!,
);
