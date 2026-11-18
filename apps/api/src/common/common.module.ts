import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { DisabledPushSender, FakePushSender, PushSender } from '../push/push-sender.js';
import { RoutingPushSender, WebPushSender } from '../push/web-push-sender.js';
import { ObjectStorage, S3ObjectStorage } from '../storage/object-storage.js';
import { CoopbankSmsGateway } from '../sms/coopbank-sms-gateway.js';
import { QueueSmsGateway } from '../sms/queue-sms-gateway.js';
import { ConsoleSmsGateway, SmsGateway } from '../sms/sms-gateway.js';
import { Clock, SystemClock } from './clock.js';

/** App-wide services behind interfaces; tests override them (FakeClock). */
@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    {
      provide: SmsGateway,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SmsGateway => {
        switch (config.SMS_PROVIDER) {
          case 'coopbank':
            return new CoopbankSmsGateway({
              tokenUrl: config.COOPBANK_SMS_TOKEN_URL,
              sendUrl: config.COOPBANK_SMS_SEND_URL,
              clientId: config.COOPBANK_SMS_CLIENT_ID!,
              clientSecret: config.COOPBANK_SMS_CLIENT_SECRET!,
            });
          case 'queue':
            return new QueueSmsGateway({
              url: config.UPSTASH_REDIS_REST_URL!,
              token: config.UPSTASH_REDIS_REST_TOKEN!,
              key: config.SMS_QUEUE_KEY,
            });
          case 'console':
            return new ConsoleSmsGateway();
        }
      },
    },
    {
      provide: ObjectStorage,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new S3ObjectStorage(config),
    },
    {
      provide: PushSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new RoutingPushSender(
          config.PUSH_PROVIDER === 'fake' ? new FakePushSender() : new DisabledPushSender(),
          config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
            ? new WebPushSender({
                publicKey: config.VAPID_PUBLIC_KEY,
                privateKey: config.VAPID_PRIVATE_KEY,
                subject: config.VAPID_SUBJECT,
              })
            : null,
        ),
    },
  ],
  exports: [Clock, SmsGateway, PushSender, ObjectStorage],
})
export class CommonModule {}
