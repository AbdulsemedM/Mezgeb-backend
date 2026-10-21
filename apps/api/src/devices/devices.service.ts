import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DeviceRegistration } from '@mezgeb/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { DB, type Db } from '../db/db.module.js';
import { device, refreshToken } from '../db/schema.js';
import { parseDevicePublicKey } from './device-key.js';

export type DeviceRow = typeof device.$inferSelect;
/** A Db or a transaction on it. */
type Tx = Pick<Db, 'select' | 'insert' | 'update'>;

@Injectable()
export class DevicesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Throws `invalid_device_key` unless the key is ECDSA P-256 SPKI (ADR-001). */
  assertValidKey(publicKey: string): void {
    if (!parseDevicePublicKey(publicKey)) {
      throw new AppError(
        'invalid_device_key',
        'Device public key must be ECDSA P-256 (SPKI, base64)',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Registers a device for `userId`, idempotent on `reg.id` (ADR-005): the same id, user and
   * key is accepted again; anything else is a conflict. A revoked device cannot come back.
   */
  async register(tx: Tx, userId: string, reg: DeviceRegistration): Promise<DeviceRow> {
    this.assertValidKey(reg.public_key);
    const [inserted] = await tx
      .insert(device)
      .values({
        id: reg.id,
        userId,
        publicKey: reg.public_key,
        label: reg.label ?? null,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing({ target: device.id })
      .returning();
    if (inserted) return inserted;

    const [existing] = await tx.select().from(device).where(eq(device.id, reg.id));
    if (!existing || existing.userId !== userId || existing.publicKey !== reg.public_key) {
      throw new AppError(
        'device_conflict',
        'This device id is already registered with a different user or key',
        HttpStatus.CONFLICT,
      );
    }
    if (existing.revokedAt) {
      throw new AppError('device_revoked', 'This device has been revoked', HttpStatus.FORBIDDEN);
    }
    return existing;
  }

  async findById(id: string): Promise<DeviceRow | undefined> {
    const [row] = await this.db.select().from(device).where(eq(device.id, id));
    return row;
  }

  async listForUser(userId: string): Promise<DeviceRow[]> {
    return this.db.select().from(device).where(eq(device.userId, userId)).orderBy(device.createdAt);
  }

  /** Revokes the caller's own device and every refresh token bound to it. Idempotent. */
  async revoke(userId: string, deviceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(device)
        .where(and(eq(device.id, deviceId), eq(device.userId, userId)))
        .for('update');
      if (!row) throw new AppError('not_found', 'Device not found', HttpStatus.NOT_FOUND);
      const now = this.clock.now();
      if (!row.revokedAt) {
        await tx.update(device).set({ revokedAt: now }).where(eq(device.id, deviceId));
      }
      await tx
        .update(refreshToken)
        .set({ revokedAt: now })
        .where(and(eq(refreshToken.deviceId, deviceId), isNull(refreshToken.revokedAt)));
    });
  }
}
