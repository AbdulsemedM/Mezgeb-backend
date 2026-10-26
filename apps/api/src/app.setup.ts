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
  // M12: do not advertise the framework.
  (app as unknown as NestExpressApplication).disable('x-powered-by');
  // ADR-016: the PWA calls the API from its own origin with the refresh cookie.
  app.enableCors({
    origin: [new URL(config.PUBLIC_WEB_URL).origin, ...config.CORS_ORIGINS],
    credentials: true,
    maxAge: 86_400,
  });
  // ADR-016: receipt photos arrive as raw image bodies (the service checks size and type).
  (app as unknown as NestExpressApplication).useBodyParser('raw', {
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: '1mb',
  });
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
