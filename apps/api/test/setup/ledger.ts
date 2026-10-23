import { randomUUID, sign } from 'node:crypto';
import {
  buildSigningPayload,
  type CreateEntry,
  type EntryLineInput,
  type SigningInput,
  signingBytes,
} from '@mezgeb/shared';
import type { LoggedIn, TestDevice } from './auth.js';
import type { ApiResponse, TestApp } from './test-app.js';

const deviceSeqs = new Map<string, number>();

/** The next device_seq for a device, as the app's persisted counter would give it. */
export function nextDeviceSeq(device: TestDevice): number {
  const next = (deviceSeqs.get(device.id) ?? 0) + 1;
  deviceSeqs.set(device.id, next);
  return next;
}

/** Signs `body` as `device` over the ADR-001 payload for `accountId`. */
export function signEntry(
  device: TestDevice,
  accountId: string,
  body: Omit<CreateEntry, 'device_sig'>,
): CreateEntry {
  const payload = buildSigningPayload({ ...body, account_id: accountId } as SigningInput);
  const device_sig = sign('sha256', signingBytes(payload), {
    key: device.privateKey,
    dsaEncoding: 'der',
  }).toString('base64');
  return { ...body, device_sig };
}

export interface EntryOptions {
  amount?: number;
  lines?: EntryLineInput[];
  takenBy?: CreateEntry['taken_by_type'];
  /** ADR-014: a delivered order. */
  orderId?: string;
  representativeId?: string;
  reason?: string;
  recordedAt?: Date;
  id?: string;
}

/** A signed purchase by `user`'s device. Defaults: 125 ETB, taken by the customer. */
export function purchaseBody(
  t: TestApp,
  user: LoggedIn,
  accountId: string,
  o: EntryOptions = {},
): CreateEntry {
  return signEntry(user.device, accountId, {
    id: o.id ?? randomUUID(),
    type: 'purchase',
    amount: o.amount ?? 12_500,
    lines: o.lines ?? [],
    taken_by_type: o.takenBy ?? 'customer',
    representative_id: o.representativeId ?? null,
    order_id: o.orderId ?? null,
    ref_entry_id: null,
    reason: o.reason ?? null,
    device_id: user.device.id,
    device_seq: nextDeviceSeq(user.device),
    recorded_at: (o.recordedAt ?? t.clock.now()).toISOString(),
  });
}

/** A signed correction of `refEntryId` by `user`'s device. */
export function correctionBody(
  t: TestApp,
  user: LoggedIn,
  accountId: string,
  refEntryId: string,
  amount: number,
  reason = 'Wrong price',
): CreateEntry {
  return signEntry(user.device, accountId, {
    id: randomUUID(),
    type: 'correction',
    amount,
    lines: [],
    taken_by_type: null,
    representative_id: null,
    ref_entry_id: refEntryId,
    reason,
    device_id: user.device.id,
    device_seq: nextDeviceSeq(user.device),
    recorded_at: t.clock.now().toISOString(),
  });
}

export function postEntry(
  t: TestApp,
  user: LoggedIn,
  accountId: string,
  body: CreateEntry,
): Promise<ApiResponse> {
  return t.post(`/v1/accounts/${accountId}/entries`, body, { token: user.accessToken });
}

/** Records a purchase and fails the test unless it was created. */
export async function buy(
  t: TestApp,
  user: LoggedIn,
  accountId: string,
  o: EntryOptions = {},
): Promise<ApiResponse> {
  const res = await postEntry(t, user, accountId, purchaseBody(t, user, accountId, o));
  if (res.status !== 201) throw new Error(`purchase failed: ${JSON.stringify(res.body)}`);
  return res;
}
