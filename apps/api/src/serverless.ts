import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { waitUntil } from '@vercel/functions';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { OutboxDispatcher } from './outbox/outbox.dispatcher.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** One app per function instance, built on the first request and reused while it stays warm. */
let ready: Promise<{ handle: Handler; outbox: OutboxDispatcher }> | undefined;

async function boot(): Promise<{ handle: Handler; outbox: OutboxDispatcher }> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.init();
  return {
    handle: app.getHttpAdapter().getInstance() as Handler,
    outbox: app.get(OutboxDispatcher),
  };
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * ADR-017: the API as a Vercel function. The outbox timer cannot run between requests, so after
 * every write the instance sends what is due once the response is out (`waitUntil`); the daily
 * cron (`/v1/cron/daily`) picks up deferred notices and retries.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  ready ??= boot().catch((err: unknown) => {
    ready = undefined;
    throw err;
  });
  const { handle, outbox } = await ready;
  if (!READS.has(req.method ?? 'GET')) {
    waitUntil(
      new Promise((resolve) => res.once('close', resolve))
        .then(() => outbox.runOnce())
        .catch((err: unknown) => console.error(`Outbox run failed: ${(err as Error).message}`)),
    );
  }
  handle(req, res);
}
