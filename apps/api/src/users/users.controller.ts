import { Body, Controller, Get, HttpStatus, Inject, Patch } from '@nestjs/common';
import { type UpdateMe, updateMeSchema } from '@mezgeb/shared';
import { eq } from 'drizzle-orm';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { toUserView, type UserView } from '../auth/otp.service.js';
import type { AuthContext } from '../auth/token.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser } from '../db/schema.js';

@Controller('me')
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  @Get()
  async me(@CurrentAuth() auth: AuthContext): Promise<UserView> {
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, auth.userId));
    if (!user) throw new AppError('not_found', 'User not found', HttpStatus.NOT_FOUND);
    return toUserView(user);
  }

  /** Name, language and calendar (ADR-003: picked at first launch, changeable later). */
  @Patch()
  async update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMe,
  ): Promise<UserView> {
    const [user] = await this.db
      .update(appUser)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.language !== undefined && { language: body.language }),
        ...(body.calendar_pref !== undefined && { calendarPref: body.calendar_pref }),
        updatedAt: this.clock.now(),
      })
      .where(eq(appUser.id, auth.userId))
      .returning();
    if (!user) throw new AppError('not_found', 'User not found', HttpStatus.NOT_FOUND);
    return toUserView(user);
  }
}
