import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CreateCorrectionRequest,
  formatBirr,
  type ResolveCorrectionRequest,
} from '@mezgeb/shared';
import { asc, eq } from 'drizzle-orm';
import { type AccountAccess, AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser, correctionRequest, entry } from '../db/schema.js';
import { idConflict } from '../merchants/merchants.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

type RequestRow = typeof correctionRequest.$inferSelect;

export interface CorrectionRequestView {
  id: string;
  entry_id: string;
  requested_by: string;
  amount: number;
  reason: string;
  status: RequestRow['status'];
  resolution_entry_id: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export function correctionRequestView(r: RequestRow): CorrectionRequestView {
  return {
    id: r.id,
    entry_id: r.entryId,
    requested_by: r.requestedBy,
    amount: r.amount,
    reason: r.reason,
    status: r.status,
    resolution_entry_id: r.resolutionEntryId,
    resolution_note: r.resolutionNote,
    resolved_by: r.resolvedBy,
    resolved_at: r.resolvedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (what: string) =>
  new AppError('not_found', `${what} not found`, HttpStatus.NOT_FOUND);

/**
 * ADR-012: staff cannot correct entries (ADR-006), so they ask the owner. The owner posts the
 * correction and resolves the request with its entry id, or declines with a note. Shop side
 * only: customers never see requests.
 */
@Injectable()
export class CorrectionRequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** 201 when created, 200 for an idempotent retry. */
  async create(
    userId: string,
    deviceId: string,
    entryId: string,
    body: CreateCorrectionRequest,
  ): Promise<{ created: boolean; view: CorrectionRequestView }> {
    const target = UUID.test(entryId)
      ? (await this.db.select().from(entry).where(eq(entry.id, entryId)))[0]
      : undefined;
    if (!target) throw notFound('Entry');
    const a = await this.access.requireAccount(userId, target.accountId, 'request_correction');
    const now = this.clock.now();

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(correctionRequest)
        .where(eq(correctionRequest.id, body.id));
      if (existing) {
        if (existing.entryId !== entryId || existing.requestedBy !== userId) throw idConflict();
        return { created: false, view: correctionRequestView(existing) };
      }
      const [row] = await tx
        .insert(correctionRequest)
        .values({
          id: body.id,
          entryId,
          requestedBy: userId,
          amount: body.amount,
          reason: body.reason,
          createdAt: now,
          deviceId,
          updatedAt: now,
        })
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'correction_request.create',
        objectType: 'correction_request',
        objectId: body.id,
        after: { entry_id: entryId, amount: body.amount, reason: body.reason },
      });
      await this.notifyOwner(tx, a, body.amount, body.reason);
      return { created: true, view: correctionRequestView(row!) };
    });
  }

  async resolve(
    userId: string,
    requestId: string,
    body: ResolveCorrectionRequest,
  ): Promise<CorrectionRequestView> {
    const found = UUID.test(requestId)
      ? (
          await this.db
            .select({ request: correctionRequest, accountId: entry.accountId })
            .from(correctionRequest)
            .innerJoin(entry, eq(entry.id, correctionRequest.entryId))
            .where(eq(correctionRequest.id, requestId))
        )[0]
      : undefined;
    if (!found) throw notFound('Correction request');
    const a = await this.access.requireAccount(userId, found.accountId, 'record_correction');
    if (found.request.status !== 'open') {
      // The same answer again is a retry; a different one is a conflict.
      const same = body.correction_entry_id
        ? found.request.resolutionEntryId === body.correction_entry_id
        : found.request.resolutionNote === body.note;
      if (same) return correctionRequestView(found.request);
      throw new AppError(
        'correction_request_resolved',
        'This request is already answered',
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
        correction.refEntryId !== found.request.entryId ||
        correction.accountId !== a.account.id
      ) {
        throw new AppError(
          'invalid_resolution',
          'The resolution must be a correction of the requested entry',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(correctionRequest)
        .set({
          status: body.correction_entry_id ? 'corrected' : 'declined',
          resolutionEntryId: body.correction_entry_id ?? null,
          resolutionNote: body.note ?? null,
          resolvedBy: userId,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(correctionRequest.id, requestId))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'correction_request.resolve',
        objectType: 'correction_request',
        objectId: requestId,
        after: body,
      });
      return correctionRequestView(row!);
    });
  }

  async list(a: AccountAccess): Promise<{ correction_requests: CorrectionRequestView[] }> {
    const rows = await this.db
      .select({ request: correctionRequest })
      .from(correctionRequest)
      .innerJoin(entry, eq(entry.id, correctionRequest.entryId))
      .where(eq(entry.accountId, a.account.id))
      .orderBy(asc(correctionRequest.createdAt));
    return { correction_requests: rows.map((r) => correctionRequestView(r.request)) };
  }

  /** "Correction requested": to the owner (push from M10; SMS until then). */
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
    await this.outbox.notify(tx, {
      merchantId: a.merchant.id,
      userId: owner.id,
      phone: owner.phone,
      event: 'correction_requested',
      template: 'sms.correction_request',
      params: {
        customer: a.account.nickname ?? customer.name ?? customer.phone,
        amount: formatBirr(amount, owner.language),
        reason,
      },
      language: owner.language,
    });
  }
}
