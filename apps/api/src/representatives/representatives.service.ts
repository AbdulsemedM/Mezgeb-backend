import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CreateRepresentative,
  localDate,
  normalizeEthiopianPhone,
  type RepLimit,
  type SetRepresentativeStatus,
  type UpdateRepresentative,
  type VerifyPin,
} from '@mezgeb/shared';
import { asc, eq } from 'drizzle-orm';
import { type AccountAccess, AccessService, forbidden } from '../access/access.service.js';
import { type AccountAction, accountAllows } from '../access/permissions.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser, representative } from '../db/schema.js';
import { idConflict, invalidPhone } from '../merchants/merchants.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

export type RepresentativeRow = typeof representative.$inferSelect;

export const PIN_MAX_ATTEMPTS = 5;

interface RepLimitView {
  value: number;
  period: {
    type: NonNullable<RepresentativeRow['limitPeriodType']>;
    days: number | null;
    calendar: RepresentativeRow['limitCalendar'];
  };
  /** Addis local date the periods roll from (ADR-007). */
  set_at: string;
}

/** What the shop sees at the counter: no phone, no PIN, no receipt setting. */
export interface ShopRepresentativeView {
  id: string;
  account_id: string;
  name: string;
  relationship: RepresentativeRow['relationship'];
  status: RepresentativeRow['status'];
  may_order: boolean;
  has_pin: boolean;
  limit: RepLimitView | null;
}

export interface CustomerRepresentativeView extends ShopRepresentativeView {
  phone: string | null;
  sms_receipt: boolean;
  created_at: string;
  updated_at: string;
}

function limitView(r: RepresentativeRow): RepLimitView | null {
  if (r.limitValue === null || r.limitPeriodType === null || r.limitSetAt === null) return null;
  return {
    value: r.limitValue,
    period: { type: r.limitPeriodType, days: r.limitPeriodDays, calendar: r.limitCalendar },
    set_at: r.limitSetAt,
  };
}

export function shopView(r: RepresentativeRow): ShopRepresentativeView {
  return {
    id: r.id,
    account_id: r.accountId,
    name: r.name,
    relationship: r.relationship,
    status: r.status,
    may_order: r.mayOrder,
    has_pin: r.pinHash !== null,
    limit: limitView(r),
  };
}

