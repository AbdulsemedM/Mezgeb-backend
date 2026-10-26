import { Body, Controller, HttpCode, HttpStatus, Ip, Post, Req, Res } from '@nestjs/common';
import {
  type OtpRequest,
  otpRequestSchema,
  type RefreshRequest,
  refreshRequestSchema,
  type VerifyRequest,
  verifyRequestSchema,
  type WebRefreshRequest,
  webRefreshRequestSchema,
} from '@mezgeb/shared';
import type { Request, Response } from 'express';
import { AppError } from '../common/app-error.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { CurrentAuth, Public } from './auth.decorators.js';
import { type OtpRequested, OtpService, type Verified } from './otp.service.js';
import { type AuthContext, type TokenPair, TokenService } from './token.service.js';

/** ADR-016: the PWA's refresh token lives only in this httpOnly cookie. */
export const REFRESH_COOKIE = 'mz_refresh';
const REFRESH_COOKIE_PATH = '/v1/auth';

/** A cookie session's response: everything but the refresh token itself. */
type CookieSession<T extends TokenPair> = Omit<T, 'refresh_token'>;

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

  /** `session: 'cookie'` (the PWA) sets the refresh cookie and leaves the token out of the body. */
  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodValidationPipe(verifyRequestSchema)) body: VerifyRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Verified | CookieSession<Verified>> {
    const verified = await this.otp.verify(body.phone, body.code, body.device);
    return body.session === 'cookie' ? toCookieSession(res, verified) : verified;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
  ): Promise<TokenPair> {
    return this.tokens.refresh(body.refresh_token, body.device_id, body.device_sig);
  }

  /**
   * ADR-016: the PWA's refresh. The token comes from the cookie; the device signs the token's
   * `refresh_id`, so a stolen cookie is useless without the browser's non-extractable key.
   */
  @Public()
  @Post('web/refresh')
  @HttpCode(HttpStatus.OK)
  async webRefresh(
    @Body(new ZodValidationPipe(webRefreshRequestSchema)) body: WebRefreshRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CookieSession<TokenPair>> {
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token) {
      throw new AppError('refresh_invalid', 'Refresh token is invalid', HttpStatus.UNAUTHORIZED);
    }
    const pair = await this.tokens.refresh(token, body.device_id, body.device_sig, 'web');
    return toCookieSession(res, pair);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.tokens.revokeDevice(auth);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }
}

function toCookieSession<T extends TokenPair>(res: Response, pair: T): CookieSession<T> {
  const { refresh_token, ...rest } = pair;
  res.cookie(REFRESH_COOKIE, refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires: new Date(pair.refresh_expires_at),
  });
  return rest;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
