import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule.forRoot(), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.PORT);
}

void bootstrap();
