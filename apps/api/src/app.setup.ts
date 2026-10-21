import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { APP_CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';

/** Global app wiring shared by main.ts and the integration tests. */
export function configureApp<T extends INestApplication>(app: T): T {
  const config = app.get<AppConfig>(APP_CONFIG);
  // Behind a load balancer, req.ip must come from X-Forwarded-For for per-IP OTP limits.
  (app as unknown as NestExpressApplication).set('trust proxy', config.TRUST_PROXY);
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
