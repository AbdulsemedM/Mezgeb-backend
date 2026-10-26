import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  type AcceptAccount,
  type CreateAccount,
  type Language,
  type ListAccountsQuery,
  makeInviteCode,
  normalizeEthiopianPhone,
  normalizeInviteCode,
  type UpdateAccount,
} from '@mezgeb/shared';
import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import { type AccountAccess, AccessService } from '../access/access.service.js';
import { type AccountAction, accountAllows } from '../access/permissions.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DB, type Db } from '../db/db.module.js';
import { account, accountInvite, appUser, merchant, merchantStaff } from '../db/schema.js';
import {
  assertCurrentTerms,
  findOrCreateUser,
  idConflict,
  invalidPhone,
} from '../merchants/merchants.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { type AccountView, accountView } from './account.views.js';

/** Which permission each PATCH field needs (ADR-006). */
/** ADR-016: an invite link works for 14 days; the pending account itself does not expire. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60_000;

/** What `GET /v1/invites/:code` shows before sign-in (ADR-016). No phone, no balance. */
export interface InviteView {
  code: string;
  account_id: string;
  shop: { name: string };
  /** The SMS language the shop chose, to preselect the language screen. */
  language: Language;
  /** `open` until accepted; `expired` after 14 days; `accepted` / `closed` from the account. */
  state: 'open' | 'expired' | 'accepted' | 'closed';
  expires_at: string;
}

