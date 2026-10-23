import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import { type AppConfig, parseEnv } from './config/env.schema.js';
import { DbModule } from './db/db.module.js';
import { DevModule } from './dev/dev.module.js';
import { AccessModule } from './access/access.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { HealthModule } from './health/health.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { RepresentativesModule } from './representatives/representatives.module.js';
import { StatementsModule } from './statements/statements.module.js';
import { SyncModule } from './sync/sync.module.js';
import { UsersModule } from './users/users.module.js';

@Module({})
export class AppModule {
  static forRoot(env?: Record<string, string | undefined>): DynamicModule {
    const { DEV_ROUTES } = parseEnv(env ?? process.env);
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => ({
            pinoHttp: {
              level: config.LOG_LEVEL,
              redact: ['req.headers.authorization', 'req.headers.cookie'],
              transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
            },
          }),
        }),
        DbModule,
        CommonModule,
        HealthModule,
        AuthModule,
        DevicesModule,
        UsersModule,
        AccessModule,
        OutboxModule,
        MerchantsModule,
        AccountsModule,
        LedgerModule,
        PaymentsModule,
        OrdersModule,
        RepresentativesModule,
        StatementsModule,
        SyncModule,
        ...(DEV_ROUTES ? [DevModule] : []),
      ],
    };
  }
}
