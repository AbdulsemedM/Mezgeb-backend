import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type ApproveRaise, formatBirr, type RequestRaise } from '@mezgeb/shared';
import { and, count, desc, eq, gt, max, min } from 'drizzle-orm';
import type { AccountAccess } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DB, type Db } from '../db/db.module.js';
import { accountLimit, appUser, limitRaise } from '../db/schema.js';
import { t } from '../i18n/messages.js';
import { idConflict } from '../merchants/merchants.service.js';
import { SmsGateway } from '../sms/sms-gateway.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type RaiseRow = typeof limitRaise.$inferSelect;

/** ADR-011 limits. */
export const RAISE_CODE_TTL_MS = 15 * 60_000;
export const RAISE_VALID_MS = 60 * 60_000;
export const RAISE_MAX_ATTEMPTS = 5;
export const RAISE_RESEND_AFTER_MS = 60_000;
export const RAISE_PER_ACCOUNT_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

export interface RaiseView {
  id: string;
  account_id: string;
  amount: number;
  status: RaiseRow['status'];
  expires_at: string;
  valid_until: string | null;
}

export function raiseView(r: RaiseRow): RaiseView {
  return {
    id: r.id,
    account_id: r.accountId,
    amount: r.amount,
    status: r.status,
    expires_at: r.expiresAt.toISOString(),
    valid_until: r.validUntil?.toISOString() ?? null,
  };
}

/**
 * One-time raises over the customer's hard stop (ADR-011, spec LIM-3). Online only: the shop
 * asks, the customer gets an SMS code and gives it to the shop, the shop types it. The approved
 * raise is then used by the next purchase on the account (`EntriesService.record`).
 */
