import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type AddStaff,
  type CreateMerchant,
  CURRENT_TERMS_VERSION,
  normalizeEthiopianPhone,
  type UpdateMerchant,
  uuidv7,
} from '@mezgeb/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { MerchantAccess, MerchantRow } from '../access/access.service.js';
import type { MerchantRole } from '../access/permissions.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { account, appUser, merchant, merchantStaff } from '../db/schema.js';

export interface StaffView {
  user_id: string;
  phone: string;
  name: string | null;
  role: MerchantRole;
}

export interface MerchantView {
  id: string;
  shop_name: string;
  sub_city: string | null;
  woreda: string | null;
  landmark: string | null;
  default_detail_mode: MerchantRow['defaultDetailMode'];
  /** PAY-7: shown to customers on pay-me requests. */
  payment_details: string | null;
  plan: MerchantRow['plan'];
  role: MerchantRole;
  created_at: string;
  staff?: StaffView[];
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class MerchantsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Creates the caller's shop (idempotent on `id`); the caller becomes owner (ADR-006). */
  async create(
    userId: string,
    body: CreateMerchant,
  ): Promise<{ created: boolean; view: MerchantView }> {
    assertCurrentTerms(body.terms_version);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(merchant)
        .values({
          id: body.id,
          ownerUserId: userId,
          shopName: body.shop_name,
          subCity: body.sub_city ?? null,
          woreda: body.woreda ?? null,
          landmark: body.landmark ?? null,
          defaultDetailMode: body.default_detail_mode ?? 'simple',
          termsAcceptedAt: now,
          termsVersion: body.terms_version,
          createdAt: now,
          createdBy: userId,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        const [byId] = await tx.select().from(merchant).where(eq(merchant.id, body.id));
        if (byId?.ownerUserId === userId)
          return { created: false, view: merchantView(byId, 'owner') };
        if (byId) throw idConflict();
        const [owned] = await tx.select().from(merchant).where(eq(merchant.ownerUserId, userId));
        throw new AppError('merchant_exists', 'You already have a shop', HttpStatus.CONFLICT, {
          merchant_id: owned?.id,
        });
      }

      await tx.insert(merchantStaff).values({
        merchantId: inserted.id,
        userId,
        role: 'owner',
        createdAt: now,
        createdBy: userId,
      });
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'merchant.create',
        objectType: 'merchant',
        objectId: inserted.id,
        after: { shop_name: inserted.shopName, terms_version: inserted.termsVersion },
      });
      return { created: true, view: merchantView(inserted, 'owner') };
    });
  }

  /** Shops where the caller is owner or staff. */
  async listForUser(userId: string): Promise<MerchantView[]> {
    const rows = await this.db
      .select({ merchant, role: merchantStaff.role })
      .from(merchantStaff)
      .innerJoin(merchant, eq(merchant.id, merchantStaff.merchantId))
      .where(eq(merchantStaff.userId, userId))
      .orderBy(asc(merchant.createdAt));
    return rows.map((r) => merchantView(r.merchant, r.role));
  }

  async get(access: MerchantAccess): Promise<MerchantView> {
    return {
      ...merchantView(access.merchant, access.role),
      staff: await this.staff(access.merchant.id),
    };
  }

  async update(access: MerchantAccess, body: UpdateMerchant): Promise<MerchantView> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(merchant)
        .set({
          ...(body.shop_name !== undefined && { shopName: body.shop_name }),
          ...(body.sub_city !== undefined && { subCity: body.sub_city }),
          ...(body.woreda !== undefined && { woreda: body.woreda }),
          ...(body.landmark !== undefined && { landmark: body.landmark }),
          ...(body.default_detail_mode !== undefined && {
            defaultDetailMode: body.default_detail_mode,
          }),
          ...(body.payment_details !== undefined && { paymentDetails: body.payment_details }),
          updatedAt: now,
        })
        .where(eq(merchant.id, access.merchant.id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: access.userId,
        action: 'merchant.update',
        objectType: 'merchant',
        objectId: access.merchant.id,
        before: pickChanged(access.merchant, body),
        after: body,
      });
      return merchantView(updated!, access.role);
    });
  }

  /**
   * Adds the shop's one staff member by phone (ADR-003). Idempotent for the same person.
   * A placeholder user is created if the phone has never signed in.
   */
  async addStaff(access: MerchantAccess, body: AddStaff): Promise<StaffView> {
    const phone = normalizeEthiopianPhone(body.phone);
    if (!phone) throw invalidPhone();
    const now = this.clock.now();
    const merchantId = access.merchant.id;

    return this.db.transaction(async (tx) => {
      const user = await findOrCreateUser(tx, phone, 'am', now);
      if (user.id === access.merchant.ownerUserId) {
        throw new AppError(
          'invalid_staff',
          'The owner cannot be added as staff',
          HttpStatus.BAD_REQUEST,
        );
      }
      const [customerAccount] = await tx
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.merchantId, merchantId), eq(account.customerUserId, user.id)));
      if (customerAccount) {
        throw new AppError(
          'staff_is_customer',
          'This person is a customer of the shop and cannot also be staff',
          HttpStatus.CONFLICT,
        );
      }

      const [inserted] = await tx
        .insert(merchantStaff)
        .values({
          merchantId,
          userId: user.id,
          role: 'staff',
          createdAt: now,
          createdBy: access.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [same] = await tx
          .select()
          .from(merchantStaff)
          .where(and(eq(merchantStaff.merchantId, merchantId), eq(merchantStaff.userId, user.id)));
        if (same) return staffView(user, same.role);
        throw new AppError(
          'staff_limit',
          'A shop can have one staff member; remove the current one first',
          HttpStatus.CONFLICT,
        );
      }
      await this.audit.record(tx, {
        actorUserId: access.userId,
        action: 'merchant.staff_add',
        objectType: 'merchant',
        objectId: merchantId,
        after: { user_id: user.id },
      });
      return staffView(user, 'staff');
    });
  }

  /** Removes staff; their access ends with their next request (roles are read per request). */
  async removeStaff(access: MerchantAccess, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(merchantStaff)
        .where(
          and(
            eq(merchantStaff.merchantId, access.merchant.id),
            eq(merchantStaff.userId, userId),
            eq(merchantStaff.role, 'staff'),
          ),
        )
        .returning();
      if (removed.length === 0) {
        throw new AppError('not_found', 'Staff member not found', HttpStatus.NOT_FOUND);
      }
      await this.audit.record(tx, {
        actorUserId: access.userId,
        action: 'merchant.staff_remove',
        objectType: 'merchant',
        objectId: access.merchant.id,
        before: { user_id: userId },
      });
    });
  }

  private async staff(merchantId: string): Promise<StaffView[]> {
    const rows = await this.db
      .select({ user: appUser, role: merchantStaff.role })
      .from(merchantStaff)
      .innerJoin(appUser, eq(appUser.id, merchantStaff.userId))
      .where(eq(merchantStaff.merchantId, merchantId))
      .orderBy(asc(merchantStaff.createdAt));
    return rows.map((r) => staffView(r.user, r.role));
  }
}

