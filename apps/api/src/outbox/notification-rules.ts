/**
 * The notifications matrix (spec "Notifications matrix", ADR-015), one row per event:
 * - `both`: push and SMS (the matrix's "Push, SMS");
 * - `push`: push when the person has the app with a push token, else SMS (the matrix's
 *   "Push, SMS fallback" and, while FCM is not set up, its push-only rows too);
 * - `sms`: SMS only.
 * `urgent` notices ignore quiet hours; the rest wait until 07:00 Addis time. `uncapped` SMS are
 * sent even past the shop's monthly SMS cap.
 */
export interface NotificationRule {
  channel: 'both' | 'push' | 'sms';
  urgent: boolean;
  uncapped?: boolean;
  /** Push title key and sound. */
  sound?: boolean;
}

export const NOTIFICATION_RULES = {
  customer_invited: { channel: 'sms', urgent: false, uncapped: true },
  purchase_recorded: { channel: 'push', urgent: true },
  representative_receipt: { channel: 'sms', urgent: true },
  representative_inactive_entry: { channel: 'push', urgent: true },
  correction_recorded: { channel: 'push', urgent: true },
  entry_disputed: { channel: 'push', urgent: false },
  correction_requested: { channel: 'push', urgent: false },
  limit_80: { channel: 'push', urgent: false },
  limit_100: { channel: 'both', urgent: true },
  representative_limit: { channel: 'both', urgent: true },
  limit_override_used: { channel: 'both', urgent: true },
  due_soon: { channel: 'push', urgent: false },
  due_today: { channel: 'both', urgent: false },
  payme_sent: { channel: 'both', urgent: false },
  payment_recorded: { channel: 'both', urgent: true },
  payment_reported: { channel: 'push', urgent: false },
  payment_report_reminder: { channel: 'push', urgent: false },
  payment_confirmed: { channel: 'both', urgent: true },
  payment_rejected: { channel: 'both', urgent: true },
  representative_added: { channel: 'both', urgent: false },
  representative_revoked: { channel: 'both', urgent: false },
  limit_changed: { channel: 'push', urgent: false },
  order_received: { channel: 'push', urgent: false, sound: true },
  order_priced: { channel: 'push', urgent: true },
  order_out: { channel: 'push', urgent: true },
  order_declined: { channel: 'push', urgent: true },
} as const satisfies Record<string, NotificationRule>;

export type NotificationEvent = keyof typeof NOTIFICATION_RULES;

/** ADR-007: Addis Ababa is UTC+3 all year. */
const ADDIS_OFFSET_MS = 3 * 60 * 60_000;
const QUIET_FROM_HOUR = 21;
const QUIET_UNTIL_HOUR = 7;

/** When a non-urgent notice may go out: now, or 07:00 Addis time after quiet hours. */
export function afterQuietHours(now: Date): Date {
  const local = new Date(now.getTime() + ADDIS_OFFSET_MS);
  const hour = local.getUTCHours();
  if (hour >= QUIET_UNTIL_HOUR && hour < QUIET_FROM_HOUR) return now;
  const morning = new Date(local);
  morning.setUTCHours(QUIET_UNTIL_HOUR, 0, 0, 0);
  if (hour >= QUIET_FROM_HOUR) morning.setUTCDate(morning.getUTCDate() + 1);
  return new Date(morning.getTime() - ADDIS_OFFSET_MS);
}

/** The first instant of the current calendar month in Addis Ababa, for the SMS cap. */
export function startOfAddisMonth(now: Date): Date {
  const local = new Date(now.getTime() + ADDIS_OFFSET_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(start - ADDIS_OFFSET_MS);
}
