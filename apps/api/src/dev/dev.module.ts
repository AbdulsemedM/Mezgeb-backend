import { Module } from '@nestjs/common';
import { DevController } from './dev.controller.js';

/** Mounted by AppModule only when DEV_ROUTES=true; never in production. */
@Module({ controllers: [DevController] })
export class DevModule {}
