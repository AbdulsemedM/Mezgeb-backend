import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  type CreatePaymentReport,
  type CreatePayme,
  createPaymentReportSchema,
  createPaymeSchema,
  type RejectPaymentReport,
  rejectPaymentReportSchema,
} from '@mezgeb/shared';
import type { Response } from 'express';
import { AccountActionRequired, CurrentAccountAccess } from '../access/access.guards.js';
import type { AccountAccess } from '../access/access.service.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { type PaymentReportView, PaymentsService, type PaymeView } from './payments.service.js';

/** M8 (ADR-013). Pay-me and the review are online only (MOB-001). */
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('accounts/:id/payme-requests')
  @AccountActionRequired('send_payme')
  async createPayme(
    @CurrentAccountAccess() a: AccountAccess,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createPaymeSchema)) body: CreatePayme,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymeView> {
    const { created, view } = await this.payments.createPayme(a, auth.userId, auth.deviceId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Get('accounts/:id/payme-requests')
  @AccountActionRequired('view_balance')
  listPayme(@CurrentAccountAccess() a: AccountAccess): Promise<{ payme_requests: PaymeView[] }> {
    return this.payments.listPayme(a);
  }

  /** The customer's PWA. */
  @Post('accounts/:id/payment-reports')
  @AccountActionRequired('report_payment')
  async report(
    @CurrentAccountAccess() a: AccountAccess,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createPaymentReportSchema)) body: CreatePaymentReport,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentReportView> {
    const { created, view } = await this.payments.report(a, auth.userId, auth.deviceId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Get('accounts/:id/payment-reports')
  @AccountActionRequired('view_balance')
  listReports(
    @CurrentAccountAccess() a: AccountAccess,
  ): Promise<{ payment_reports: PaymentReportView[] }> {
    return this.payments.listReports(a);
  }

  @Post('payment-reports/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<PaymentReportView> {
    return this.payments.confirm(auth.userId, id);
  }

  @Post('payment-reports/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectPaymentReportSchema)) body: RejectPaymentReport,
  ): Promise<PaymentReportView> {
    return this.payments.reject(auth.userId, id, body);
  }
}
