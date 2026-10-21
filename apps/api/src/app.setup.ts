import type { INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter.js';

/** Global app wiring shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
