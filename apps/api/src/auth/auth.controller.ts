import { Body, Controller, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import {
  type OtpRequest,
  otpRequestSchema,
  type RefreshRequest,
  refreshRequestSchema,
  type VerifyRequest,
  verifyRequestSchema,
} from '@mezgeb/shared';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { CurrentAuth, Public } from './auth.decorators.js';
import { type OtpRequested, OtpService, type Verified } from './otp.service.js';
import { type AuthContext, type TokenPair, TokenService } from './token.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('otp')
  @HttpCode(HttpStatus.ACCEPTED)
  requestOtp(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequest,
    @Ip() ip: string,
  ): Promise<OtpRequested> {
    return this.otp.request(body.phone, body.language, ip);
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body(new ZodValidationPipe(verifyRequestSchema)) body: VerifyRequest): Promise<Verified> {
    return this.otp.verify(body.phone, body.code, body.device);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
  ): Promise<TokenPair> {
    return this.tokens.refresh(body.refresh_token, body.device_id, body.device_sig);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.tokens.revokeDevice(auth);
  }
}
