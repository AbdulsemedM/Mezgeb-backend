import {
  Body,
  Controller,
  Inject,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  type SetPushToken,
  setPushTokenSchema,
  WEB_PUSH_TOKEN_PREFIX,
  webPushSubscriptionSchema,
} from '@mezgeb/shared';
import { AppError } from '../common/app-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
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
  constructor(
    private readonly devices: DevicesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** ADR-016: the VAPID public key the PWA subscribes with; null when web push is off. */
  @Public()
  @Get('web-push-key')
  webPushKey(): { vapid_public_key: string | null } {
    return { vapid_public_key: this.config.VAPID_PUBLIC_KEY ?? null };
  }

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

  /**
   * ADR-015: this device's FCM token (null when the app turns push off). ADR-016: the PWA sends
   * `webpush:` + its PushSubscription JSON.
   */
  @Put('me/push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPushToken(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(setPushTokenSchema)) body: SetPushToken,
  ): Promise<void> {
    if (body.token?.startsWith(WEB_PUSH_TOKEN_PREFIX)) assertWebPushToken(body.token);
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

function assertWebPushToken(token: string): void {
  let json: unknown;
  try {
    json = JSON.parse(token.slice(WEB_PUSH_TOKEN_PREFIX.length));
  } catch {
    json = undefined;
  }
  if (!webPushSubscriptionSchema.safeParse(json).success) {
    throw new AppError(
      'invalid_push_token',
      'A web push token must be a PushSubscription with endpoint and keys',
      HttpStatus.BAD_REQUEST,
    );
  }
}
