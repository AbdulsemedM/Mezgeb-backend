import { Global, Module } from '@nestjs/common';
import { ConsoleSmsGateway, SmsGateway } from '../sms/sms-gateway.js';
import { Clock, SystemClock } from './clock.js';

/** App-wide services behind interfaces; tests override them (FakeClock). */
@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: SmsGateway, useClass: ConsoleSmsGateway },
  ],
  exports: [Clock, SmsGateway],
})
export class CommonModule {}
