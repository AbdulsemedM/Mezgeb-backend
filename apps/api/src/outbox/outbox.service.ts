import { Injectable } from '@nestjs/common';
import { type Language, uuidv7 } from '@mezgeb/shared';
import { Clock } from '../common/clock.js';
import type { Db } from '../db/db.module.js';
import { notification } from '../db/schema.js';
import type { MessageKey } from '../i18n/messages.js';

export interface SmsNotice {
  userId: string | null;
  phone: string;
  /** Event name from the notifications matrix, e.g. `customer_invited`. */
  event: string;
  template: MessageKey;
  params: Record<string, string | number>;
  language: Language;
}

/** Payload stored on an outbox row; rendered by the dispatcher at send time. */
export interface SmsPayload {
  template: MessageKey;
  params: Record<string, string | number>;
  language: Language;
}

/** Writes notifications in the caller's transaction, so they exist iff the change committed. */
@Injectable()
export class OutboxService {
  constructor(private readonly clock: Clock) {}

  async enqueueSms(tx: Pick<Db, 'insert'>, n: SmsNotice): Promise<string> {
    const now = this.clock.now();
    const id = uuidv7(now.getTime());
    const payload: SmsPayload = { template: n.template, params: n.params, language: n.language };
    await tx.insert(notification).values({
      id,
      userId: n.userId,
      phone: n.phone,
      event: n.event,
      payload,
      channel: 'sms',
      scheduledFor: now,
      createdAt: now,
    });
    return id;
  }
}
