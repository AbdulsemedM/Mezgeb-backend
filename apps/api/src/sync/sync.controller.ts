import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { type SyncRequest, syncRequestSchema } from '@mezgeb/shared';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { type SyncResponse, SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  /** Always 200: each write reports its own result (ADR-010). */
  @Post()
  @HttpCode(HttpStatus.OK)
  sync(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(syncRequestSchema)) body: SyncRequest,
  ): Promise<SyncResponse> {
    return this.syncService.sync(auth, body);
  }
}
