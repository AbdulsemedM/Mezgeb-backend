import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  createAccountSchema,
  createCorrectionRequestSchema,
  createDisputeSchema,
  createEntrySchema,
  createRepresentativeSchema,
  limitSideSchema,
  resolveCorrectionRequestSchema,
  resolveDisputeSchema,
  setLimitSchema,
  setRepresentativeStatusSchema,
  type SyncOp,
  type SyncRequest,
  updateAccountSchema,
  updateRepresentativeSchema,
} from '@mezgeb/shared';
import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service.js';
import { accountAllows, type AccountRole } from '../access/permissions.js';
import { type AccountView, accountView } from '../accounts/account.views.js';
import { AccountsService } from '../accounts/accounts.service.js';
import type { AuthContext } from '../auth/token.service.js';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import {
  account,
  accountLimit,
  appUser,
  catalogueItem,
  changeLog,
  correctionRequest,
  dispute,
  paymentReport,
  paymeRequest,
  entry,
  entryLine,
  merchant,
  merchantStaff,
  representative,
} from '../db/schema.js';
import {
  type CorrectionRequestView,
  CorrectionRequestsService,
  correctionRequestView,
} from '../ledger/correction-requests.service.js';
import { type DisputeView, DisputesService, disputeView } from '../ledger/disputes.service.js';
import {
  type PaymentReportView,
  paymentReportView,
  type PaymeView,
  paymeView,
} from '../payments/payments.service.js';
import { EntriesService } from '../ledger/entries.service.js';
import { type EntryView, entryView, linesByEntry } from '../ledger/entry.views.js';
import { LimitsService, type LimitView, limitView } from '../ledger/limits.service.js';
import { type MerchantView, merchantView } from '../merchants/merchants.service.js';
import {
  customerView,
  RepresentativesService,
  shopView,
} from '../representatives/representatives.service.js';

export interface WriteResult {
  op: SyncOp;
  /** The object's id (`<account_id>:<side>` for limits). */
  id: string;
  status: 'ok' | 'error';
  code?: string;
  message?: string;
  details?: unknown;
  result?: unknown;
}

export interface SyncChanges {
  accounts: AccountView[];
  entries: EntryView[];
  representatives: unknown[];
  disputes: DisputeView[];
  /** Shop side only (ADR-012). */
  correction_requests: CorrectionRequestView[];
  /** Owner and customer only (ADR-003, ADR-013). */
  payme_requests: PaymeView[];
  payment_reports: PaymentReportView[];
  limits: (LimitView & { account_id: string; side: 'merchant' | 'customer' })[];
  catalogue: {
    id: string;
    merchant_id: string;
    name: string;
    aliases: string[];
    unit: string | null;
    last_price: number | null;
    updated_at: string;
  }[];
  merchants: MerchantView[];
}

export interface SyncResponse {
  results: WriteResult[];
  changes: SyncChanges;
  deleted: { limits: { account_id: string; side: 'merchant' | 'customer' }[] };
  heads: { account_id: string; seq: number; hash: string }[];
  memberships: {
    merchants: { id: string; role: 'owner' | 'staff' }[];
    accounts: { id: string; role: 'customer' }[];
  };
  cursor: string;
  has_more: boolean;
}

/** Each write's routing ids; the rest of the body goes to the REST route's own schema. */
const withAccount = z.object({ account_id: z.uuid() }).loose();
const withId = z.object({ id: z.uuid() }).loose();
const withEntry = z.object({ entry_id: z.uuid() }).loose();
const limitTarget = z.object({ account_id: z.uuid(), side: limitSideSchema }).loose();

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      'validation_failed',
      'Request body is invalid',
      HttpStatus.BAD_REQUEST,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

function omit<T extends Record<string, unknown>, K extends string>(o: T, ...keys: K[]): Omit<T, K> {
  const copy: Record<string, unknown> = { ...o };
  for (const k of keys) delete copy[k];
  return copy as Omit<T, K>;
}

