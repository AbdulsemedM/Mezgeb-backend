import { Logger } from '@nestjs/common';

/** One push to one app user's devices (ADR-015). */
export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  /** For the app: the event, ids to open, and the account head `{seq, hash}` (ADR-001). */
  data: Record<string, string>;
  /** New delivery orders ring (the notifications matrix "push with sound"). */
  sound: boolean;
}

/** FCM behind an interface (CLAUDE.md conventions). */
export abstract class PushSender {
  /** False when no push provider is configured: every notice then goes by SMS. */
  abstract readonly enabled: boolean;

  /** Tokens the provider says are no longer valid (the app was removed). */
  abstract send(message: PushMessage): Promise<{ invalidTokens: string[] }>;

  /** Whether this sender can deliver to `token` (an FCM token or a Web Push subscription). */
  accepts(_token: string): boolean {
    return this.enabled;
  }
}

/** No Firebase project yet: push is off and SMS carries everything. */
export class DisabledPushSender extends PushSender {
  readonly enabled = false;

  async send(): Promise<{ invalidTokens: string[] }> {
    throw new Error('Push is not configured (PUSH_PROVIDER=none)');
  }
}

/** Dev and tests: keeps pushes in memory. Tokens starting with `dead-` are reported invalid. */
export class FakePushSender extends PushSender {
  readonly enabled = true;
  readonly sent: PushMessage[] = [];
  private readonly logger = new Logger('Push');

  async send(message: PushMessage): Promise<{ invalidTokens: string[] }> {
    this.sent.push(message);
    this.logger.log(`push to ${message.tokens.length} device(s): ${message.body}`);
    return { invalidTokens: message.tokens.filter((t) => t.startsWith('dead-')) };
  }
}
