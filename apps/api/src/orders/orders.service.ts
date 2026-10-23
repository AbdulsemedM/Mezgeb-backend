import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CreateOrder,
  type DeclineOrder,
  formatBirr,
  type OrderReceipt,
  type OutForDelivery,
  type PricedLine,
  type PriceOrder,
  uuidv7,
} from '@mezgeb/shared';
import { desc, eq } from 'drizzle-orm';
import { type AccountAccess, AccessService } from '../access/access.service.js';
import { type AccountAction } from '../access/permissions.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser, deliveryOrder, merchantStaff } from '../db/schema.js';
import { DisputesService } from '../ledger/disputes.service.js';
import { idConflict } from '../merchants/merchants.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type OrderRow = typeof deliveryOrder.$inferSelect;
type Status = OrderRow['status'];

export interface OrderView {
  id: string;
  account_id: string;
  /** What the customer asked for, or the priced list once the shop priced it. */
  lines: unknown[];
  address_note: string | null;
  preferred_time: string | null;
  status: Status;
  decline_reason: string | null;
  delivery_person: string | null;
  delivered_entry_id: string | null;
  receipt_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function orderView(o: OrderRow): OrderView {
  return {
    id: o.id,
    account_id: o.accountId,
    lines: o.lines as unknown[],
    address_note: o.addressNote,
    preferred_time: o.preferredTime,
    status: o.status,
    decline_reason: o.declineReason,
    delivery_person: o.deliveryPerson,
    delivered_entry_id: o.deliveredEntryId,
    receipt_confirmed_at: o.receiptConfirmedAt?.toISOString() ?? null,
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
  };
}

/** The shop's steps (ADR-014): from which statuses each one may be taken. */
const FROM: Record<'accepted' | 'declined' | 'priced' | 'out_for_delivery', Status[]> = {
  accepted: ['sent'],
  declined: ['sent', 'accepted', 'priced'],
  priced: ['accepted', 'priced'],
  out_for_delivery: ['priced'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M9 / US-12 (ADR-014): the customer sends a list (PWA); the shop accepts, prices (out-of-stock
 * lines marked), sends it out and delivers. "Delivered" is the signed purchase entry with this
 * order's id (EntriesService). The shop's steps are idempotent so they can travel through sync.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly disputes: DisputesService,
  ) {}

  /** ORD-1. 201, or 200 for a retry. */
  async create(
    a: AccountAccess,
    userId: string,
    deviceId: string,
    body: CreateOrder,
  ): Promise<{ created: boolean; view: OrderView }> {
    if (a.account.status !== 'active') {
      throw new AppError('account_not_active', 'This account is not active', HttpStatus.CONFLICT);
    }
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(deliveryOrder).where(eq(deliveryOrder.id, body.id));
      if (existing) {
        if (existing.accountId !== a.account.id) throw idConflict();
        return { created: false, view: orderView(existing) };
      }
      const [row] = await tx
        .insert(deliveryOrder)
        .values({
          id: body.id,
          accountId: a.account.id,
          lines: body.lines,
          addressNote: body.address_note ?? null,
          preferredTime: body.preferred_time ?? null,
          createdAt: now,
          createdBy: userId,
          deviceId,
          updatedAt: now,
        })
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'order.create',
        objectType: 'delivery_order',
        objectId: body.id,
        after: { account_id: a.account.id, lines: body.lines.length },
      });
      await this.notifyShop(tx, a, body.lines.length);
      return { created: true, view: orderView(row!) };
    });
  }

  async list(a: AccountAccess): Promise<{ orders: OrderView[] }> {
    const rows = await this.db
      .select()
      .from(deliveryOrder)
      .where(eq(deliveryOrder.accountId, a.account.id))
      .orderBy(desc(deliveryOrder.createdAt));
    return { orders: rows.map(orderView) };
  }

  accept(userId: string, orderId: string): Promise<OrderView> {
    return this.step(userId, orderId, 'accepted', {}, () => null);
  }

  decline(userId: string, orderId: string, body: DeclineOrder): Promise<OrderView> {
    return this.step(userId, orderId, 'declined', { declineReason: body.reason }, (a, lang) => ({
      event: 'order_declined',
      template: 'sms.order_declined',
      params: { shop: a.merchant.shopName, reason: body.reason },
      lang,
    }));
  }

  price(userId: string, orderId: string, body: PriceOrder): Promise<OrderView> {
    const total = body.lines.reduce((sum, l: PricedLine) => sum + l.amount, 0);
    return this.step(userId, orderId, 'priced', { lines: body.lines }, (a, lang) => ({
      event: 'order_priced',
      template: 'sms.order_priced',
      params: { shop: a.merchant.shopName, total: formatBirr(total, lang) },
      lang,
    }));
  }

  out(userId: string, orderId: string, body: OutForDelivery): Promise<OrderView> {
    return this.step(
      userId,
      orderId,
      'out_for_delivery',
      { deliveryPerson: body.delivery_person ?? null },
      (a, lang) => ({
        event: 'order_out',
        template: 'sms.order_out',
        params: { shop: a.merchant.shopName },
        lang,
      }),
    );
  }

  /** ORD-4, the customer: received, or a missing item opens a dispute on the delivery entry. */
  async receipt(
    userId: string,
    deviceId: string,
    orderId: string,
    body: OrderReceipt,
  ): Promise<OrderView> {
    const { order } = await this.find(userId, orderId, 'send_order');
    if (order.status !== 'delivered' || !order.deliveredEntryId) {
      throw new AppError(
        'order_not_delivered',
        'This order is not delivered yet',
        HttpStatus.CONFLICT,
      );
    }
    if (body.missing) {
      await this.disputes.create(userId, deviceId, order.deliveredEntryId, {
        id: uuidv7(this.clock.now().getTime()),
        reason: body.missing,
      });
    }
    const now = this.clock.now();
    const [row] = await this.db
      .update(deliveryOrder)
      .set({ receiptConfirmedAt: order.receiptConfirmedAt ?? now, updatedAt: now })
      .where(eq(deliveryOrder.id, order.id))
      .returning();
    return orderView(row!);
  }

  /** One of the shop's steps; the same step again returns the order unchanged. */
  private async step(
    userId: string,
    orderId: string,
    to: keyof typeof FROM,
    changes: Partial<typeof deliveryOrder.$inferInsert>,
    sms: (
      a: AccountAccess,
      lang: 'am' | 'om' | 'en',
    ) => {
      event: string;
      template: Parameters<OutboxService['enqueueSms']>[1]['template'];
      params: Record<string, string>;
      lang: 'am' | 'om' | 'en';
    } | null,
  ): Promise<OrderView> {
    const { a } = await this.find(userId, orderId, 'handle_order');
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(deliveryOrder)
        .where(eq(deliveryOrder.id, orderId))
        .for('update');
      // A step the order already passed is a retry (e.g. a sync whose response was lost).
      const rank: Partial<Record<Status, number>> = {
        sent: 0,
        accepted: 1,
        priced: 2,
        out_for_delivery: 3,
        delivered: 4,
      };
      const passed =
        to !== 'declined' && order!.status !== 'declined' && rank[order!.status]! > rank[to]!;
      if (passed || (order!.status === to && to !== 'priced')) return orderView(order!);
      if (!FROM[to].includes(order!.status)) {
        throw new AppError(
          'invalid_order_step',
          `An order that is ${order!.status} cannot become ${to}`,
          HttpStatus.CONFLICT,
          { status: order!.status },
        );
      }
      const [row] = await tx
        .update(deliveryOrder)
        .set({ ...changes, status: to, updatedAt: now })
        .where(eq(deliveryOrder.id, orderId))
        .returning();
      await this.audit.record(tx, {
        actorUserId: userId,
        action: `order.${to}`,
        objectType: 'delivery_order',
        objectId: orderId,
        before: { status: order!.status, lines: order!.lines },
        after: { status: to },
      });
      const [customer] = await tx
        .select()
        .from(appUser)
        .where(eq(appUser.id, a.account.customerUserId));
      const message = sms(a, customer!.language);
      if (message) {
        await this.outbox.enqueueSms(tx, {
          userId: customer!.id,
          phone: customer!.phone,
          event: message.event,
          template: message.template,
          params: message.params,
          language: message.lang,
        });
      }
      return orderView(row!);
    });
  }

  private async find(userId: string, orderId: string, action: AccountAction) {
    const order = UUID.test(orderId)
      ? (await this.db.select().from(deliveryOrder).where(eq(deliveryOrder.id, orderId)))[0]
      : undefined;
    if (!order) throw new AppError('not_found', 'Order not found', HttpStatus.NOT_FOUND);
    const a = await this.access.requireAccount(userId, order.accountId, action);
    return { a, order };
  }

  /** "New order": everyone in the shop (push from M10; SMS until then). */
  private async notifyShop(tx: Tx, a: AccountAccess, lines: number): Promise<void> {
    const shopPeople = await tx
      .select({ user: appUser })
      .from(merchantStaff)
      .innerJoin(appUser, eq(appUser.id, merchantStaff.userId))
      .where(eq(merchantStaff.merchantId, a.merchant.id));
    const [customer] = await tx
      .select()
      .from(appUser)
      .where(eq(appUser.id, a.account.customerUserId));
    for (const { user } of shopPeople) {
      await this.outbox.enqueueSms(tx, {
        userId: user.id,
        phone: user.phone,
        event: 'order_received',
        template: 'sms.order_received',
        params: {
          customer: a.account.nickname ?? customer!.name ?? customer!.phone,
          count: String(lines),
        },
        language: user.language,
      });
    }
  }
}
