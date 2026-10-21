import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DevicesModule } from '../devices/devices.module.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt.guard.js';
import { OtpService } from './otp.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [DevicesModule],
  controllers: [AuthController],
  providers: [OtpService, TokenService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [TokenService],
})
export class AuthModule {}
