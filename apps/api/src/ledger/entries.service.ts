import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  buildSigningPayload,
  type CreateEntry,
  entryHash,
  evaluateLimits,
  formatBirr,
  type Language,
  type LimitsResult,
  type ListEntriesQuery,
  payloadHash,
  type SigningInput,
  signingBytes,
  uuidv7,
} from '@mezgeb/shared';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { type AccountAccess, forbidden } from '../access/access.service.js';
import { type AccountAction, accountAllows } from '../access/permissions.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/token.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import {
  account,
  appUser,
  catalogueItem,
  device,
  entry,
  entryLine,
  representative,
} from '../db/schema.js';
import { verifyDeviceSignature } from '../devices/device-key.js';
import { t } from '../i18n/messages.js';
import { idConflict } from '../merchants/merchants.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { type EntryRow, type EntryView, entryView, linesByEntry } from './entry.views.js';
import { limitsInputFor } from './limits.service.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type AccountRow = typeof account.$inferSelect;
type EntryFlag = EntryRow['flags'][number];
type RepresentativeRow = typeof representative.$inferSelect;

/**
 * Where an entry comes from (ADR-008). Online entries can be refused by the limits engine;
 * offline entries (arriving through sync) never are, only flagged (CLAUDE.md rule 6).
 */
export type EntryMode = 'online' | 'offline';

export interface RecordedEntry {
  entry: EntryView;
  /** Null for corrections and idempotent retries. */
  limits: LimitsResult | null;
  head: { seq: number; hash: string };
  /** Owner and customer only (ADR-003). */
  balance_santim?: number;
}

const CLOCK_SKEW_MS = 10 * 60_000;

