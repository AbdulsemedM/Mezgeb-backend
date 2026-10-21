import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from './token.service.js';

export const IS_PUBLIC = 'mezgeb:isPublic';

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}

/** The caller's `{ userId, deviceId }`, set by JwtAuthGuard. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) throw new Error('CurrentAuth used on a public route');
    return auth;
  },
);
