import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { type SetPushToken, setPushTokenSchema } from '@mezgeb/shared';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/token.service.js';
import { DevicesService } from './devices.service.js';

interface DeviceView {
  id: string;
  label: string | null;
  created_at: string;
  revoked_at: string | null;
  current: boolean;
}

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext): Promise<{ devices: DeviceView[] }> {
    const rows = await this.devices.listForUser(auth.userId);
    return {
      devices: rows.map((d) => ({
        id: d.id,
        label: d.label,
        created_at: d.createdAt.toISOString(),
        revoked_at: d.revokedAt?.toISOString() ?? null,
        current: d.id === auth.deviceId,
      })),
    };
  }

  /** ADR-015: this device's FCM token (null when the app turns push off). */
  @Put('me/push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPushToken(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(setPushTokenSchema)) body: SetPushToken,
  ): Promise<void> {
    await this.devices.setPushToken(auth.userId, auth.deviceId, body.token);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.devices.revoke(auth.userId, id);
  }
}
