import { type DynamicModule, Global, Module } from '@nestjs/common';
import { parseEnv } from './env.schema.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class ConfigModule {
  /** Reads `env` (default: process.env) once at startup. Nothing else reads process.env. */
  static forRoot(env: Record<string, string | undefined> = process.env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: parseEnv(env) }],
      exports: [APP_CONFIG],
    };
  }
}
