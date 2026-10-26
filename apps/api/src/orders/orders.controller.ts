import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  type CreateOrder,
  createOrderSchema,
  type DeclineOrder,
  declineOrderSchema,
  type OrderReceipt,
  orderReceiptSchema,
  type OutForDelivery,
  outForDeliverySchema,
  type PriceOrder,
  priceOrderSchema,
} from '@mezgeb/shared';
import type { Response } from 'express';
import { AccountActionRequired, CurrentAccountAccess } from '../access/access.guards.js';
import type { AccountAccess } from '../access/access.service.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { type OrderView, OrdersService } from './orders.service.js';

/** M9 delivery orders (ADR-014). The shop's steps are also sync ops. */
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The customer's PWA. */
  @Post('accounts/:id/orders')
  @AccountActionRequired('send_order')
  async create(
    @CurrentAccountAccess() a: AccountAccess,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrder,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderView> {
    const { created, view } = await this.orders.create(a, auth.userId, auth.deviceId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  /** ADR-016: the shop's items for the customer's order screen (names and units only). */
  @Get('accounts/:id/catalogue')
  @AccountActionRequired('send_order')
  catalogue(
    @CurrentAccountAccess() a: AccountAccess,
  ): Promise<{ items: { id: string; name: string; unit: string | null }[] }> {
    return this.orders.catalogueForCustomer(a);
  }

  @Get('accounts/:id/orders')
  @AccountActionRequired('view_account')
  list(@CurrentAccountAccess() a: AccountAccess): Promise<{ orders: OrderView[] }> {
    return this.orders.list(a);
  }

  @Post('orders/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<OrderView> {
    return this.orders.accept(auth.userId, id);
  }

  @Post('orders/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(declineOrderSchema)) body: DeclineOrder,
  ): Promise<OrderView> {
    return this.orders.decline(auth.userId, id, body);
  }

  @Post('orders/:id/price')
  @HttpCode(HttpStatus.OK)
  price(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(priceOrderSchema)) body: PriceOrder,
  ): Promise<OrderView> {
    return this.orders.price(auth.userId, id, body);
  }

  @Post('orders/:id/out')
  @HttpCode(HttpStatus.OK)
  out(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(outForDeliverySchema)) body: OutForDelivery,
  ): Promise<OrderView> {
    return this.orders.out(auth.userId, id, body);
  }

  /** The customer's PWA (ORD-4). */
  @Post('orders/:id/receipt')
  @HttpCode(HttpStatus.OK)
  receipt(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(orderReceiptSchema)) body: OrderReceipt,
  ): Promise<OrderView> {
    return this.orders.receipt(auth.userId, auth.deviceId, id, body);
  }
}
