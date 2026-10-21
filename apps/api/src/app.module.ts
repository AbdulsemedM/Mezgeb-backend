import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';
import { DbModule } from './db/db.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { HealthModule } from './health/health.module.js';
import { UsersModule } from './users/users.module.js';

@Module({})
export class AppModule {
  static forRoot(env?: Record<string, string | undefined>): DynamicModule {
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
      ],
    };
  }
}
