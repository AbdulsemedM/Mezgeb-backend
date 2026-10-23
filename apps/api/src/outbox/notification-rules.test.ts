import { describe, expect, it } from 'vitest';
import { afterQuietHours, NOTIFICATION_RULES, startOfAddisMonth } from './notification-rules.js';

describe('notifications matrix (spec, ADR-015)', () => {
  // One row per matrix line: [event, channel] where "Push, SMS" is `both` and push-only or
  // "Push, SMS fallback" is `push` (SMS when the person has no push token).
  it.each([
    ['customer_invited', 'sms'],
    ['purchase_recorded', 'push'],
    ['representative_receipt', 'sms'],
    ['correction_recorded', 'push'],
    ['entry_disputed', 'push'],
    ['limit_80', 'push'],
    ['limit_100', 'both'],
    ['limit_override_used', 'both'],
    ['due_soon', 'push'],
    ['due_today', 'both'],
    ['payme_sent', 'both'],
    ['payment_reported', 'push'],
    ['payment_confirmed', 'both'],
    ['payment_rejected', 'both'],
    ['representative_added', 'both'],
    ['representative_revoked', 'both'],
    ['limit_changed', 'push'],
    ['order_received', 'push'],
    ['order_priced', 'push'],
    ['order_out', 'push'],
  ] as const)('%s goes by %s', (event, channel) => {
    expect(NOTIFICATION_RULES[event].channel).toBe(channel);
  });

  it('a new delivery order rings; invites are never capped', () => {
    expect(NOTIFICATION_RULES.order_received.sound).toBe(true);
    expect(NOTIFICATION_RULES.customer_invited.uncapped).toBe(true);
  });

  it('money changes ignore quiet hours; reminders and notices wait', () => {
    for (const e of ['purchase_recorded', 'payment_recorded', 'limit_override_used'] as const) {
      expect(NOTIFICATION_RULES[e].urgent).toBe(true);
    }
    for (const e of ['payme_sent', 'due_soon', 'entry_disputed', 'order_received'] as const) {
      expect(NOTIFICATION_RULES[e].urgent).toBe(false);
    }
  });
});

describe('quiet hours 21:00–07:00 Addis (UTC+3)', () => {
  it('daytime: now', () => {
    const noon = new Date('2026-10-22T09:00:00.000Z'); // 12:00 Addis
    expect(afterQuietHours(noon)).toEqual(noon);
  });

  it('evening: next morning 07:00 Addis', () => {
    expect(afterQuietHours(new Date('2026-10-22T19:30:00.000Z'))).toEqual(
      new Date('2026-10-23T04:00:00.000Z'),
    );
  });

  it('after midnight: the same morning', () => {
    expect(afterQuietHours(new Date('2026-10-22T23:00:00.000Z'))).toEqual(
      new Date('2026-10-23T04:00:00.000Z'),
    );
  });

  it('exactly 07:00 is allowed; exactly 21:00 waits', () => {
    expect(afterQuietHours(new Date('2026-10-23T04:00:00.000Z'))).toEqual(
      new Date('2026-10-23T04:00:00.000Z'),
    );
    expect(afterQuietHours(new Date('2026-10-22T18:00:00.000Z'))).toEqual(
      new Date('2026-10-23T04:00:00.000Z'),
    );
  });

  it('the SMS month starts at midnight Addis on the 1st', () => {
    expect(startOfAddisMonth(new Date('2026-11-01T01:00:00.000Z'))).toEqual(
      new Date('2026-10-31T21:00:00.000Z'),
    );
  });
});
