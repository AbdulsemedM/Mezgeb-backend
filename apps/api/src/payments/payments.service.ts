import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CreatePaymentReport,
  type CreatePayme,
  formatBirr,
  type RejectPaymentReport,
  uuidv7,
} from '@mezgeb/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { type AccountAccess, AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser, paymeRequest, paymentReport } from '../db/schema.js';
import { t } from '../i18n/messages.js';
import { EntriesService } from '../ledger/entries.service.js';
import { idConflict } from '../merchants/merchants.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { displayDate } from '../statements/statements.service.js';
import { ObjectStorage, type StoredObject } from '../storage/object-storage.js';

type PaymeRow = typeof paymeRequest.$inferSelect;
type ReportRow = typeof paymentReport.$inferSelect;

export interface PaymeView {
  id: string;
  account_id: string;
  amount: number;
  message: string | null;
  due_date: string | null;
  payment_details: string | null;
  status: PaymeRow['status'];
  created_at: string;
}

export function paymeView(p: PaymeRow): PaymeView {
  return {
    id: p.id,
    account_id: p.accountId,
    amount: p.amount,
    message: p.message,
    due_date: p.dueDate,
    payment_details: (p.paymentDetails as { text?: string } | null)?.text ?? null,
    status: p.status,
    created_at: p.createdAt.toISOString(),
  };
}

export interface PaymentReportView {
  id: string;
  account_id: string;
  amount: number;
  method: ReportRow['method'];
  reference: string | null;
  status: ReportRow['status'];
  reject_reason: string | null;
  entry_id: string | null;
  resubmitted_from_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  /** A receipt photo was attached (`GET /v1/payment-reports/{id}/receipt`, ADR-016). */
  has_receipt: boolean;
}

