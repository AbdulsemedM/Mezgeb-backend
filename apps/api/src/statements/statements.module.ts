import { Module } from '@nestjs/common';
import { StatementsController } from './statements.controller.js';
import { StatementsService } from './statements.service.js';

/** Statements (M11, LED-7). */
@Module({
  controllers: [StatementsController],
  providers: [StatementsService],
})
export class StatementsModule {}
