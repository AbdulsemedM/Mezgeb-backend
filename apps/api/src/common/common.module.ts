import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DisabledPushSender, FakePushSender, PushSender } from '../push/push-sender.js';
import { ConsoleSmsGateway, SmsGateway } from '../sms/sms-gateway.js';
import { Clock, SystemClock } from './clock.js';

/** App-wide services behind interfaces; tests override them (FakeClock). */
@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: SmsGateway, useClass: ConsoleSmsGateway },
    {
      provide: PushSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.PUSH_PROVIDER === 'fake' ? new FakePushSender() : new DisabledPushSender(),
    },
  ],
  exports: [Clock, SmsGateway, PushSender],
})
export class CommonModule {}