/** ADR-016: receipt photos are compressed on the phone; anything bigger is refused. */
export const MAX_RECEIPT_BYTES = 600 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function paymentReportView(r: ReportRow): PaymentReportView {
  return {
    id: r.id,
    account_id: r.accountId,
    amount: r.amount,
    method: r.method,
    reference: r.reference,
    status: r.status,
    reject_reason: r.rejectReason,
    entry_id: r.entryId,
    resubmitted_from_id: r.resubmittedFromId,
    reviewed_at: r.reviewedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
    has_receipt: r.screenshotUrl !== null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M8 (ADR-013): pay-me requests (PAY-1, PAY-7), customer payment reports (PAY-2) and the owner's
 * review (PAY-3). Cash at the counter (PAY-4) is a signed device entry through EntriesService.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly entries: EntriesService,
    private readonly storage: ObjectStorage,
  ) {}

  /** Online, owner only. The SMS carries the shop's payment details. 201, or 200 on retry. */
  async createPayme(
    a: AccountAccess,
    userId: string,
    deviceId: string,
    body: CreatePayme,
  ): Promise<{ created: boolean; view: PaymeView }> {
    if (a.account.status !== 'active') {
      throw new AppError('account_not_active', 'This account is not active', HttpStatus.CONFLICT);
    }
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(paymeRequest).where(eq(paymeRequest.id, body.id));
      if (existing) {
        if (existing.accountId !== a.account.id) throw idConflict();
        return { created: false, view: paymeView(existing) };
      }
      const details = a.merchant.paymentDetails;
      const [row] = await tx
        .insert(paymeRequest)
        .values({
          id: body.id,
          accountId: a.account.id,
          amount: body.amount,
          message: body.message ?? null,
          dueDate: body.due_date ?? null,
          paymentDetails: details ? { text: details } : null,
          createdAt: now,
          createdBy: userId,
          deviceId,
          updatedAt: now,
        })
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'payme.create',
        objectType: 'payme_request',
        objectId: body.id,
        after: { account_id: a.account.id, amount: body.amount },
      });
      const [customer] = await tx
        .select()
        .from(appUser)
        .where(eq(appUser.id, a.account.customerUserId));
      const lang = customer!.language;
      const calendar = customer!.calendarPref ?? 'ethiopian';
      await this.outbox.notify(tx, {
        merchantId: a.merchant.id,
        userId: customer!.id,
        phone: customer!.phone,
        event: 'payme_sent',
        template: 'sms.payme',
        params: {
          shop: a.merchant.shopName,
          amount: formatBirr(body.amount, lang),
          message: body.message ? `${body.message} ` : '',
          details: [
            details ? t('sms.payme_details', lang, { details }) : '',
            body.due_date
              ? t('sms.payme_due', lang, { date: displayDate(body.due_date, lang, calendar) })
              : '',
          ].join(''),
        },
        language: lang,
      });
      return { created: true, view: paymeView(row!) };
    });
  }

  async listPayme(a: AccountAccess): Promise<{ payme_requests: PaymeView[] }> {
    const rows = await this.db
      .select()
      .from(paymeRequest)
      .where(eq(paymeRequest.accountId, a.account.id))
      .orderBy(desc(paymeRequest.createdAt));
    return { payme_requests: rows.map(paymeView) };
  }

  /**
   * ADR-013 `seen`: the customer opened the request in the PWA. Only `sent` moves to `seen`;
   * any later status (partly paid, paid, expired) stays. Idempotent.
   */
  async markPaymeSeen(userId: string, paymeId: string): Promise<PaymeView> {
    const row = UUID.test(paymeId)
      ? (await this.db.select().from(paymeRequest).where(eq(paymeRequest.id, paymeId)))[0]
      : undefined;
    if (!row) throw new AppError('not_found', 'Pay-me request not found', HttpStatus.NOT_FOUND);
    await this.access.requireAccount(userId, row.accountId, 'report_payment');
    if (row.status !== 'sent') return paymeView(row);
    const now = this.clock.now();
    const [updated] = await this.db
      .update(paymeRequest)
      .set({ status: 'seen', seenAt: now, updatedAt: now })
      .where(and(eq(paymeRequest.id, row.id), eq(paymeRequest.status, 'sent')))
      .returning();
    return paymeView(updated ?? row);
  }

  /**
   * ADR-016: the customer attaches a receipt photo to their report while the shop has not
   * reviewed it. PUT is idempotent: sending again replaces the same object.
   */
  async putReceipt(
    userId: string,
    reportId: string,
    bytes: Buffer | undefined,
    contentType: string | undefined,
  ): Promise<PaymentReportView> {
    const report = await this.loadReport(reportId);
    await this.access.requireAccount(userId, report.accountId, 'report_payment');
    const type = RECEIPT_TYPES.find((x) => x === contentType);
    if (!type || !bytes) {
      throw new AppError(
        'unsupported_receipt_type',
        'Send the receipt as a JPEG, PNG or WebP image',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES) {
      throw new AppError(
        'receipt_too_large',
        'The receipt photo is too large',
        HttpStatus.PAYLOAD_TOO_LARGE,
        { max_bytes: MAX_RECEIPT_BYTES },
      );
    }
    this.assertReported(report);
    const key = `receipts/${report.accountId}/${report.id}`;
    await this.storage.put(key, bytes, type);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(paymentReport)
        .set({ screenshotUrl: key, updatedAt: now })
        .where(eq(paymentReport.id, report.id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'payment_report.receipt',
        objectType: 'payment_report',
        objectId: report.id,
        after: { bytes: bytes.length, content_type: type },
      });
      return paymentReportView(row!);
    });
  }

  /** The receipt photo, for the owner and the customer (money: never staff, ADR-003). */
  async getReceipt(userId: string, reportId: string): Promise<StoredObject> {
    const report = await this.loadReport(reportId);
    await this.access.requireAccount(userId, report.accountId, 'view_balance');
    const found = report.screenshotUrl ? await this.storage.get(report.screenshotUrl) : null;
    if (!found) throw new AppError('not_found', 'No receipt photo', HttpStatus.NOT_FOUND);
    return found;
  }

  private async loadReport(reportId: string): Promise<ReportRow> {
    const report = UUID.test(reportId)
      ? (await this.db.select().from(paymentReport).where(eq(paymentReport.id, reportId)))[0]
      : undefined;
    if (!report) throw new AppError('not_found', 'Payment report not found', HttpStatus.NOT_FOUND);
    return report;
  }

  /** PAY-2, the customer: "I paid". It changes nothing until the owner confirms it. */
  async report(
    a: AccountAccess,
    userId: string,
    deviceId: string,
    body: CreatePaymentReport,
  ): Promise<{ created: boolean; view: PaymentReportView }> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(paymentReport).where(eq(paymentReport.id, body.id));
      if (existing) {
        if (existing.accountId !== a.account.id) throw idConflict();
        return { created: false, view: paymentReportView(existing) };
      }
      if (body.resubmitted_from_id) {
        const [old] = await tx
          .select()
          .from(paymentReport)
          .where(eq(paymentReport.id, body.resubmitted_from_id));
        if (old?.accountId !== a.account.id || old.status !== 'rejected') {
          throw new AppError(
            'invalid_resubmission',
            'Only a rejected report on this account can be sent again',
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      const [row] = await tx
        .insert(paymentReport)
        .values({
          id: body.id,
          accountId: a.account.id,
          amount: body.amount,
          method: body.method,
          reference: body.reference ?? null,
          resubmittedFromId: body.resubmitted_from_id ?? null,
          createdAt: now,
          createdBy: userId,
          deviceId,
          updatedAt: now,
        })
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'payment_report.create',
        objectType: 'payment_report',
        objectId: body.id,
        after: { account_id: a.account.id, amount: body.amount, method: body.method },
      });
      const [owner] = await tx.select().from(appUser).where(eq(appUser.id, a.merchant.ownerUserId));
      const [customer] = await tx
        .select()
        .from(appUser)
        .where(eq(appUser.id, a.account.customerUserId));
      await this.outbox.notify(tx, {
        merchantId: a.merchant.id,
        userId: owner!.id,
        phone: owner!.phone,
        event: 'payment_reported',
        template: 'sms.payment_reported',
        params: {
          customer: a.account.nickname ?? customer!.name ?? customer!.phone,
          amount: formatBirr(body.amount, owner!.language),
          method: t(`payment_method.${body.method}`, owner!.language),
        },
        language: owner!.language,
      });
      return { created: true, view: paymentReportView(row!) };
    });
  }

  async listReports(a: AccountAccess): Promise<{ payment_reports: PaymentReportView[] }> {
    const rows = await this.db
      .select()
      .from(paymentReport)
      .where(eq(paymentReport.accountId, a.account.id))
      .orderBy(asc(paymentReport.createdAt));
    return { payment_reports: rows.map(paymentReportView) };
  }

  /**
   * PAY-3, online, owner only: the server records the payment entry (ADR-001 server origin)
   * and the report points at it. Confirming again returns the same report.
   */
  async confirm(userId: string, reportId: string): Promise<PaymentReportView> {
    const { a, report } = await this.find(userId, reportId);
    if (report.status === 'confirmed') return paymentReportView(report);
    this.assertReported(report);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const payment = await this.entries.recordServerPayment(tx, a, {
        id: uuidv7(now.getTime()),
        amount: report.amount,
        method: report.method,
        actorUserId: userId,
        requestId: randomUUID(),
      });
      const [row] = await tx
        .update(paymentReport)
        .set({
          status: 'confirmed',
          entryId: payment.id,
          reviewedBy: userId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(paymentReport.id, report.id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'payment_report.confirm',
        objectType: 'payment_report',
        objectId: report.id,
        after: { entry_id: payment.id },
      });
      return paymentReportView(row!);
    });
  }

  /** PAY-3: rejected with a reason the customer sees; they can report again. */
  async reject(
    userId: string,
    reportId: string,
    body: RejectPaymentReport,
  ): Promise<PaymentReportView> {
    const { a, report } = await this.find(userId, reportId);
    if (report.status === 'rejected' && report.rejectReason === body.reason) {
      return paymentReportView(report);
    }
    this.assertReported(report);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(paymentReport)
        .set({
          status: 'rejected',
          rejectReason: body.reason,
          reviewedBy: userId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(paymentReport.id, report.id))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'payment_report.reject',
        objectType: 'payment_report',
        objectId: report.id,
        after: { reason: body.reason },
      });
      const [customer] = await tx
        .select()
        .from(appUser)
        .where(eq(appUser.id, a.account.customerUserId));
      await this.outbox.notify(tx, {
        merchantId: a.merchant.id,
        userId: customer!.id,
        phone: customer!.phone,
        event: 'payment_rejected',
        template: 'sms.payment_rejected',
        params: {
          shop: a.merchant.shopName,
          amount: formatBirr(report.amount, customer!.language),
          reason: body.reason,
        },
        language: customer!.language,
      });
      return paymentReportView(row!);
    });
  }

  private async find(userId: string, reportId: string) {
    const report = UUID.test(reportId)
      ? (await this.db.select().from(paymentReport).where(eq(paymentReport.id, reportId)))[0]
      : undefined;
    if (!report) {
      throw new AppError('not_found', 'Payment report not found', HttpStatus.NOT_FOUND);
    }
    const a = await this.access.requireAccount(userId, report.accountId, 'review_payment');
    return { a, report };
  }

  private assertReported(report: ReportRow): void {
    if (report.status !== 'reported') {
      throw new AppError(
        'payment_report_reviewed',
        'This payment report was already reviewed',
        HttpStatus.CONFLICT,
        { status: report.status },
      );
    }
  }
}
