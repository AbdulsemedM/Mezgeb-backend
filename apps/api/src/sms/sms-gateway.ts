import { Logger } from '@nestjs/common';

export interface SmsMessage {
  /** E.164. */
  to: string;
  /** Already rendered from an i18n template (CLAUDE.md rule 9). */
  text: string;
}

/** Outbound SMS. The real provider (ethio telecom, Safaricom or an aggregator) is still open. */
export abstract class SmsGateway {
  abstract send(message: SmsMessage): Promise<void>;
}

/** Dev/test gateway: logs each message and keeps it in memory for tests to read. */
export class ConsoleSmsGateway extends SmsGateway {
  readonly sent: SmsMessage[] = [];
  private readonly logger = new Logger('Sms');

  async send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
    this.logger.log(`SMS to ${message.to}: ${message.text}`);
  }

  /** The most recent message sent to `to`. */
  lastTo(to: string): SmsMessage | undefined {
    return this.sent.findLast((m) => m.to === to);
  }
}
