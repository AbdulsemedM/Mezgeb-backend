import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import type pg from 'pg';
import { AppError } from '../common/app-error.js';
import { Public } from '../auth/auth.decorators.js';
import { PG_POOL } from '../db/db.module.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get()
  async check(): Promise<{ status: 'ok'; db: 'ok' }> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new AppError(
        'db_unavailable',
        'Database is unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', db: 'ok' };
  }
}
