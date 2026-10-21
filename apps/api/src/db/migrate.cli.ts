import pg from 'pg';
import { parseEnv } from '../config/env.schema.js';
import { runMigrations } from './migrate.js';

const config = parseEnv(process.env);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
try {
  await runMigrations(pool);
  console.log('migrations applied');
} finally {
  await pool.end();
}