/** Finds a user by normalized phone or creates a placeholder (no verified phone; ADR-006). */
export async function findOrCreateUser(
  tx: Tx,
  phone: string,
  language: 'am' | 'om' | 'en',
  now: Date,
): Promise<typeof appUser.$inferSelect> {
  const [created] = await tx
    .insert(appUser)
    .values({ id: uuidv7(now.getTime()), phone, language, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: appUser.phone })
    .returning();
  return created ?? (await tx.select().from(appUser).where(eq(appUser.phone, phone)))[0]!;
}

export function assertCurrentTerms(version: string): void {
  if (version !== CURRENT_TERMS_VERSION) {
    throw new AppError(
      'terms_outdated',
      'The agreement has changed; show the current version and accept again',
      HttpStatus.CONFLICT,
      { current_version: CURRENT_TERMS_VERSION },
    );
  }
}

export function invalidPhone(): AppError {
  return new AppError(
    'invalid_phone',
    'Enter an Ethiopian mobile number (09… or 07…)',
    HttpStatus.BAD_REQUEST,
  );
}

export function idConflict(): AppError {
  return new AppError(
    'id_conflict',
    'This id is already used by another record',
    HttpStatus.CONFLICT,
  );
}

export function merchantView(m: MerchantRow, role: MerchantRole): MerchantView {
  return {
    id: m.id,
    shop_name: m.shopName,
    sub_city: m.subCity,
    woreda: m.woreda,
    landmark: m.landmark,
    default_detail_mode: m.defaultDetailMode,
    payment_details: m.paymentDetails,
    plan: m.plan,
    role,
    created_at: m.createdAt.toISOString(),
  };
}

function staffView(u: typeof appUser.$inferSelect, role: MerchantRole): StaffView {
  return { user_id: u.id, phone: u.phone, name: u.name, role };
}

function pickChanged(m: MerchantRow, body: UpdateMerchant): Record<string, unknown> {
  const current: Record<string, unknown> = {
    shop_name: m.shopName,
    sub_city: m.subCity,
    woreda: m.woreda,
    landmark: m.landmark,
    default_detail_mode: m.defaultDetailMode,
    payment_details: m.paymentDetails,
  };
  return Object.fromEntries(Object.keys(body).map((k) => [k, current[k]]));
}
