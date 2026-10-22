import { Module } from '@nestjs/common';
import { RepresentativesController } from './representatives.controller.js';
import { RepresentativesService } from './representatives.service.js';

/** REP-1..6 (M6). */
@Module({
  controllers: [RepresentativesController],
  providers: [RepresentativesService],
})
export class RepresentativesModule {}