export function customerView(r: RepresentativeRow): CustomerRepresentativeView {
  return {
    ...shopView(r),
    phone: r.phone,
    sms_receipt: r.smsReceipt,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

/** scrypt with a random salt; a 4-digit PIN is weak, so attempts are limited too. */
function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('base64')}:${scryptSync(pin, salt, 32).toString('base64')}`;
}

function pinMatches(pin: string, stored: string): boolean {
  const [, salt, hash] = stored.split(':');
  const expected = Buffer.from(hash!, 'base64');
  return timingSafeEqual(scryptSync(pin, Buffer.from(salt!, 'base64'), expected.length), expected);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** REP-1..6: the customer decides who may take goods; the shop picks only from active ones. */
@Injectable()
export class RepresentativesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(
    a: AccountAccess,
    deviceId: string,
    body: CreateRepresentative,
  ): Promise<{ created: boolean; view: CustomerRepresentativeView }> {
    this.require(a, 'manage_representatives');
    const phone = this.phone(body.phone);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(representative)
        .where(eq(representative.id, body.id));
      if (existing) {
        if (existing.accountId !== a.account.id) throw idConflict();
        return { created: false, view: customerView(existing) };
      }
      const [row] = await tx
        .insert(representative)
        .values({
          id: body.id,
          accountId: a.account.id,
          name: body.name,
          relationship: body.relationship,
          phone,
          mayOrder: body.may_order,
          smsReceipt: body.sms_receipt,
          pinHash: body.pin ? hashPin(body.pin) : null,
          ...(await this.limitColumns(a.userId, body.limit ?? null, now)),
          createdAt: now,
          createdBy: a.userId,
          deviceId,
          updatedAt: now,
        })
        .returning();
      await this.audit.record(tx, {
        actorUserId: a.userId,
        action: 'representative.create',
        objectType: 'representative',
        objectId: body.id,
        after: { account_id: a.account.id, name: body.name, relationship: body.relationship },
      });
      await this.notifyOwner(tx, a, 'representative_added', 'sms.rep_added', body.name);
      return { created: true, view: customerView(row!) };
    });
  }

  /** The customer sees everyone; the shop's picker only active representatives (REP-4). */
  async list(
    a: AccountAccess,
  ): Promise<{ representatives: (ShopRepresentativeView | CustomerRepresentativeView)[] }> {
    const rows = await this.db
      .select()
      .from(representative)
      .where(eq(representative.accountId, a.account.id))
      .orderBy(asc(representative.createdAt));
    return {
      representatives:
        a.role === 'customer'
          ? rows.map(customerView)
          : rows.filter((r) => r.status === 'active').map(shopView),
    };
  }

  async update(
    userId: string,
    repId: string,
    body: UpdateRepresentative,
  ): Promise<CustomerRepresentativeView> {
    const { rep } = await this.find(userId, repId, 'manage_representatives');
    const now = this.clock.now();
    const phone = body.phone === undefined ? rep.phone : this.phone(body.phone);
    const smsReceipt = body.sms_receipt ?? rep.smsReceipt;
    if (smsReceipt && !phone) {
      throw new AppError(
        'validation_failed',
        'An SMS receipt needs a phone number',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(representative)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.relationship !== undefined && { relationship: body.relationship }),
          ...(body.may_order !== undefined && { mayOrder: body.may_order }),
          phone,
          smsReceipt,
          // A new PIN also unlocks a locked one.
          ...(body.pin !== undefined && {
            pinHash: body.pin === null ? null : hashPin(body.pin),
            pinFailedAttempts: 0,
          }),
          // Changing the limit moves its anchor to today (ADR-007).
          ...(body.limit !== undefined && (await this.limitColumns(userId, body.limit, now))),
          updatedAt: now,
        })
        .where(eq(representative.id, rep.id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'representative.update',
        objectType: 'representative',
        objectId: rep.id,
        after: {
          ...body,
          pin: body.pin === undefined ? undefined : body.pin === null ? null : 'set',
        },
      });
      return customerView(row!);
    });
  }

  /** REP-3: instantly; revoked is final. */
  async setStatus(
    userId: string,
    repId: string,
    body: SetRepresentativeStatus,
  ): Promise<CustomerRepresentativeView> {
    const { a, rep } = await this.find(userId, repId, 'manage_representatives');
    if (rep.status === 'revoked') {
      if (body.status === 'revoked') return customerView(rep);
      throw new AppError(
        'representative_revoked',
        'A revoked representative cannot come back; add them again',
        HttpStatus.CONFLICT,
      );
    }
    if (rep.status === body.status) return customerView(rep);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(representative)
        .set({ status: body.status, updatedAt: now })
        .where(eq(representative.id, rep.id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'representative.status',
        objectType: 'representative',
        objectId: rep.id,
        before: { status: rep.status },
        after: { status: body.status },
      });
      if (body.status === 'revoked') {
        await this.notifyOwner(tx, a, 'representative_revoked', 'sms.rep_revoked', rep.name);
      }
      return customerView(row!);
    });
  }

  /** REP-6, online only: 5 wrong tries lock the PIN until the customer sets a new one. */
  async verifyPin(
    userId: string,
    repId: string,
    body: VerifyPin,
  ): Promise<{ ok: true } | { ok: false; attempts_left: number }> {
    const { rep } = await this.find(userId, repId, 'verify_representative_pin');
    if (rep.status !== 'active') {
      throw new AppError(
        'representative_inactive',
        'This representative is not active',
        HttpStatus.CONFLICT,
        {
          status: rep.status,
        },
      );
    }
    if (!rep.pinHash)
      throw new AppError('no_pin', 'This representative has no PIN', HttpStatus.BAD_REQUEST);
    if (rep.pinFailedAttempts >= PIN_MAX_ATTEMPTS) {
      throw new AppError(
        'pin_locked',
        'Too many wrong PINs; the customer must set a new one',
        HttpStatus.CONFLICT,
      );
    }
    const ok = pinMatches(body.pin, rep.pinHash);
    const attempts = ok ? 0 : rep.pinFailedAttempts + 1;
    await this.db
      .update(representative)
      .set({ pinFailedAttempts: attempts })
      .where(eq(representative.id, rep.id));
    return ok ? { ok: true } : { ok: false, attempts_left: PIN_MAX_ATTEMPTS - attempts };
  }

  private async find(
    userId: string,
    repId: string,
    action: AccountAction,
  ): Promise<{ a: AccountAccess; rep: RepresentativeRow }> {
    const rep = UUID.test(repId)
      ? (await this.db.select().from(representative).where(eq(representative.id, repId)))[0]
      : undefined;
    if (!rep) throw new AppError('not_found', 'Representative not found', HttpStatus.NOT_FOUND);
    const a = await this.access.requireAccount(userId, rep.accountId, action);
    return { a, rep };
  }

  private require(a: AccountAccess, action: AccountAction): void {
    if (!accountAllows(a.role, action)) throw forbidden(action);
  }

  private phone(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const phone = normalizeEthiopianPhone(raw);
    if (!phone) throw invalidPhone();
    return phone;
  }

  /** The own-limit columns; a monthly limit takes the customer's calendar (ADR-004). */
  private async limitColumns(userId: string, limit: RepLimit | null, now: Date) {
    if (!limit) {
      return {
        limitValue: null,
        limitPeriodType: null,
        limitPeriodDays: null,
        limitCalendar: null,
        limitSetAt: null,
      };
    }
    let calendar: RepresentativeRow['limitCalendar'] = null;
    if (limit.period.type === 'monthly') {
      const [setter] = await this.db
        .select({ calendarPref: appUser.calendarPref })
        .from(appUser)
        .where(eq(appUser.id, userId));
      calendar = setter?.calendarPref ?? 'ethiopian';
    }
    return {
      limitValue: limit.value,
      limitPeriodType: limit.period.type,
      limitPeriodDays: limit.period.days ?? null,
      limitCalendar: calendar,
      limitSetAt: localDate(now),
    };
  }

  /** "Representative added or revoked": push to the merchant from M10; SMS until then. */
  private async notifyOwner(
    tx: Pick<Db, 'select' | 'insert'>,
    a: AccountAccess,
    event: string,
    template: 'sms.rep_added' | 'sms.rep_revoked',
    name: string,
  ): Promise<void> {
    const [owner] = await tx.select().from(appUser).where(eq(appUser.id, a.merchant.ownerUserId));
    const [customer] = await tx
      .select()
      .from(appUser)
      .where(eq(appUser.id, a.account.customerUserId));
    if (!owner || !customer) return;
    await this.outbox.enqueueSms(tx, {
      userId: owner.id,
      phone: owner.phone,
      event,
      template,
      params: { customer: a.account.nickname ?? customer.name ?? customer.phone, name },
      language: owner.language,
    });
  }
}
