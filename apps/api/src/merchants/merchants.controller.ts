import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  type AddStaff,
  addStaffSchema,
  type CreateMerchant,
  createMerchantSchema,
  type UpdateMerchant,
  updateMerchantSchema,
} from '@mezgeb/shared';
import type { Response } from 'express';
import { CurrentMerchantAccess, MerchantActionRequired } from '../access/access.guards.js';
import type { MerchantAccess } from '../access/access.service.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { type MerchantView, MerchantsService, type StaffView } from './merchants.service.js';

@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  /** 201 when created, 200 for an idempotent retry. */
  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createMerchantSchema)) body: CreateMerchant,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MerchantView> {
    const { created, view } = await this.merchants.create(auth.userId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Get()
  async list(@CurrentAuth() auth: AuthContext): Promise<{ merchants: MerchantView[] }> {
    return { merchants: await this.merchants.listForUser(auth.userId) };
  }

  @Get(':id')
  @MerchantActionRequired('view_merchant')
  get(@CurrentMerchantAccess() access: MerchantAccess): Promise<MerchantView> {
    return this.merchants.get(access);
  }

  @Patch(':id')
  @MerchantActionRequired('update_shop')
  update(
    @CurrentMerchantAccess() access: MerchantAccess,
    @Body(new ZodValidationPipe(updateMerchantSchema)) body: UpdateMerchant,
  ): Promise<MerchantView> {
    return this.merchants.update(access, body);
  }

  @Post(':id/staff')
  @MerchantActionRequired('manage_staff')
  @HttpCode(HttpStatus.OK)
  addStaff(
    @CurrentMerchantAccess() access: MerchantAccess,
    @Body(new ZodValidationPipe(addStaffSchema)) body: AddStaff,
  ): Promise<StaffView> {
    return this.merchants.addStaff(access, body);
  }

  @Delete(':id/staff/:userId')
  @MerchantActionRequired('manage_staff')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStaff(
    @CurrentMerchantAccess() access: MerchantAccess,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.merchants.removeStaff(access, userId);
  }
}
