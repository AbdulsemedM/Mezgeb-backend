import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  evaluateLimits,
  type LimitSide,
  type LimitsInput,
  type LimitsResult,
  ledgerState,
  type SetLimit,
  type SideLimit,
} from '@mezgeb/shared';
import { and, asc, eq } from 'drizzle-orm';
import { type AccountAccess, forbidden } from '../access/access.service.js';
import { accountAllows } from '../access/permissions.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { type account, accountLimit, appUser, entry } from '../db/schema.js';

type LimitRow = typeof accountLimit.$inferSelect;
type Reader = Pick<Db, 'select'>;

export interface LimitView {
  value: number | null;
  period: {
    type: NonNullable<LimitRow['periodType']>;
    days: number | null;
    calendar: LimitRow['calendar'];
  } | null;
  mode: LimitRow['mode'];
  updated_at: string;
}

export interface LimitsView {
  merchant: LimitView | null;
  customer: LimitView | null;
  /** The engine on the current balance (no new purchase): effective limit, usage, due date. */
  state: LimitsResult;
}

function limitView(row: LimitRow): LimitView {
  return {
    value: row.value,
    period: row.periodType
      ? { type: row.periodType, days: row.periodDays, calendar: row.calendar }
      : null,
    mode: row.mode,
    updated_at: row.updatedAt.toISOString(),
  };
}

function sideLimit(row: LimitRow | undefined): SideLimit | null {
  if (!row) return null;
  return {
    value: row.value,
    period: row.periodType
      ? { type: row.periodType, days: row.periodDays, calendar: row.calendar }
      : null,
    mode: row.mode,
  };
}

/**
 * The engine's inputs for `acct` from the database: both sides' limits, the open balance and
 * the open period (ADR-007, from the ledger in seq order). Representative limits arrive in M6.
 */
export async function limitsInputFor(
  db: Reader,
  acct: typeof account.$inferSelect,
  amount: number,
  now: Date,
): Promise<LimitsInput> {
  const rows = await db.select().from(accountLimit).where(eq(accountLimit.accountId, acct.id));
  const ledger = await db
    .select({
      seq: entry.seq,
      type: entry.type,
      amount: entry.amount,
      recordedAt: entry.recordedAt,
    })
    .from(entry)
    .where(eq(entry.accountId, acct.id))
    .orderBy(asc(entry.seq));
  const { periodStart } = ledgerState(
    ledger.map((e) => ({ ...e, recorded_at: e.recordedAt.toISOString() })),
  );
  return {
    merchant: sideLimit(rows.find((r) => r.setBy === 'merchant')),
    customer: sideLimit(rows.find((r) => r.setBy === 'customer')),
    representative: null,
    openBalance: acct.balanceSantim,
    periodStart,
    amount,
    now,
  };
}

/** LIM-1: each side sets its own limit (ADR-008). */
@Injectable()
export class LimitsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async get(a: AccountAccess): Promise<LimitsView> {
    const rows = await this.db
      .select()
      .from(accountLimit)
      .where(eq(accountLimit.accountId, a.account.id));
    const find = (side: LimitSide) => rows.find((r) => r.setBy === side);
    return {
      merchant: find('merchant') ? limitView(find('merchant')!) : null,
      customer: find('customer') ? limitView(find('customer')!) : null,
      state: evaluateLimits(await limitsInputFor(this.db, a.account, 0, this.clock.now())),
    };
  }

  async set(a: AccountAccess, side: LimitSide, body: SetLimit): Promise<LimitView> {
    this.requireSide(a, side);
    if (body.mode === 'hard_stop' && side !== 'customer') {
      throw new AppError(
        'invalid_limit',
        'Only the customer can make their own limit a hard stop',
        HttpStatus.BAD_REQUEST,
      );
    }
    const now = this.clock.now();
    // A monthly limit follows the setter's calendar (ADR-003, ADR-004).
    let calendar: LimitRow['calendar'] = null;
    if (body.period?.type === 'monthly') {
      const [setter] = await this.db
        .select({ calendarPref: appUser.calendarPref })
        .from(appUser)
        .where(eq(appUser.id, a.userId));
      calendar = setter?.calendarPref ?? 'ethiopian';
    }
    const values = {
      value: body.value,
      periodType: body.period?.type ?? null,
      periodDays: body.period?.days ?? null,
      calendar,
      mode: body.mode,
      updatedAt: now,
    };
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(accountLimit)
        .values({
          accountId: a.account.id,
          setBy: side,
          createdAt: now,
          createdBy: a.userId,
          ...values,
        })
        .onConflictDoUpdate({ target: [accountLimit.accountId, accountLimit.setBy], set: values })
        .returning();
      await this.audit.record(tx, {
        actorUserId: a.userId,
        action: 'limit.set',
        objectType: 'account',
        objectId: a.account.id,
        after: { side, ...body, calendar },
      });
      // "Limit changed by other side" notices are push-only; they arrive with M10.
      return limitView(row!);
    });
  }

  async remove(a: AccountAccess, side: LimitSide): Promise<void> {
    this.requireSide(a, side);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(accountLimit)
        .where(and(eq(accountLimit.accountId, a.account.id), eq(accountLimit.setBy, side)));
      await this.audit.record(tx, {
        actorUserId: a.userId,
        action: 'limit.remove',
        objectType: 'account',
        objectId: a.account.id,
        after: { side },
      });
    });
  }

  private requireSide(a: AccountAccess, side: LimitSide): void {
    const action = side === 'merchant' ? 'set_merchant_limit' : 'set_customer_limit';
    if (!accountAllows(a.role, action)) throw forbidden(action);
  }
}