/**
 * Offline-first sync (M7, ADR-010): apply the device's queued writes one by one through the
 * same services as REST (entries in offline mode), then return everything the caller may see
 * that changed since their cursor.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly entries: EntriesService,
    private readonly accounts: AccountsService,
    private readonly reps: RepresentativesService,
    private readonly disputes: DisputesService,
    private readonly corrections: CorrectionRequestsService,
    private readonly limits: LimitsService,
  ) {}

  async sync(auth: AuthContext, body: SyncRequest): Promise<SyncResponse> {
    const results: WriteResult[] = [];
    for (const write of body.writes) results.push(await this.apply(auth, write.op, write.body));
    return { results, ...(await this.pull(auth.userId, body.cursor, body.page_size)) };
  }

  /** One write in its own transaction: a failure is reported for that write only. */
  private async apply(
    auth: AuthContext,
    op: SyncOp,
    body: Record<string, unknown>,
  ): Promise<WriteResult> {
    const id = this.objectId(op, body);
    try {
      return { op, id, status: 'ok', result: await this.run(auth, op, body) };
    } catch (err) {
      if (err instanceof AppError) {
        return {
          op,
          id,
          status: 'error',
          code: err.code,
          message: err.message,
          details: err.details,
        };
      }
      this.logger.error(`sync ${op} ${id} failed: ${(err as Error).stack ?? String(err)}`);
      return { op, id, status: 'error', code: 'internal_error', message: 'Something went wrong' };
    }
  }

  private objectId(op: SyncOp, body: Record<string, unknown>): string {
    if (op === 'limit.set' || op === 'limit.delete')
      return `${String(body.account_id)}:${String(body.side)}`;
    return String(body.id ?? '');
  }

  private async run(
    auth: AuthContext,
    op: SyncOp,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const { userId, deviceId } = auth;
    switch (op) {
      case 'entry.create': {
        const { account_id } = parse(withAccount, body);
        const entryBody = parse(createEntrySchema, omit(body, 'account_id'));
        const a = await this.access.requireAccount(userId, account_id, 'view_account');
        const { result } = await this.entries.record(a, auth, entryBody, 'offline');
        return result;
      }
      case 'account.create':
        return (await this.accounts.create(userId, parse(createAccountSchema, body))).view;
      case 'account.update': {
        const { id } = parse(withId, body);
        const a = await this.access.requireAccount(userId, id, 'view_account');
        return this.accounts.update(a, parse(updateAccountSchema, omit(body, 'id')));
      }
      case 'representative.create': {
        const { account_id } = parse(withAccount, body);
        const a = await this.access.requireAccount(userId, account_id, 'manage_representatives');
        const repBody = parse(createRepresentativeSchema, omit(body, 'account_id'));
        return (await this.reps.create(a, deviceId, repBody)).view;
      }
      case 'representative.update': {
        const { id } = parse(withId, body);
        return this.reps.update(userId, id, parse(updateRepresentativeSchema, omit(body, 'id')));
      }
      case 'representative.status': {
        const { id } = parse(withId, body);
        return this.reps.setStatus(
          userId,
          id,
          parse(setRepresentativeStatusSchema, omit(body, 'id')),
        );
      }
      case 'dispute.create': {
        const { entry_id } = parse(withEntry, body);
        const disputeBody = parse(createDisputeSchema, omit(body, 'entry_id'));
        return (await this.disputes.create(userId, deviceId, entry_id, disputeBody)).view;
      }
      case 'dispute.resolve': {
        const { id } = parse(withId, body);
        return this.disputes.resolve(userId, id, parse(resolveDisputeSchema, omit(body, 'id')));
      }
      case 'correction_request.create': {
        const { entry_id } = parse(withEntry, body);
        const requestBody = parse(createCorrectionRequestSchema, omit(body, 'entry_id'));
        return (await this.corrections.create(userId, deviceId, entry_id, requestBody)).view;
      }
      case 'correction_request.resolve': {
        const { id } = parse(withId, body);
        return this.corrections.resolve(
          userId,
          id,
          parse(resolveCorrectionRequestSchema, omit(body, 'id')),
        );
      }
      case 'limit.set': {
        const { account_id, side } = parse(limitTarget, body);
        const a = await this.access.requireAccount(userId, account_id, 'view_account');
        return this.limits.set(a, side, parse(setLimitSchema, omit(body, 'account_id', 'side')));
      }
      case 'limit.delete': {
        const { account_id, side } = parse(limitTarget, body);
        const a = await this.access.requireAccount(userId, account_id, 'view_account');
        await this.limits.remove(a, side);
        return null;
      }
    }
  }

  /**
   * Changes since `cursor`, whole transactions only. The cursor is `xid:id`: rows are read in
   * (xid, id) order and only from transactions older than every transaction still running, so a
   * transaction that commits late can never be skipped (ADR-010).
   */
  private async pull(
    userId: string,
    cursor: string,
    pageSize: number,
  ): Promise<Omit<SyncResponse, 'results'>> {
    const merchants = await this.db
      .select({ id: merchantStaff.merchantId, role: merchantStaff.role })
      .from(merchantStaff)
      .where(eq(merchantStaff.userId, userId));
    const ownAccounts = await this.db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.customerUserId, userId));
    const memberships = {
      merchants: merchants.map((m) => ({ id: m.id, role: m.role })),
      accounts: ownAccounts.map((a) => ({ id: a.id, role: 'customer' as const })),
    };

    const xminRows = await this.db.execute<{ xmin: string }>(
      sql`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`,
    );
    const xmin = Number(xminRows.rows[0]!.xmin);
    const [cx, cid] = cursor === '0' ? [0, 0] : cursor.split(':').map(Number);

    const visible: SQL[] = [];
    if (merchants.length)
      visible.push(
        inArray(
          changeLog.merchantId,
          merchants.map((m) => m.id),
        ),
      );
    if (ownAccounts.length)
      visible.push(
        inArray(
          changeLog.accountId,
          ownAccounts.map((a) => a.id),
        ),
      );
    const empty = this.emptyChanges();
    if (visible.length === 0) {
      return { ...empty, memberships, cursor: `${Math.max(cx!, xmin)}:0`, has_more: false };
    }

    const rows = await this.db
      .select()
      .from(changeLog)
      .where(
        and(
          or(...visible),
          sql`(${changeLog.xid}, ${changeLog.id}) > (${cx}, ${cid})`,
          sql`${changeLog.xid} < ${xmin}`,
        ),
      )
      .orderBy(asc(changeLog.xid), asc(changeLog.id))
      .limit(pageSize + 1);
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    const next = hasMore ? `${last!.xid}:${last!.id}` : `${Math.max(cx!, xmin)}:0`;

    const roleOf = new Map(merchants.map((m) => [m.id, m.role]));
    const ids = (type: string) => [
      ...new Set(page.filter((r) => r.objectType === type).map((r) => r.objectId)),
    ];
    const changes = await this.hydrate(ids, roleOf);
    return { ...changes, memberships, cursor: next, has_more: hasMore };
  }

  private emptyChanges(): Pick<SyncResponse, 'changes' | 'deleted' | 'heads'> {
    return {
      changes: {
        accounts: [],
        entries: [],
        representatives: [],
        disputes: [],
        correction_requests: [],
        payme_requests: [],
        payment_reports: [],
        limits: [],
        catalogue: [],
        merchants: [],
      },
      deleted: { limits: [] },
      heads: [],
    };
  }

  /** The current state of each changed object, shaped for the caller's role on it. */
  private async hydrate(
    ids: (type: string) => string[],
    roleOf: Map<string, 'owner' | 'staff'>,
  ): Promise<Pick<SyncResponse, 'changes' | 'deleted' | 'heads'>> {
    const out = this.emptyChanges();
    const accountRole = (merchantId: string): AccountRole => roleOf.get(merchantId) ?? 'customer';

    const entryIds = ids('entry');
    const entryRows = entryIds.length
      ? await this.db.select().from(entry).where(inArray(entry.id, entryIds))
      : [];
    const lines = entryRows.length
      ? await this.db
          .select()
          .from(entryLine)
          .where(
            inArray(
              entryLine.entryId,
              entryRows.map((e) => e.id),
            ),
          )
      : [];
    const grouped = linesByEntry(lines);
    out.changes.entries = entryRows.map((e) => entryView(e, grouped.get(e.id) ?? []));

    // Accounts that changed, plus those whose entries changed (for heads).
    const accountIds = [...new Set([...ids('account'), ...entryRows.map((e) => e.accountId)])];
    const accountRows = accountIds.length
      ? await this.db
          .select({ account, merchant, customer: appUser })
          .from(account)
          .innerJoin(merchant, eq(merchant.id, account.merchantId))
          .innerJoin(appUser, eq(appUser.id, account.customerUserId))
          .where(inArray(account.id, accountIds))
      : [];
    const changedAccounts = new Set(ids('account'));
    for (const r of accountRows) {
      if (changedAccounts.has(r.account.id)) {
        out.changes.accounts.push(
          accountView(accountRole(r.account.merchantId), r.account, r.merchant, r.customer),
        );
      }
      out.heads.push({
        account_id: r.account.id,
        seq: r.account.lastSeq,
        hash: r.account.lastHash,
      });
    }

    const repIds = ids('representative');
    if (repIds.length) {
      const reps = await this.db
        .select({ rep: representative, merchantId: account.merchantId })
        .from(representative)
        .innerJoin(account, eq(account.id, representative.accountId))
        .where(inArray(representative.id, repIds));
      out.changes.representatives = reps.map((r) =>
        accountRole(r.merchantId) === 'customer' ? customerView(r.rep) : shopView(r.rep),
      );
    }

    const disputeIds = ids('dispute');
    if (disputeIds.length) {
      const rows = await this.db.select().from(dispute).where(inArray(dispute.id, disputeIds));
      out.changes.disputes = rows.map(disputeView);
    }

    const requestIds = ids('correction_request');
    if (requestIds.length) {
      const rows = await this.db
        .select({ request: correctionRequest, merchantId: account.merchantId })
        .from(correctionRequest)
        .innerJoin(entry, eq(entry.id, correctionRequest.entryId))
        .innerJoin(account, eq(account.id, entry.accountId))
        .where(inArray(correctionRequest.id, requestIds));
      out.changes.correction_requests = rows
        .filter((r) => roleOf.has(r.merchantId))
        .map((r) => correctionRequestView(r.request));
    }

    // Pay-me requests and payment reports: owner and customer only (money, ADR-003).
    const merchantOfAccount = async (accountIds: string[]) =>
      new Map(
        (
          await this.db
            .select({ id: account.id, merchantId: account.merchantId })
            .from(account)
            .where(inArray(account.id, accountIds))
        ).map((r) => [r.id, r.merchantId]),
      );
    const paymeIds = ids('payme_request');
    if (paymeIds.length) {
      const rows = await this.db
        .select()
        .from(paymeRequest)
        .where(inArray(paymeRequest.id, paymeIds));
      const owners = await merchantOfAccount([...new Set(rows.map((r) => r.accountId))]);
      out.changes.payme_requests = rows
        .filter((r) => accountAllows(accountRole(owners.get(r.accountId)!), 'view_balance'))
        .map(paymeView);
    }
    const reportIds = ids('payment_report');
    if (reportIds.length) {
      const rows = await this.db
        .select()
        .from(paymentReport)
        .where(inArray(paymentReport.id, reportIds));
      const owners = await merchantOfAccount([...new Set(rows.map((r) => r.accountId))]);
      out.changes.payment_reports = rows
        .filter((r) => accountAllows(accountRole(owners.get(r.accountId)!), 'view_balance'))
        .map(paymentReportView);
    }

    // Limits: owner and customer only (ADR-003); a missing row was deleted.
    const limitKeys = ids('limit').map((k) => {
      const [accountId, side] = k.split(':') as [string, 'merchant' | 'customer'];
      return { accountId, side };
    });
    if (limitKeys.length) {
      const owners = await this.db
        .select({ id: account.id, merchantId: account.merchantId })
        .from(account)
        .where(inArray(account.id, [...new Set(limitKeys.map((k) => k.accountId))]));
      const merchantOf = new Map(owners.map((o) => [o.id, o.merchantId]));
      const rows = await this.db
        .select()
        .from(accountLimit)
        .where(inArray(accountLimit.accountId, [...merchantOf.keys()]));
      for (const k of limitKeys) {
        const merchantId = merchantOf.get(k.accountId);
        if (!merchantId || !accountAllows(accountRole(merchantId), 'view_limits')) continue;
        const row = rows.find((r) => r.accountId === k.accountId && r.setBy === k.side);
        if (row)
          out.changes.limits.push({ account_id: k.accountId, side: k.side, ...limitView(row) });
        else out.deleted.limits.push({ account_id: k.accountId, side: k.side });
      }
    }

    const itemIds = ids('catalogue');
    if (itemIds.length) {
      const rows = await this.db
        .select()
        .from(catalogueItem)
        .where(inArray(catalogueItem.id, itemIds));
      out.changes.catalogue = rows
        .filter((r) => roleOf.has(r.merchantId))
        .map((r) => ({
          id: r.id,
          merchant_id: r.merchantId,
          name: r.name,
          aliases: r.aliases,
          unit: r.unit,
          last_price: r.lastPrice,
          updated_at: r.updatedAt.toISOString(),
        }));
    }

    const merchantIds = ids('merchant').filter((id) => roleOf.has(id));
    if (merchantIds.length) {
      const rows = await this.db.select().from(merchant).where(inArray(merchant.id, merchantIds));
      out.changes.merchants = rows.map((m) => merchantView(m, roleOf.get(m.id)!));
    }
    return out;
  }
}
