import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/app-error.js';
import { type AuthedRequest, IS_PUBLIC } from './auth.decorators.js';
import { TokenService } from './token.service.js';

/** Global guard: every route needs a valid Bearer access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError('unauthorized', 'Missing access token', HttpStatus.UNAUTHORIZED);
    }
    req.auth = await this.tokens.verifyAccessToken(token);
    return true;
  }
}
