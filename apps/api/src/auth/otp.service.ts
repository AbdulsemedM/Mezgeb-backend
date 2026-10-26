import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type DeviceRegistration,
  type Language,
  normalizeEthiopianPhone,
  uuidv7,
} from '@mezgeb/shared';
import { and, count, desc, eq, gt, max, min, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DB, type Db } from '../db/db.module.js';
import { appUser, otpChallenge } from '../db/schema.js';
import { DevicesService } from '../devices/devices.service.js';
import { t } from '../i18n/messages.js';
import { SmsGateway } from '../sms/sms-gateway.js';
import { type TokenPair, TokenService } from './token.service.js';

/** ADR-005 limits. */
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_MS = 60_000;
export const OTP_PER_PHONE_PER_HOUR = 5;
export const OTP_PER_IP_PER_HOUR = 20;
const HOUR_MS = 60 * 60_000;

export interface OtpRequested {
  expires_at: string;
  resend_after_s: number;
}

export interface UserView {
  id: string;
  phone: string;
  name: string | null;
  language: Language;
  calendar_pref: 'ethiopian' | 'gregorian' | null;
}

export interface Verified extends TokenPair {
  user: UserView;
  is_new_user: boolean;
}

@Injectable()
export class OtpService {
  private readonly pepper: string;
  /** ADR-016: the PWA's host, for the WebOTP line Android Chrome reads (`@host #code`). */
  private readonly webOtpHost: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly clock: Clock,
    private readonly sms: SmsGateway,
    private readonly devices: DevicesService,
    private readonly tokens: TokenService,
  ) {
    this.pepper = config.OTP_PEPPER;
    this.webOtpHost = new URL(config.PUBLIC_WEB_URL).host;
  }

  /** Sends a code. Answers the same whether or not the phone has an account. */
  async request(
    rawPhone: string,
    language: Language | undefined,
    ip: string,
  ): Promise<OtpRequested> {
    const phone = normalizePhone(rawPhone);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    const smsLanguage = await this.db.transaction(async (tx) => {
      // Serialize requests for one phone so parallel calls cannot slip past the limits.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'otp:' + phone}))`);
      const hourAgo = new Date(now.getTime() - HOUR_MS);

      const [byPhone] = await tx
        .select({
          n: count(),
          oldest: min(otpChallenge.createdAt),
          latest: max(otpChallenge.createdAt),
        })
        .from(otpChallenge)
        .where(and(eq(otpChallenge.phone, phone), gt(otpChallenge.createdAt, hourAgo)));
      if (byPhone?.latest && byPhone.n > 0) {
        const latest = byPhone.latest;
        const sinceLatest = now.getTime() - latest.getTime();
        if (sinceLatest < OTP_RESEND_AFTER_MS) throw rateLimited(OTP_RESEND_AFTER_MS - sinceLatest);
        if (byPhone.n >= OTP_PER_PHONE_PER_HOUR && byPhone.oldest) {
          throw rateLimited(byPhone.oldest.getTime() + HOUR_MS - now.getTime());
        }
      }

      const [byIp] = await tx
        .select({ n: count(), oldest: min(otpChallenge.createdAt) })
        .from(otpChallenge)
        .where(and(eq(otpChallenge.ip, ip), gt(otpChallenge.createdAt, hourAgo)));
      if (byIp && byIp.n >= OTP_PER_IP_PER_HOUR && byIp.oldest) {
        throw rateLimited(byIp.oldest.getTime() + HOUR_MS - now.getTime());
      }

      await tx.insert(otpChallenge).values({
        id: uuidv7(now.getTime()),
        phone,
        codeHash: this.hash(phone, code),
        ip,
        language: language ?? null,
        expiresAt,
        createdAt: now,
      });

      const [user] = await tx
        .select({ language: appUser.language })
        .from(appUser)
        .where(eq(appUser.phone, phone));
      return user?.language ?? language ?? 'am';
    });

    await this.sms.send({
      to: phone,
      text: `${t('sms.otp', smsLanguage, { code, minutes: OTP_TTL_MS / 60_000 })}\n\n@${this.webOtpHost} #${code}`,
    });
    return {
      expires_at: expiresAt.toISOString(),
      resend_after_s: OTP_RESEND_AFTER_MS / 1000,
    };
  }

  /**
   * Checks the code against the phone's latest challenge, then signs the user in on `device`.
   * A wrong code is counted even though the request fails, so the attempt is committed first.
   */
  async verify(rawPhone: string, code: string, reg: DeviceRegistration): Promise<Verified> {
    const phone = normalizePhone(rawPhone);
    this.devices.assertValidKey(reg.public_key);
    const now = this.clock.now();

    const outcome = await this.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(otpChallenge)
        .where(eq(otpChallenge.phone, phone))
        .orderBy(desc(otpChallenge.createdAt))
        .limit(1)
        .for('update');

      if (!challenge || challenge.consumedAt) {
        return { error: otpError('otp_invalid', 'Code is invalid; request a new one') };
      }
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        return { error: otpError('otp_locked', 'Too many wrong attempts; request a new code') };
      }
      if (now >= challenge.expiresAt) {
        return { error: otpError('otp_expired', 'Code expired; request a new one') };
      }
      if (!this.matches(challenge.codeHash, phone, code)) {
        const attempts = challenge.attempts + 1;
        await tx.update(otpChallenge).set({ attempts }).where(eq(otpChallenge.id, challenge.id));
        return attempts >= OTP_MAX_ATTEMPTS
          ? { error: otpError('otp_locked', 'Too many wrong attempts; request a new code') }
          : {
              error: otpError('otp_invalid', 'Code is incorrect', {
                attempts_left: OTP_MAX_ATTEMPTS - attempts,
              }),
            };
      }

      await tx
        .update(otpChallenge)
        .set({ consumedAt: now })
        .where(eq(otpChallenge.id, challenge.id));

      const [created] = await tx
        .insert(appUser)
        .values({
          id: uuidv7(now.getTime()),
          phone,
          language: challenge.language ?? 'am',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: appUser.phone })
        .returning();
      const existing =
        created ?? (await tx.select().from(appUser).where(eq(appUser.phone, phone)))[0]!;
      // A user created by an invite has no verified phone yet; this is their first sign-in.
      const isNewUser = existing.phoneVerifiedAt === null;
      const user = isNewUser
        ? (
            await tx
              .update(appUser)
              .set({ phoneVerifiedAt: now, updatedAt: now })
              .where(eq(appUser.id, existing.id))
              .returning()
          )[0]!
        : existing;

      // Device errors (conflict, revoked) roll the whole sign-in back, OTP included.
      const dev = await this.devices.register(tx, user.id, reg);
      const pair = await this.tokens.issueForLogin(tx, { userId: user.id, deviceId: dev.id });
      return { verified: { ...pair, user: toUserView(user), is_new_user: isNewUser } };
    });

    if ('error' in outcome) throw outcome.error;
    return outcome.verified;
  }

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.pepper).update(`${phone}:${code}`).digest('hex');
  }

  private matches(storedHex: string, phone: string, code: string): boolean {
    return timingSafeEqual(
      Buffer.from(storedHex, 'hex'),
      Buffer.from(this.hash(phone, code), 'hex'),
    );
  }
}

export function toUserView(user: typeof appUser.$inferSelect): UserView {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    language: user.language,
    calendar_pref: user.calendarPref,
  };
}

function normalizePhone(raw: string): string {
  const phone = normalizeEthiopianPhone(raw);
  if (!phone) {
    throw new AppError(
      'invalid_phone',
      'Enter an Ethiopian mobile number (09… or 07…)',
      HttpStatus.BAD_REQUEST,
    );
  }
  return phone;
}

function rateLimited(retryAfterMs: number): AppError {
  return new AppError(
    'otp_rate_limited',
    'Too many code requests; try again later',
    HttpStatus.TOO_MANY_REQUESTS,
    { retry_after_s: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
  );
}

function otpError(code: string, message: string, details?: unknown): AppError {
  return new AppError(code, message, HttpStatus.UNAUTHORIZED, details);
}