@Injectable()
export class EntriesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Records a purchase or correction with the server transaction of ADR-001: lock the account,
   * return an existing entry unchanged, verify the signature, assign seq and hash, check limits,
   * insert, move the head and balance, queue notifications. 201 when created, 200 on retry.
   */
  async record(
    a: AccountAccess,
    auth: AuthContext,
    body: CreateEntry,
    mode: EntryMode,
  ): Promise<{ created: boolean; result: RecordedEntry }> {
    const action: AccountAction =
      body.type === 'purchase' ? 'record_purchase' : 'record_correction';
    if (!accountAllows(a.role, action)) throw forbidden(action);
    if (body.device_id !== auth.deviceId) {
      throw new AppError(
        'device_mismatch',
        'An entry must be signed by the device that sends it',
        HttpStatus.FORBIDDEN,
      );
    }
    if (a.account.status === 'closed') {
      throw new AppError('account_closed', 'This account is closed', HttpStatus.CONFLICT);
    }

    return this.db.transaction(async (tx) => {
      // 1. Serialize writes per account.
      const [acct] = await tx
        .select()
        .from(account)
        .where(eq(account.id, a.account.id))
        .for('update');

      // 2. Idempotent retry: the same id and signature returns the original.
      const [existing] = await tx.select().from(entry).where(eq(entry.id, body.id));
      if (existing) {
        if (existing.accountId !== acct!.id || existing.deviceSig !== body.device_sig) {
          throw idConflict();
        }
        return { created: false, result: await this.result(tx, a, acct!, existing, null) };
      }
      const [seqTaken] = await tx
        .select({ id: entry.id })
        .from(entry)
        .where(and(eq(entry.deviceId, body.device_id), eq(entry.deviceSeq, body.device_seq)));
      if (seqTaken) {
        throw new AppError(
          'device_seq_conflict',
          'This device_seq is already used by another entry',
          HttpStatus.CONFLICT,
          { entry_id: seqTaken.id },
        );
      }

      // 3. The device's signature over the ADR-001 payload.
      const payload = buildSigningPayload({
        ...withoutSig(body),
        account_id: acct!.id,
      } as SigningInput);
      const [dev] = await tx.select().from(device).where(eq(device.id, body.device_id));
      if (!dev || dev.userId !== auth.userId || dev.revokedAt) {
        throw new AppError('device_revoked', 'This device has been revoked', HttpStatus.FORBIDDEN);
      }
      if (!verifyDeviceSignature(dev.publicKey, signingBytes(payload), body.device_sig)) {
        throw new AppError(
          'invalid_signature',
          'The device signature does not match the entry',
          HttpStatus.BAD_REQUEST,
        );
      }

      const rep = await this.checkReferences(tx, acct!, body);

      // 4–8. Limits and flags, then the chain position.
      const now = this.clock.now();
      const flags: EntryFlag[] = [];
      // M6: a paused or revoked representative is refused online, only flagged offline (ADR-003).
      if (rep && rep.status !== 'active') {
        if (mode === 'online') {
          throw new AppError(
            'representative_inactive',
            'This representative was paused or removed by the customer',
            HttpStatus.CONFLICT,
            { status: rep.status },
          );
        }
        flags.push(rep.status === 'revoked' ? 'rep_revoked' : 'rep_paused');
      }
      let limits: LimitsResult | null = null;
      if (body.type === 'purchase') {
        limits = evaluateLimits(await limitsInputFor(tx, acct!, body.amount, now, rep));
        if (limits.flags.includes('over_hard_stop')) {
          if (mode === 'online') {
            throw new AppError(
              'limit_hard_stop',
              'The customer’s own limit does not allow this purchase',
              HttpStatus.CONFLICT,
              limits,
            );
          }
          flags.push('over_hard_stop');
        }
        const overLimit =
          limits.flags.includes('over_limit') || limits.flags.includes('rep_over_limit');
        if (overLimit) {
          if (mode === 'online' && !body.reason) {
            throw new AppError(
              'limit_override_required',
              'This purchase goes over the limit; give a reason to sell anyway',
              HttpStatus.CONFLICT,
              limits,
            );
          }
          flags.push('over_limit_override');
        }
      }
      if (acct!.status === 'pending') flags.push('pending_acceptance');
      const recordedAt = new Date(body.recorded_at);
      if (recordedAt.getTime() - now.getTime() > CLOCK_SKEW_MS) flags.push('clock_skew');

      const seq = acct!.lastSeq + 1;
      const ph = await payloadHash(payload);
      const hash = await entryHash({
        seq,
        prev_hash: acct!.lastHash,
        payload_hash: ph,
        device_sig: body.device_sig,
        received_at: now.toISOString(),
      });

      // 9. Insert, then move the head and the cached balance in the same transaction.
      const [inserted] = await tx
        .insert(entry)
        .values({
          id: body.id,
          accountId: acct!.id,
          type: body.type,
          amount: body.amount,
          takenByType: body.taken_by_type ?? null,
          representativeId: body.representative_id ?? null,
          orderId: null,
          refEntryId: body.ref_entry_id ?? null,
          reason: body.reason ?? null,
          seq,
          prevHash: acct!.lastHash,
          hash,
          receivedAt: now,
          origin: 'device',
          deviceId: body.device_id,
          deviceSeq: body.device_seq,
          deviceSig: body.device_sig,
          recordedAt,
          flags,
          createdAt: now,
          createdBy: auth.userId,
        })
        .returning();
      if (body.lines.length > 0) {
        await tx.insert(entryLine).values(
          body.lines.map((l, i) => ({
            entryId: body.id,
            lineNo: i + 1,
            itemId: l.item_id ?? null,
            name: l.name,
            qty: l.qty ?? null,
            unit: l.unit ?? null,
            unitPrice: l.unit_price ?? null,
            amount: l.amount,
            source: l.source ?? 'manual',
            createdAt: now,
          })),
        );
      }
      const [moved] = await tx
        .update(account)
        .set({
          lastSeq: seq,
          lastHash: hash,
          balanceSantim: acct!.balanceSantim + body.amount,
          updatedAt: now,
        })
        .where(eq(account.id, acct!.id))
        .returning();

      await this.learnCatalogue(tx, acct!.merchantId, body, auth, now);
      await this.audit.record(tx, {
        actorUserId: auth.userId,
        action: 'entry.create',
        objectType: 'entry',
        objectId: body.id,
        after: { account_id: acct!.id, type: body.type, amount: body.amount, seq, flags },
      });
      // 10. Notifications to the outbox.
      await this.notify(tx, a, moved!, inserted!, body, limits, rep);

      return { created: true, result: await this.result(tx, a, moved!, inserted!, limits) };
    });
  }

  /** Ledger for people: by recorded_at, then seq (ADR-001). */
  async list(a: AccountAccess, q: ListEntriesQuery): Promise<{ entries: EntryView[] }> {
    const rows = await this.db
      .select()
      .from(entry)
      .where(
        and(
          eq(entry.accountId, a.account.id),
          q.from ? gte(entry.recordedAt, new Date(q.from)) : undefined,
          q.to ? lt(entry.recordedAt, new Date(q.to)) : undefined,
        ),
      )
      .orderBy(asc(entry.recordedAt), asc(entry.seq));
    const lines = rows.length
      ? await this.db
          .select()
          .from(entryLine)
          .where(
            inArray(
              entryLine.entryId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    const byEntry = linesByEntry(lines);
    return { entries: rows.map((r) => entryView(r, byEntry.get(r.id) ?? [])) };
  }

  /** References in the body must point into this account and shop (malformed otherwise). */
  private async checkReferences(
    tx: Tx,
    acct: AccountRow,
    body: CreateEntry,
  ): Promise<RepresentativeRow | null> {
    if (body.ref_entry_id) {
      const [ref] = await tx
        .select({ accountId: entry.accountId })
        .from(entry)
        .where(eq(entry.id, body.ref_entry_id));
      if (ref?.accountId !== acct.id) {
        throw new AppError(
          'invalid_ref_entry',
          'A correction must reference an entry on the same account',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    let rep: RepresentativeRow | null = null;
    if (body.representative_id) {
      [rep = null] = await tx
        .select()
        .from(representative)
        .where(eq(representative.id, body.representative_id));
      if (rep?.accountId !== acct.id) {
        throw new AppError(
          'invalid_representative',
          'Only a representative listed on this account can take goods',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const itemIds = [...new Set(body.lines.map((l) => l.item_id).filter((i): i is string => !!i))];
    if (itemIds.length > 0) {
      const found = await tx
        .select({ id: catalogueItem.id })
        .from(catalogueItem)
        .where(
          and(eq(catalogueItem.merchantId, acct.merchantId), inArray(catalogueItem.id, itemIds)),
        );
      if (found.length !== itemIds.length) {
        throw new AppError(
          'invalid_item',
          'An item_id is not in this shop’s catalogue',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    return rep;
  }

  /**
   * ADR-008: detailed lines teach the catalogue. With `item_id` the item's last price and unit
   * move; without, the item is matched by name (case-insensitive) or created.
   */
  private async learnCatalogue(
    tx: Tx,
    merchantId: string,
    body: CreateEntry,
    auth: AuthContext,
    now: Date,
  ): Promise<void> {
    if (body.type !== 'purchase') return;
    for (const line of body.lines) {
      if (line.qty == null || line.unit_price == null) continue;
      const changes = { lastPrice: line.unit_price, unit: line.unit ?? null, updatedAt: now };
      if (line.item_id) {
        await tx.update(catalogueItem).set(changes).where(eq(catalogueItem.id, line.item_id));
        continue;
      }
      const [match] = await tx
        .select({ id: catalogueItem.id })
        .from(catalogueItem)
        .where(
          and(
            eq(catalogueItem.merchantId, merchantId),
            sql`lower(btrim(${catalogueItem.name})) = lower(btrim(${line.name}))`,
          ),
        )
        .limit(1);
      if (match) {
        await tx.update(catalogueItem).set(changes).where(eq(catalogueItem.id, match.id));
      } else {
        await tx.insert(catalogueItem).values({
          id: uuidv7(now.getTime()),
          merchantId,
          name: line.name.trim(),
          createdAt: now,
          createdBy: auth.userId,
          deviceId: auth.deviceId,
          ...changes,
        });
      }
    }
  }

  /** The customer hears about every change to an active account (notifications matrix). */
  private async notify(
    tx: Tx,
    a: AccountAccess,
    acct: AccountRow,
    e: EntryRow,
    body: CreateEntry,
    limits: LimitsResult | null,
    rep: RepresentativeRow | null,
  ): Promise<void> {
    if (acct.status !== 'active') return;
    const [customer] = await tx.select().from(appUser).where(eq(appUser.id, acct.customerUserId));
    if (!customer) return;
    const language: Language = customer.language;
    const money = (santim: number) => formatBirr(santim, language);
    const send = (
      event: string,
      template: Parameters<OutboxService['enqueueSms']>[1]['template'],
      params: Record<string, string>,
    ) =>
      this.outbox.enqueueSms(tx, {
        userId: customer.id,
        phone: customer.phone,
        event,
        template,
        params: { shop: a.merchant.shopName, ...params },
        language,
      });

    if (e.type === 'purchase') {
      let who = t('who.customer', language);
      if (e.takenByType === 'delivery') who = t('who.delivery', language);
      if (rep) who = rep.name;
      const items = body.lines.map((l) => l.name).join(', ') || '—';
      await send('purchase_recorded', 'sms.purchase', {
        amount: money(e.amount),
        items,
        who,
        balance: money(acct.balanceSantim),
      });
      if (rep && (e.flags.includes('rep_revoked') || e.flags.includes('rep_paused'))) {
        await send('representative_inactive_entry', 'sms.rep_inactive_entry', {
          amount: money(e.amount),
          name: rep.name,
        });
      }
      const repLimit = limits?.representative;
      if (rep && repLimit?.crossed.includes('100')) {
        await send('representative_limit', 'sms.rep_limit', {
          name: rep.name,
          limit: money(repLimit.limit),
        });
      }
      // REP-5: the representative's own receipt, if the customer turned it on.
      if (rep?.smsReceipt && rep.phone) {
        await this.outbox.enqueueSms(tx, {
          userId: null,
          phone: rep.phone,
          event: 'representative_receipt',
          template: 'sms.rep_receipt',
          params: {
            shop: a.merchant.shopName,
            items,
            amount: money(e.amount),
            customer: customer.name ?? customer.phone,
          },
          language,
        });
      }
      if (e.flags.includes('over_limit_override') && e.reason) {
        await send('limit_override_used', 'sms.limit_override', { reason: e.reason });
      }
      const limit = limits?.value.effective_limit;
      if (limit != null) {
        if (limits!.value.crossed.includes('80')) {
          await send('limit_80', 'sms.limit_80', { limit: money(limit) });
        }
        if (limits!.value.crossed.includes('100')) {
          await send('limit_100', 'sms.limit_100', { limit: money(limit) });
        }
      }
    } else {
      await send('correction_recorded', 'sms.correction', {
        amount: money(e.amount),
        reason: e.reason ?? '',
        balance: money(acct.balanceSantim),
      });
    }
  }

  private async result(
    tx: Tx,
    a: AccountAccess,
    acct: AccountRow,
    e: EntryRow,
    limits: LimitsResult | null,
  ): Promise<RecordedEntry> {
    const lines = await tx.select().from(entryLine).where(eq(entryLine.entryId, e.id));
    const result: RecordedEntry = {
      entry: entryView(e, lines),
      limits,
      head: { seq: acct.lastSeq, hash: acct.lastHash },
    };
    if (accountAllows(a.role, 'view_balance')) result.balance_santim = acct.balanceSantim;
    return result;
  }
}

function withoutSig(body: CreateEntry): Omit<CreateEntry, 'device_sig'> {
  const { device_sig: _sig, ...rest } = body;
  return rest;
}
