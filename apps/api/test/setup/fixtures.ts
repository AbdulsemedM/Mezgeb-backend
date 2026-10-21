import { randomUUID } from 'node:crypto';
import type { Db } from '../../src/db/db.module.js';
import * as s from '../../src/db/schema.js';

export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);
export const GENESIS = '0'.repeat(64);

let phoneCounter = 0;
/** A unique, valid Ethiopian mobile number. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `+2519${String(10_000_000 + phoneCounter).slice(-8)}`;
}

export interface SeededAccount {
  ownerId: string;
  customerId: string;
  deviceId: string;
  merchantId: string;
  accountId: string;
}

/** Owner with a device, a shop, a customer, and an active account between them. */
export async function seedAccount(db: Db): Promise<SeededAccount> {
  const ownerId = randomUUID();
  const customerId = randomUUID();
  const deviceId = randomUUID();
  const merchantId = randomUUID();
  const accountId = randomUUID();

  await db.insert(s.appUser).values([
    { id: ownerId, phone: nextPhone(), name: 'Owner' },
    { id: customerId, phone: nextPhone(), name: 'Customer' },
  ]);
  await db.insert(s.device).values({ id: deviceId, userId: ownerId, publicKey: 'cHVibGlj' });
  await db.insert(s.merchant).values({
    id: merchantId,
    ownerUserId: ownerId,
    shopName: 'Abebe Suq',
    termsAcceptedAt: new Date(),
    termsVersion: 'dube-2026-10',
    createdBy: ownerId,
  });
  await db
    .insert(s.merchantStaff)
    .values({ merchantId, userId: ownerId, role: 'owner', createdBy: ownerId });
  await db.insert(s.account).values({
    id: accountId,
    merchantId,
    customerUserId: customerId,
    status: 'active',
    termsAcceptedAt: new Date(),
    createdBy: ownerId,
  });
  return { ownerId, customerId, deviceId, merchantId, accountId };
}

let deviceSeq = 0;
/** A valid device-origin purchase; override fields to break one rule at a time. */
export function purchase(
  a: SeededAccount,
  overrides: Partial<typeof s.entry.$inferInsert> = {},
): typeof s.entry.$inferInsert {
  deviceSeq += 1;
  return {
    id: randomUUID(),
    accountId: a.accountId,
    type: 'purchase',
    amount: 12_500,
    takenByType: 'customer',
    seq: deviceSeq,
    prevHash: GENESIS,
    hash: HASH_A,
    receivedAt: new Date(),
    origin: 'device',
    deviceId: a.deviceId,
    deviceSeq,
    deviceSig: 'c2ln',
    recordedAt: new Date(),
    createdBy: a.ownerId,
    ...overrides,
  };
}

/**
 * Runs `fn` and returns the Postgres error it raised (unwrapping Drizzle's wrapper),
 * failing the test if it succeeded.
 */
export async function pgError(
  fn: () => Promise<unknown>,
): Promise<{ code: string; constraint?: string; message: string }> {
  try {
    await fn();
  } catch (err) {
    const e = (err as { cause?: unknown }).cause ?? err;
    return e as { code: string; constraint?: string; message: string };
  }
  throw new Error('expected a database error, but the statement succeeded');
}
