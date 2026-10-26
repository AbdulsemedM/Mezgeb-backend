import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { refreshSigningInput, uuidv7, webRefreshSigningInput } from '@mezgeb/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DB, type Db } from '../db/db.module.js';
import { device, refreshToken } from '../db/schema.js';
import { verifyDeviceSignature } from '../devices/device-key.js';

export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60_000;
/** A reused token whose successor is unused gets a second rotation within this window (ADR-005). */
export const REFRESH_RETRY_GRACE_MS = 2 * 60_000;

export interface AuthContext {
  userId: string;
  deviceId: string;
}

export interface TokenPair {
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
  /** Public id of the refresh token; the PWA signs it to refresh its cookie session (ADR-016). */
  refresh_id: string;
}

/**
 * What the device signed: the token itself (the app, ADR-005), or the token's id (the PWA,
 * whose token sits in an httpOnly cookie it cannot read, ADR-016).
 */
export type RefreshProof = 'token' | 'web';

type Tx = Pick<Db, 'insert' | 'update'>;

const unauthorized = (code: string, message: string) =>
  new AppError(code, message, HttpStatus.UNAUTHORIZED);

@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly clock: Clock,
  ) {
    this.secret = new TextEncoder().encode(config.JWT_SECRET);
  }

  /** Issues a new pair for a fresh login, starting a new refresh-token family. */
  async issueForLogin(tx: Tx, auth: AuthContext): Promise<TokenPair> {
    return this.issuePair(tx, auth, uuidv7(this.clock.now().getTime()));
  }

  async verifyAccessToken(token: string): Promise<AuthContext> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      if (typeof payload.sub !== 'string' || typeof payload.did !== 'string') {
        throw unauthorized('unauthorized', 'Invalid access token');
      }
      return { userId: payload.sub, deviceId: payload.did };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        throw unauthorized('token_expired', 'Access token expired');
      }
      if (err instanceof AppError) throw err;
      throw unauthorized('unauthorized', 'Invalid access token');
    }
  }

  /**
   * Rotates a refresh token (ADR-005). The device signature is checked before anything else,
   * so a stolen token without the device key cannot even trigger reuse revocation.
   */
  async refresh(
    token: string,
    deviceId: string,
    deviceSig: string,
    proof: RefreshProof = 'token',
  ): Promise<TokenPair> {
    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshToken)
        .where(eq(refreshToken.tokenHash, sha256(token)))
        .for('update');
      if (!row || row.deviceId !== deviceId) {
        return { error: unauthorized('refresh_invalid', 'Refresh token is invalid') };
      }

      const [dev] = await tx.select().from(device).where(eq(device.id, deviceId));
      if (!dev || dev.revokedAt) {
        return { error: unauthorized('device_revoked', 'This device has been revoked') };
      }
      const signed = proof === 'web' ? webRefreshSigningInput(row.id) : refreshSigningInput(token);
      if (!verifyDeviceSignature(dev.publicKey, signed, deviceSig)) {
        return { error: unauthorized('refresh_invalid', 'Device signature is invalid') };
      }

      const now = this.clock.now();
      if (row.revokedAt) {
        return { error: unauthorized('refresh_invalid', 'Refresh token is invalid') };
      }
      if (now >= row.expiresAt) {
        return { error: unauthorized('refresh_expired', 'Refresh token expired') };
      }

      const auth = { userId: row.userId, deviceId: row.deviceId };
      if (row.usedAt) {
        const [successor] = row.replacedById
          ? await tx
              .select()
              .from(refreshToken)
              .where(eq(refreshToken.id, row.replacedById))
              .for('update')
          : [];
        const lostResponse =
          now.getTime() - row.usedAt.getTime() < REFRESH_RETRY_GRACE_MS &&
          successor !== undefined &&
          !successor.usedAt &&
          !successor.revokedAt;
        if (!lostResponse) {
          await tx
            .update(refreshToken)
            .set({ revokedAt: now })
            .where(and(eq(refreshToken.familyId, row.familyId), isNull(refreshToken.revokedAt)));
          return {
            error: unauthorized('refresh_reused', 'Refresh token was already used; signed out'),
          };
        }
        await tx
          .update(refreshToken)
          .set({ revokedAt: now })
          .where(eq(refreshToken.id, successor.id));
      }

      const pair = await this.issuePair(tx, auth, row.familyId, row.id);
      return { pair };
    });

    if ('error' in outcome) throw outcome.error;
    return outcome.pair;
  }

  /** Signs out one device: revokes every live refresh token bound to it. */
  async revokeDevice(auth: AuthContext): Promise<void> {
    await this.db
      .update(refreshToken)
      .set({ revokedAt: this.clock.now() })
      .where(
        and(
          eq(refreshToken.userId, auth.userId),
          eq(refreshToken.deviceId, auth.deviceId),
          isNull(refreshToken.revokedAt),
        ),
      );
  }

  private async issuePair(
    tx: Tx,
    auth: AuthContext,
    familyId: string,
    rotatedFromId?: string,
  ): Promise<TokenPair> {
    const now = this.clock.now();
    const accessExpires = new Date(now.getTime() + ACCESS_TTL_MS);
    const refreshExpires = new Date(now.getTime() + REFRESH_TTL_MS);

    const access = await new SignJWT({ did: auth.deviceId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(auth.userId)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(accessExpires.getTime() / 1000))
      .sign(this.secret);

    const refresh = randomBytes(32).toString('base64url');
    const id = uuidv7(now.getTime());
    await tx.insert(refreshToken).values({
      id,
      userId: auth.userId,
      deviceId: auth.deviceId,
      familyId,
      tokenHash: sha256(refresh),
      createdAt: now,
      expiresAt: refreshExpires,
    });
    if (rotatedFromId) {
      // Keep the first used_at: the retry grace window runs from the first rotation.
      await tx
        .update(refreshToken)
        .set({ usedAt: sql`coalesce(${refreshToken.usedAt}, ${now})`, replacedById: id })
        .where(eq(refreshToken.id, rotatedFromId));
    }

    return {
      access_token: access,
      access_expires_at: accessExpires.toISOString(),
      refresh_token: refresh,
      refresh_expires_at: refreshExpires.toISOString(),
      refresh_id: id,
    };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
