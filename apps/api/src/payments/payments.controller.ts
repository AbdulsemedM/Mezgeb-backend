import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  type CreatePaymentReport,
  type CreatePayme,
  createPaymentReportSchema,
  createPaymeSchema,
  type RejectPaymentReport,
  rejectPaymentReportSchema,
} from '@mezgeb/shared';
import type { Request, Response } from 'express';
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

  /** ADR-013: the customer opened the pay-me request (`sent` → `seen`). */
  @Post('payme-requests/:id/seen')
  @HttpCode(HttpStatus.OK)
  seen(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<PaymeView> {
    return this.payments.markPaymeSeen(auth.userId, id);
  }

  /** ADR-016: the receipt photo as the raw request body (image/jpeg, png or webp). */
  @Put('payment-reports/:id/receipt')
  putReceipt(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() req: Request,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<PaymentReportView> {
    return this.payments.putReceipt(
      auth.userId,
      id,
      Buffer.isBuffer(req.body) ? req.body : undefined,
      contentType?.split(';')[0]?.trim(),
    );
  }

  @Get('payment-reports/:id/receipt')
  async getReceipt(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.payments.getReceipt(auth.userId, id);
    res.setHeader('cache-control', 'private, max-age=3600');
    return new StreamableFile(file.bytes, { type: file.contentType });
  }
}