@Injectable()
export class RaisesService {
  private readonly pepper: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly sms: SmsGateway,
  ) {
    this.pepper = config.OTP_PEPPER;
  }

  /**
   * Requests still waiting for an answer (not expired), newest first. The PWA shows them so the
   * customer can approve without a code (ADR-016).
   */
  async listPending(a: AccountAccess): Promise<{ raises: RaiseView[] }> {
    const rows = await this.db
      .select()
      .from(limitRaise)
      .where(
        and(
          eq(limitRaise.accountId, a.account.id),
          eq(limitRaise.status, 'pending'),
          gt(limitRaise.expiresAt, this.clock.now()),
        ),
      )
      .orderBy(desc(limitRaise.createdAt));
    return { raises: rows.map(raiseView) };
  }

  /** 201 when created and the SMS sent; 200 with the original for a retry (no new SMS). */
  async request(
    a: AccountAccess,
    userId: string,
    body: RequestRaise,
  ): Promise<{ created: boolean; view: RaiseView }> {
    const now = this.clock.now();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    const outcome = await this.db.transaction(async (tx) => {
      const [byId] = await tx.select().from(limitRaise).where(eq(limitRaise.id, body.id));
      if (byId) {
        if (byId.accountId !== a.account.id) throw idConflict();
        return { created: false as const, row: byId };
      }
      if (a.account.status !== 'active') {
        throw new AppError('account_not_active', 'This account is not active', HttpStatus.CONFLICT);
      }
      const [hardStop] = await tx
        .select()
        .from(accountLimit)
        .where(and(eq(accountLimit.accountId, a.account.id), eq(accountLimit.setBy, 'customer')));
      if (hardStop?.mode !== 'hard_stop' || hardStop.value === null) {
        throw new AppError(
          'no_hard_stop',
          'This customer has no hard-stop limit to raise',
          HttpStatus.CONFLICT,
        );
      }

      // One request at a time per account, so parallel taps cannot slip past the limits.
      const [locked] = await tx
        .select({
          n: count(),
          oldest: min(limitRaise.createdAt),
          latest: max(limitRaise.createdAt),
        })
        .from(limitRaise)
        .where(
          and(
            eq(limitRaise.accountId, a.account.id),
            gt(limitRaise.createdAt, new Date(now.getTime() - HOUR_MS)),
          ),
        );
      if (locked?.latest) {
        const since = now.getTime() - locked.latest.getTime();
        if (since < RAISE_RESEND_AFTER_MS) throw rateLimited(RAISE_RESEND_AFTER_MS - since);
        if (locked.n >= RAISE_PER_ACCOUNT_PER_HOUR && locked.oldest) {
          throw rateLimited(locked.oldest.getTime() + HOUR_MS - now.getTime());
        }
      }

      // A new request replaces any earlier one still waiting for its code.
      await tx
        .update(limitRaise)
        .set({ status: 'expired', updatedAt: now })
        .where(and(eq(limitRaise.accountId, a.account.id), eq(limitRaise.status, 'pending')));
      const [row] = await tx
        .insert(limitRaise)
        .values({
          id: body.id,
          accountId: a.account.id,
          amount: body.amount,
          codeHash: this.hash(body.id, code),
          expiresAt: new Date(now.getTime() + RAISE_CODE_TTL_MS),
          createdAt: now,
          createdBy: userId,
          updatedAt: now,
        })
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'limit_raise.request',
        objectType: 'limit_raise',
        objectId: body.id,
        after: { account_id: a.account.id, amount: body.amount },
      });
      const [customer] = await tx
        .select()
        .from(appUser)
        .where(eq(appUser.id, a.account.customerUserId));
      return { created: true as const, row: row!, customer: customer! };
    });

    if (outcome.created) {
      // Sent directly like the sign-in code: the code is never stored in plain text.
      const { customer } = outcome;
      await this.sms.send({
        to: customer.phone,
        text: t('sms.raise_code', customer.language, {
          shop: a.merchant.shopName,
          amount: formatBirr(body.amount, customer.language),
          code,
          minutes: RAISE_CODE_TTL_MS / 60_000,
        }),
      });
    }
    return { created: outcome.created, view: raiseView(outcome.row) };
  }

  /**
   * The shop approves with the customer's code; the customer's own app approves without one.
   * A wrong code is counted even though the request fails, so the attempt is committed first.
   */
  async approve(
    a: AccountAccess,
    userId: string,
    raiseId: string,
    body: ApproveRaise,
  ): Promise<RaiseView> {
    const now = this.clock.now();
    const outcome = await this.db.transaction(async (tx) => {
      const row = await this.lockRaise(tx, a, raiseId);
      if (row.status === 'approved' || row.status === 'used') return { view: raiseView(row) };
      if (row.status === 'expired' || now >= row.expiresAt) {
        if (row.status === 'pending') await this.expire(tx, row, now);
        return { error: raiseError('raise_expired', 'This request expired; ask again') };
      }
      if (a.role !== 'customer') {
        if (!body.code) {
          throw new AppError('code_required', 'Type the code from the SMS', HttpStatus.BAD_REQUEST);
        }
        if (!this.matches(row.codeHash, row.id, body.code)) {
          const attempts = row.failedAttempts + 1;
          const locked = attempts >= RAISE_MAX_ATTEMPTS;
          await tx
            .update(limitRaise)
            .set({
              failedAttempts: attempts,
              status: locked ? 'expired' : 'pending',
              updatedAt: now,
            })
            .where(eq(limitRaise.id, row.id));
          return locked
            ? { error: raiseError('raise_code_locked', 'Too many wrong codes; ask again') }
            : {
                error: raiseError('raise_code_invalid', 'The code is not right', {
                  attempts_left: RAISE_MAX_ATTEMPTS - attempts,
                }),
              };
        }
      }
      const [approved] = await tx
        .update(limitRaise)
        .set({
          status: 'approved',
          approvedAt: now,
          approvedVia: a.role === 'customer' ? 'app' : 'code',
          validUntil: new Date(now.getTime() + RAISE_VALID_MS),
          updatedAt: now,
        })
        .where(eq(limitRaise.id, row.id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'limit_raise.approve',
        objectType: 'limit_raise',
        objectId: row.id,
        after: { via: approved!.approvedVia },
      });
      return { view: raiseView(approved!) };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.view;
  }

  private async lockRaise(tx: Tx, a: AccountAccess, raiseId: string): Promise<RaiseRow> {
    const [row] = await tx
      .select()
      .from(limitRaise)
      .where(and(eq(limitRaise.id, raiseId), eq(limitRaise.accountId, a.account.id)))
      .for('update');
    if (!row) throw new AppError('not_found', 'Raise request not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async expire(tx: Tx, row: RaiseRow, now: Date): Promise<void> {
    await tx
      .update(limitRaise)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(limitRaise.id, row.id));
  }

  private hash(raiseId: string, code: string): string {
    return createHmac('sha256', this.pepper).update(`raise:${raiseId}:${code}`).digest('hex');
  }

  private matches(storedHex: string, raiseId: string, code: string): boolean {
    return timingSafeEqual(
      Buffer.from(storedHex, 'hex'),
      Buffer.from(this.hash(raiseId, code), 'hex'),
    );
  }
}

/**
 * The approved, unused raise a purchase recorded now may use, locked for the entry's
 * transaction. Newest first.
 */
export async function usableRaise(tx: Tx, accountId: string, now: Date): Promise<RaiseRow | null> {
  const [row] = await tx
    .select()
    .from(limitRaise)
    .where(
      and(
        eq(limitRaise.accountId, accountId),
        eq(limitRaise.status, 'approved'),
        gt(limitRaise.validUntil, now),
      ),
    )
    .orderBy(desc(limitRaise.approvedAt))
    .limit(1)
    .for('update');
  return row ?? null;
}

function rateLimited(retryAfterMs: number): AppError {
  return new AppError(
    'raise_rate_limited',
    'Too many raise requests for this customer; try again later',
    HttpStatus.TOO_MANY_REQUESTS,
    { retry_after_s: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
  );
}

function raiseError(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, message, HttpStatus.CONFLICT, details);
}
