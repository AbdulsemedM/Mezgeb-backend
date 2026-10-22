import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type CreateDispute, formatBirr, type ResolveDispute } from '@mezgeb/shared';
import { asc, eq } from 'drizzle-orm';
import { type AccountAccess, AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser, dispute, entry } from '../db/schema.js';
import { idConflict } from '../merchants/merchants.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

type DisputeRow = typeof dispute.$inferSelect;

export interface DisputeView {
  id: string;
  entry_id: string;
  raised_by: string;
  reason: string;
  status: DisputeRow['status'];
  resolution_entry_id: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export function disputeView(d: DisputeRow): DisputeView {
  return {
    id: d.id,
    entry_id: d.entryId,
    raised_by: d.raisedBy,
    reason: d.reason,
    status: d.status,
    resolution_entry_id: d.resolutionEntryId,
    resolution_note: d.resolutionNote,
    resolved_by: d.resolvedBy,
    resolved_at: d.resolvedAt?.toISOString() ?? null,
    created_at: d.createdAt.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (what: string) =>
  new AppError('not_found', `${what} not found`, HttpStatus.NOT_FOUND);

/** LED-6 / US-13: the customer disputes; the owner resolves by a correction or a note. */
@Injectable()
export class DisputesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(
    userId: string,
    deviceId: string,
    entryId: string,
    body: CreateDispute,
  ): Promise<{ created: boolean; view: DisputeView }> {
    const disputed = UUID.test(entryId)
      ? (await this.db.select().from(entry).where(eq(entry.id, entryId)))[0]
      : undefined;
    if (!disputed) throw notFound('Entry');
    const a = await this.access.requireAccount(userId, disputed.accountId, 'dispute_entry');
    const now = this.clock.now();

    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(dispute).where(eq(dispute.id, body.id));
      if (existing) {
        if (existing.entryId !== entryId || existing.raisedBy !== userId) throw idConflict();
        return { created: false, view: disputeView(existing) };
      }
      const [row] = await tx
        .insert(dispute)
        .values({
          id: body.id,
          entryId,
          raisedBy: userId,
          reason: body.reason,
          createdAt: now,
          deviceId,
          updatedAt: now,
        })
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'dispute.create',
        objectType: 'dispute',
        objectId: body.id,
        after: { entry_id: entryId, reason: body.reason },
      });
      await this.notifyOwner(tx, a, disputed.amount, body.reason);
      return { created: true, view: disputeView(row!) };
    });
  }

  async resolve(userId: string, disputeId: string, body: ResolveDispute): Promise<DisputeView> {
    const found = UUID.test(disputeId)
      ? (
          await this.db
            .select({ dispute, accountId: entry.accountId })
            .from(dispute)
            .innerJoin(entry, eq(entry.id, dispute.entryId))
            .where(eq(dispute.id, disputeId))
        )[0]
      : undefined;
    if (!found) throw notFound('Dispute');
    const a = await this.access.requireAccount(userId, found.accountId, 'resolve_dispute');
    if (found.dispute.status === 'resolved') {
      // The same answer again is a retry (e.g. a sync whose response was lost).
      const same = body.correction_entry_id
        ? found.dispute.resolutionEntryId === body.correction_entry_id
        : found.dispute.resolutionNote === body.note;
      if (same) return disputeView(found.dispute);
      throw new AppError(
        'dispute_resolved',
        'This dispute is already resolved',
        HttpStatus.CONFLICT,
      );
    }
    if (body.correction_entry_id) {
      const [correction] = await this.db
        .select()
        .from(entry)
        .where(eq(entry.id, body.correction_entry_id));
      if (
        correction?.type !== 'correction' ||
        correction.refEntryId !== found.dispute.entryId ||
        correction.accountId !== a.account.id
      ) {
        throw new AppError(
          'invalid_resolution',
          'The resolution must be a correction of the disputed entry',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(dispute)
        .set({
          status: 'resolved',
          resolutionEntryId: body.correction_entry_id ?? null,
          resolutionNote: body.note ?? null,
          resolvedBy: userId,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(dispute.id, disputeId))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'dispute.resolve',
        objectType: 'dispute',
        objectId: disputeId,
        after: body,
      });
      return disputeView(row!);
    });
  }

  async list(a: AccountAccess): Promise<{ disputes: DisputeView[] }> {
    const rows = await this.db
      .select({ dispute })
      .from(dispute)
      .innerJoin(entry, eq(entry.id, dispute.entryId))
      .where(eq(entry.accountId, a.account.id))
      .orderBy(asc(dispute.createdAt));
    return { disputes: rows.map((r) => disputeView(r.dispute)) };
  }

  /** "Entry disputed": push to the merchant from M10; SMS until then. */
  private async notifyOwner(
    tx: Pick<Db, 'select' | 'insert'>,
    a: AccountAccess,
    amount: number,
    reason: string,
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
      event: 'entry_disputed',
      template: 'sms.dispute',
      params: {
        customer: a.account.nickname ?? customer.name ?? customer.phone,
        amount: formatBirr(amount, owner.language),
        reason,
      },
      language: owner.language,
    });
  }
}
