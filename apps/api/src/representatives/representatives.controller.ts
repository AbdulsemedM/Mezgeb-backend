import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  type CreateRepresentative,
  createRepresentativeSchema,
  type SetRepresentativeStatus,
  setRepresentativeStatusSchema,
  type UpdateRepresentative,
  updateRepresentativeSchema,
  type VerifyPin,
  verifyPinSchema,
} from '@mezgeb/shared';
import type { Response } from 'express';
import { AccountActionRequired, CurrentAccountAccess } from '../access/access.guards.js';
import type { AccountAccess } from '../access/access.service.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import {
  type CustomerRepresentativeView,
  RepresentativesService,
  type ShopRepresentativeView,
} from './representatives.service.js';

@Controller()
export class RepresentativesController {
  constructor(private readonly reps: RepresentativesService) {}

  @Post('accounts/:id/representatives')
  @AccountActionRequired('manage_representatives')
  async create(
    @CurrentAccountAccess() a: AccountAccess,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createRepresentativeSchema)) body: CreateRepresentative,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerRepresentativeView> {
    const { created, view } = await this.reps.create(a, auth.deviceId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Get('accounts/:id/representatives')
  @AccountActionRequired('view_representatives')
  list(
    @CurrentAccountAccess() a: AccountAccess,
  ): Promise<{ representatives: (ShopRepresentativeView | CustomerRepresentativeView)[] }> {
    return this.reps.list(a);
  }

  @Patch('representatives/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRepresentativeSchema)) body: UpdateRepresentative,
  ): Promise<CustomerRepresentativeView> {
    return this.reps.update(auth.userId, id, body);
  }

  @Post('representatives/:id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setRepresentativeStatusSchema)) body: SetRepresentativeStatus,
  ): Promise<CustomerRepresentativeView> {
    return this.reps.setStatus(auth.userId, id, body);
  }

  @Post('representatives/:id/verify-pin')
  @HttpCode(HttpStatus.OK)
  verifyPin(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(verifyPinSchema)) body: VerifyPin,
  ): Promise<{ ok: true } | { ok: false; attempts_left: number }> {
    return this.reps.verifyPin(auth.userId, id, body);
  }
}
