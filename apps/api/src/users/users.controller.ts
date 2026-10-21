import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { toUserView, type UserView } from '../auth/otp.service.js';
import type { AuthContext } from '../auth/token.service.js';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser } from '../db/schema.js';

@Controller('me')
export class UsersController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async me(@CurrentAuth() auth: AuthContext): Promise<UserView> {
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, auth.userId));
    if (!user) throw new AppError('not_found', 'User not found', HttpStatus.NOT_FOUND);
    return toUserView(user);
  }
}