const FIELD_ACTIONS: Record<keyof UpdateAccount, AccountAction> = {
  nickname: 'set_nickname',
  location_note: 'set_nickname',
  detail_mode: 'set_customer_detail_mode',
  customer_detail_view: 'set_view_preference',
};

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * US-01: invite a customer by phone. Idempotent on `id`. The account starts `pending` and the
   * invite SMS is queued in the same transaction.
   */
  async create(
    userId: string,
    body: CreateAccount,
  ): Promise<{ created: boolean; view: AccountView }> {
    const shop = await this.access.requireMerchant(userId, body.merchant_id, 'create_account');
    const phone = normalizeEthiopianPhone(body.phone);
    if (!phone) throw invalidPhone();
    const now = this.clock.now();

    return this.db.transaction(async (tx) => {
      const [byId] = await tx.select().from(account).where(eq(account.id, body.id));
      if (byId) return this.idempotentReturn(tx, byId, body.merchant_id, shop.role);

      const customer = await findOrCreateUser(tx, phone, body.language ?? 'am', now);
      const [isShopMember] = await tx
        .select({ role: merchantStaff.role })
        .from(merchantStaff)
        .where(
          and(
            eq(merchantStaff.merchantId, body.merchant_id),
            eq(merchantStaff.userId, customer.id),
          ),
        );
      if (isShopMember) {
        throw new AppError(
          'invalid_customer',
          "A shop's own owner or staff cannot be its customer",
          HttpStatus.BAD_REQUEST,
        );
      }

      const [inserted] = await tx
        .insert(account)
        .values({
          id: body.id,
          merchantId: body.merchant_id,
          customerUserId: customer.id,
          nickname: body.nickname ?? null,
          locationNote: body.location_note ?? null,
          createdAt: now,
          createdBy: userId,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        // Lost a race on the same id, or this customer already has an account here.
        const [sameId] = await tx.select().from(account).where(eq(account.id, body.id));
        if (sameId) return this.idempotentReturn(tx, sameId, body.merchant_id, shop.role);
        const [existing] = await tx
          .select({ id: account.id })
          .from(account)
          .where(
            and(eq(account.merchantId, body.merchant_id), eq(account.customerUserId, customer.id)),
          );
        throw new AppError(
          'account_exists',
          'This customer already has an account at this shop',
          HttpStatus.CONFLICT,
          { account_id: existing?.id },
        );
      }

      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'account.create',
        objectType: 'account',
        objectId: inserted.id,
        after: { merchant_id: inserted.merchantId, customer_user_id: customer.id },
      });
      const code = await this.createInviteCode(tx, inserted.id, now);
      await this.outbox.notify(tx, {
        merchantId: body.merchant_id,
        userId: customer.id,
        phone: customer.phone,
        event: 'customer_invited',
        template: 'sms.invite',
        params: { shop: shop.merchant.shopName, link: this.inviteLink(code) },
        language: customer.language,
      });
      return { created: true, view: accountView(shop.role, inserted, shop.merchant, customer) };
    });
  }

  /** US-02: the customer accepts the agreement; the account becomes active for both sides. */
  async accept(a: AccountAccess, body: AcceptAccount): Promise<AccountView> {
    assertCurrentTerms(body.terms_version);
    if (a.account.status === 'closed') {
      throw new AppError('account_closed', 'This account is closed', HttpStatus.CONFLICT);
    }
    let row = a.account;
    if (row.status === 'pending') {
      const now = this.clock.now();
      row = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(account)
          .set({
            status: 'active',
            termsAcceptedAt: now,
            termsVersion: body.terms_version,
            updatedAt: now,
          })
          .where(and(eq(account.id, a.account.id), eq(account.status, 'pending')))
          .returning();
        // A concurrent accept may have won; either way the account is active now.
        if (!updated)
          return (await tx.select().from(account).where(eq(account.id, a.account.id)))[0]!;
        await this.audit.record(tx, {
          actorUserId: a.userId,
          action: 'account.accept',
          objectType: 'account',
          objectId: a.account.id,
          before: { status: 'pending' },
          after: { status: 'active', terms_version: body.terms_version },
        });
        return updated;
      });
    }
    return this.view({ ...a, account: row });
  }

  async get(a: AccountAccess): Promise<AccountView> {
    return this.view(a);
  }

  /** Each field needs its own permission; one forbidden field rejects the whole request. */
  async update(a: AccountAccess, body: UpdateAccount): Promise<AccountView> {
    for (const field of Object.keys(body) as (keyof UpdateAccount)[]) {
      const action = FIELD_ACTIONS[field];
      if (!accountAllows(a.role, action)) {
        throw new AppError(
          'forbidden_for_role',
          'Your role on this account does not allow this action',
          HttpStatus.FORBIDDEN,
          { action, field },
        );
      }
    }
    const now = this.clock.now();
    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(account)
        .set({
          ...(body.nickname !== undefined && { nickname: body.nickname }),
          ...(body.location_note !== undefined && { locationNote: body.location_note }),
          ...(body.detail_mode !== undefined && { detailMode: body.detail_mode }),
          ...(body.customer_detail_view !== undefined && {
            customerDetailView: body.customer_detail_view,
          }),
          updatedAt: now,
        })
        .where(eq(account.id, a.account.id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: a.userId,
        action: 'account.update',
        objectType: 'account',
        objectId: a.account.id,
        before: {
          nickname: a.account.nickname,
          location_note: a.account.locationNote,
          detail_mode: a.account.detailMode,
          customer_detail_view: a.account.customerDetailView,
        },
        after: body,
      });
      return updated!;
    });
    return this.view({ ...a, account: row });
  }

  /**
   * `role=merchant`: accounts of every shop where the caller is owner or staff.
   * `role=customer`: the caller's own accounts, one per shop. Keyset pagination by id.
   */
  async list(
    userId: string,
    q: ListAccountsQuery,
  ): Promise<{ accounts: AccountView[]; next_after: string | null }> {
    const after: SQL | undefined = q.after ? gt(account.id, q.after) : undefined;
    let views: AccountView[];
    if (q.role === 'merchant') {
      const rows = await this.db
        .select({ account, merchant, customer: appUser, role: merchantStaff.role })
        .from(account)
        .innerJoin(
          merchantStaff,
          and(eq(merchantStaff.merchantId, account.merchantId), eq(merchantStaff.userId, userId)),
        )
        .innerJoin(merchant, eq(merchant.id, account.merchantId))
        .innerJoin(appUser, eq(appUser.id, account.customerUserId))
        .where(after)
        .orderBy(asc(account.id))
        .limit(q.limit + 1);
      views = rows.map((r) => accountView(r.role, r.account, r.merchant, r.customer));
    } else {
      const rows = await this.db
        .select({ account, merchant, customer: appUser })
        .from(account)
        .innerJoin(merchant, eq(merchant.id, account.merchantId))
        .innerJoin(appUser, eq(appUser.id, account.customerUserId))
        .where(and(eq(account.customerUserId, userId), after))
        .orderBy(asc(account.id))
        .limit(q.limit + 1);
      views = rows.map((r) => accountView('customer', r.account, r.merchant, r.customer));
    }
    const page = views.slice(0, q.limit);
    return { accounts: page, next_after: views.length > q.limit ? page.at(-1)!.id : null };
  }

  private async view(a: AccountAccess): Promise<AccountView> {
    const [customer] = await this.db
      .select()
      .from(appUser)
      .where(eq(appUser.id, a.account.customerUserId));
    return accountView(a.role, a.account, a.merchant, customer!);
  }

  private async idempotentReturn(
    tx: Pick<Db, 'select'>,
    row: typeof account.$inferSelect,
    merchantId: string,
    role: 'owner' | 'staff',
  ): Promise<{ created: boolean; view: AccountView }> {
    if (row.merchantId !== merchantId) throw idConflict();
    const [m] = await tx.select().from(merchant).where(eq(merchant.id, row.merchantId));
    const [c] = await tx.select().from(appUser).where(eq(appUser.id, row.customerUserId));
    return { created: false, view: accountView(role, row, m!, c!) };
  }

  /** ADR-016: public, before sign-in. Unknown or malformed codes are 404 `invite_not_found`. */
  async resolveInvite(rawCode: string): Promise<InviteView> {
    const code = normalizeInviteCode(rawCode);
    const [row] = code
      ? await this.db
          .select({ invite: accountInvite, account, merchant, customer: appUser })
          .from(accountInvite)
          .innerJoin(account, eq(account.id, accountInvite.accountId))
          .innerJoin(merchant, eq(merchant.id, account.merchantId))
          .innerJoin(appUser, eq(appUser.id, account.customerUserId))
          .where(eq(accountInvite.code, code))
      : [];
    if (!row) {
      throw new AppError('invite_not_found', 'This invite link is not valid', HttpStatus.NOT_FOUND);
    }
    const state =
      row.account.status === 'closed'
        ? 'closed'
        : row.account.status !== 'pending'
          ? 'accepted'
          : this.clock.now() >= row.invite.expiresAt
            ? 'expired'
            : 'open';
    return {
      code: row.invite.code,
      account_id: row.account.id,
      shop: { name: row.merchant.shopName },
      language: row.customer.language,
      state,
      expires_at: row.invite.expiresAt.toISOString(),
    };
  }

  /** A fresh code for the account; retries on the (very unlikely) collision. */
  private async createInviteCode(
    tx: Pick<Db, 'insert'>,
    accountId: string,
    now: Date,
  ): Promise<string> {
    for (;;) {
      const code = makeInviteCode((n) => randomBytes(n));
      const [row] = await tx
        .insert(accountInvite)
        .values({
          code,
          accountId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        })
        .onConflictDoNothing()
        .returning({ code: accountInvite.code });
      if (row) return row.code;
    }
  }

  private inviteLink(code: string): string {
    return `${this.config.PUBLIC_WEB_URL.replace(/\/$/, '')}/i/${code}`;
  }
}
