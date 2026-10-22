import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { normalizeEthiopianPhone } from '@mezgeb/shared';
import { Public } from '../auth/auth.decorators.js';
import { AppError } from '../common/app-error.js';
import { ConsoleSmsGateway, SmsGateway } from '../sms/sms-gateway.js';

/**
 * Dev-only helpers, mounted only when DEV_ROUTES=true (NODE_ENV=development). They let the
 * mobile integration test on a real phone sign in against the local API.
 */
@Public()
@Controller('dev')
export class DevController {
  constructor(private readonly sms: SmsGateway) {}

  /** The 6-digit code in the last SMS the console gateway sent to `phone`. */
  @Get('otp')
  otp(@Query('phone') raw: string | undefined): { phone: string; code: string } {
    const phone = normalizeEthiopianPhone(raw ?? '');
    if (!phone) {
      throw new AppError('invalid_phone', 'Not an Ethiopian mobile number', HttpStatus.BAD_REQUEST);
    }
    const text = this.sms instanceof ConsoleSmsGateway ? this.sms.lastTo(phone)?.text : undefined;
    const code = text ? /\b(\d{6})\b/.exec(text)?.[1] : undefined;
    if (!code)
      throw new AppError('not_found', 'No code was sent to this phone', HttpStatus.NOT_FOUND);
    return { phone, code };
  }
}
