import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { account, merchant, merchantStaff } from '../db/schema.js';
import {
  type AccountAction,
  accountAllows,
  type AccountRole,
  type MerchantAction,
  merchantAllows,
  type MerchantRole,
} from './permissions.js';

export type AccountRow = typeof account.$inferSelect;
export type MerchantRow = typeof merchant.$inferSelect;

export interface AccountAccess {
  userId: string;
  role: AccountRole;
  account: AccountRow;
  merchant: MerchantRow;
}

export interface MerchantAccess {
  userId: string;
  role: MerchantRole;
  merchant: MerchantRow;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the caller's role on an account or shop from the data, then checks the permission
 * table (CLAUDE.md rule 7). No role → 404 (ids cannot be probed); role without the
 * permission → 403.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async requireAccount(
    userId: string,
    accountId: string,
    action: AccountAction,
  ): Promise<AccountAccess> {
    const access = UUID.test(accountId) ? await this.resolveAccount(userId, accountId) : null;
    if (!access) throw new AppError('not_found', 'Account not found', HttpStatus.NOT_FOUND);
    if (!accountAllows(access.role, action)) throw forbidden(action);
    return access;
  }

  async requireMerchant(
    userId: string,
    merchantId: string,
    action: MerchantAction,
  ): Promise<MerchantAccess> {
    const access = UUID.test(merchantId) ? await this.resolveMerchant(userId, merchantId) : null;
    if (!access) throw new AppError('not_found', 'Shop not found', HttpStatus.NOT_FOUND);
    if (!merchantAllows(access.role, action)) throw forbidden(action);
    return access;
  }

  async resolveAccount(userId: string, accountId: string): Promise<AccountAccess | null> {
    const [row] = await this.db
      .select({ account, merchant, staffRole: merchantStaff.role })
      .from(account)
      .innerJoin(merchant, eq(merchant.id, account.merchantId))
      .leftJoin(
        merchantStaff,
        and(eq(merchantStaff.merchantId, account.merchantId), eq(merchantStaff.userId, userId)),
      )
      .where(eq(account.id, accountId));
    if (!row) return null;
    // Shop roles win; a shop's own owner or staff cannot also be its customer (ADR-006).
    const role: AccountRole | null =
      row.staffRole ?? (row.account.customerUserId === userId ? 'customer' : null);
    return role ? { userId, role, account: row.account, merchant: row.merchant } : null;
  }

  async resolveMerchant(userId: string, merchantId: string): Promise<MerchantAccess | null> {
    const [row] = await this.db
      .select({ merchant, role: merchantStaff.role })
      .from(merchant)
      .innerJoin(
        merchantStaff,
        and(eq(merchantStaff.merchantId, merchant.id), eq(merchantStaff.userId, userId)),
      )
      .where(eq(merchant.id, merchantId));
    return row ? { userId, role: row.role, merchant: row.merchant } : null;
  }
}

function forbidden(action: string): AppError {
  return new AppError(
    'forbidden_for_role',
    'Your role on this account does not allow this action',
    HttpStatus.FORBIDDEN,
    { action },
  );
}
