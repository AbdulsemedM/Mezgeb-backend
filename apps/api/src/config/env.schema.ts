import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  /** HS256 key for access tokens (ADR-005). */
  JWT_SECRET: z.string().min(32),
  /** HMAC key for OTP codes at rest. */
  OTP_PEPPER: z.string().min(32),
  /** Trust X-Forwarded-For (behind a load balancer) for per-IP OTP limits. */
  TRUST_PROXY: z.stringbool().default(false),
  /** Base URL of the customer PWA; invite links point here (ADR-006). */
  PUBLIC_WEB_URL: z.url().default('http://localhost:5173'),
  /** Outbox poll interval; 0 disables the in-process dispatcher (tests call runOnce). */
  OUTBOX_POLL_MS: z.coerce.number().int().min(0).default(2000),
});

export type AppConfig = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n  ${issues.join('\n  ')}`);
    this.name = 'InvalidEnvError';
  }
}

/** Parses and validates the environment. Throws InvalidEnvError listing every bad variable. */
export function parseEnv(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new InvalidEnvError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
