import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  type ApproveRaise,
  approveRaiseSchema,
  type CreateCorrectionRequest,
  type CreateDispute,
  createCorrectionRequestSchema,
  type CreateEntry,
  createDisputeSchema,
  createEntrySchema,
  type LimitSide,
  limitSideSchema,
  type ListEntriesQuery,
  listEntriesQuerySchema,
  type RequestRaise,
  requestRaiseSchema,
  type ResolveCorrectionRequest,
  type ResolveDispute,
  resolveCorrectionRequestSchema,
  resolveDisputeSchema,
  type SetLimit,
  setLimitSchema,
} from '@mezgeb/shared';
import { asc, eq } from 'drizzle-orm';
import type { Response } from 'express';
import {
  AccountActionRequired,
  CurrentAccountAccess,
  CurrentMerchantAccess,
  MerchantActionRequired,
} from '../access/access.guards.js';
import { type AccountAccess, forbidden, type MerchantAccess } from '../access/access.service.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { DB, type Db } from '../db/db.module.js';
import { catalogueItem } from '../db/schema.js';
import { type ChainVerification, verifyAccountChain } from './chain.js';
import {
  type CorrectionRequestView,
  CorrectionRequestsService,
} from './correction-requests.service.js';
import { type DisputeView, DisputesService } from './disputes.service.js';
import { EntriesService, type RecordedEntry } from './entries.service.js';
import type { EntryView } from './entry.views.js';
import { type LimitsView, LimitsService, type LimitView } from './limits.service.js';
import { RaisesService, type RaiseView } from './raises.service.js';

@Controller()
export class LedgerController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly entries: EntriesService,
    private readonly limits: LimitsService,
    private readonly disputes: DisputesService,
    private readonly raises: RaisesService,
    private readonly corrections: CorrectionRequestsService,
  ) {}

  /** ADR-011, online only: texts the customer a code. 201 when sent, 200 for a retry. */
  @Post('accounts/:id/raises')
  @AccountActionRequired('request_raise')
  async requestRaise(
    @CurrentAccountAccess() a: AccountAccess,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(requestRaiseSchema)) body: RequestRaise,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RaiseView> {
    const { created, view } = await this.raises.request(a, auth.userId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Post('accounts/:id/raises/:raiseId/approve')
  @AccountActionRequired('approve_raise')
  @HttpCode(HttpStatus.OK)
  approveRaise(
    @CurrentAccountAccess() a: AccountAccess,
    @CurrentAuth() auth: AuthContext,
    @Param('raiseId', new ParseUUIDPipe()) raiseId: string,
    @Body(new ZodValidationPipe(approveRaiseSchema)) body: ApproveRaise,
  ): Promise<RaiseView> {
    return this.raises.approve(a, auth.userId, raiseId, body);
  }

  /** Online path (ADR-008). Which entry types the role may record is checked in the service. */
  @Post('accounts/:id/entries')
  @AccountActionRequired('view_account')
  async record(
    @CurrentAccountAccess() a: AccountAccess,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createEntrySchema)) body: CreateEntry,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RecordedEntry> {
    const { created, result } = await this.entries.record(a, auth, body, 'online');
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Get('accounts/:id/entries')
  @AccountActionRequired('view_entries')
  list(
    @CurrentAccountAccess() a: AccountAccess,
    @Query(new ZodValidationPipe(listEntriesQuerySchema)) q: ListEntriesQuery,
  ): Promise<{ entries: EntryView[] }> {
    return this.entries.list(a, q);
  }

  @Get('accounts/:id/chain/verify')
  @AccountActionRequired('view_entries')
  verify(@CurrentAccountAccess() a: AccountAccess): Promise<ChainVerification> {
    return verifyAccountChain(this.db, a.account.id);
  }

  @Get('accounts/:id/limits')
  @AccountActionRequired('view_limits')
  getLimits(@CurrentAccountAccess() a: AccountAccess): Promise<LimitsView> {
    return this.limits.get(a);
  }

  @Put('accounts/:id/limits/:side')
  @AccountActionRequired('view_account')
  setLimit(
    @CurrentAccountAccess() a: AccountAccess,
    @Param('side', new ZodValidationPipe(limitSideSchema)) side: LimitSide,
    @Body(new ZodValidationPipe(setLimitSchema)) body: SetLimit,
  ): Promise<LimitView> {
    return this.limits.set(a, side, body);
  }

  @Delete('accounts/:id/limits/:side')
  @AccountActionRequired('view_account')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeLimit(
    @CurrentAccountAccess() a: AccountAccess,
    @Param('side', new ZodValidationPipe(limitSideSchema)) side: LimitSide,
  ): Promise<void> {
    await this.limits.remove(a, side);
  }

  @Get('accounts/:id/disputes')
  @AccountActionRequired('view_entries')
  listDisputes(@CurrentAccountAccess() a: AccountAccess): Promise<{ disputes: DisputeView[] }> {
    return this.disputes.list(a);
  }

  @Post('entries/:id/disputes')
  async dispute(
    @CurrentAuth() auth: AuthContext,
    @Param('id') entryId: string,
    @Body(new ZodValidationPipe(createDisputeSchema)) body: CreateDispute,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DisputeView> {
    const { created, view } = await this.disputes.create(auth.userId, auth.deviceId, entryId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Post('disputes/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id') disputeId: string,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) body: ResolveDispute,
  ): Promise<DisputeView> {
    return this.disputes.resolve(auth.userId, disputeId, body);
  }

  /** ADR-012: shop side only (owner and staff). */
  @Get('accounts/:id/correction-requests')
  @AccountActionRequired('view_entries')
  listCorrectionRequests(
    @CurrentAccountAccess() a: AccountAccess,
  ): Promise<{ correction_requests: CorrectionRequestView[] }> {
    if (a.role === 'customer') throw forbidden('request_correction');
    return this.corrections.list(a);
  }

  @Post('entries/:id/correction-requests')
  async requestCorrection(
    @CurrentAuth() auth: AuthContext,
    @Param('id') entryId: string,
    @Body(new ZodValidationPipe(createCorrectionRequestSchema)) body: CreateCorrectionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CorrectionRequestView> {
    const { created, view } = await this.corrections.create(
      auth.userId,
      auth.deviceId,
      entryId,
      body,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Post('correction-requests/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolveCorrectionRequest(
    @CurrentAuth() auth: AuthContext,
    @Param('id') requestId: string,
    @Body(new ZodValidationPipe(resolveCorrectionRequestSchema)) body: ResolveCorrectionRequest,
  ): Promise<CorrectionRequestView> {
    return this.corrections.resolve(auth.userId, requestId, body);
  }

  /** LED-4: names, units and last prices for suggestions at the counter. */
  @Get('merchants/:id/catalogue')
  @MerchantActionRequired('view_catalogue')
  async catalogue(@CurrentMerchantAccess() m: MerchantAccess): Promise<{
    items: {
      id: string;
      merchant_id: string;
      name: string;
      aliases: string[];
      unit: string | null;
      last_price: number | null;
      updated_at: string;
    }[];
  }> {
    const rows = await this.db
      .select()
      .from(catalogueItem)
      .where(eq(catalogueItem.merchantId, m.merchant.id))
      .orderBy(asc(catalogueItem.name));
    return {
      items: rows.map((r) => ({
        id: r.id,
        merchant_id: r.merchantId,
        name: r.name,
        aliases: r.aliases,
        unit: r.unit,
        last_price: r.lastPrice,
        updated_at: r.updatedAt.toISOString(),
      })),
    };
  }
}
