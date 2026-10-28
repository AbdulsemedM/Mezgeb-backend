import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
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
    /**
     * Every OTP is this code instead of a random one, until a real SMS gateway exists.
     * Unset: random codes. Remove before launch.
     */
    OTP_FIXED_CODE: z
      .string()
      .regex(/^\d{6}$/, 'must be 6 digits')
      .optional(),
    /** Trust X-Forwarded-For (behind a load balancer) for per-IP OTP limits. */
    TRUST_PROXY: z.stringbool().default(false),
    /** Base URL of the customer PWA; invite links point here (ADR-006). */
    PUBLIC_WEB_URL: z.url().default('http://localhost:5173'),
    /**
     * ADR-016: extra browser origins allowed to call the API with credentials, comma separated.
     * The origin of PUBLIC_WEB_URL is always allowed.
     */
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    /**
     * ADR-016: Web Push (VAPID) keys for the PWA, base64url as printed by
     * `npx web-push generate-vapid-keys`. Unset: no web push, SMS carries everything.
     */
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    /** Contact for push services (RFC 8292), `mailto:` or `https:`. */
    VAPID_SUBJECT: z.string().min(1).default('mailto:support@mezgeb.et'),
    /** Outbox poll interval; 0 disables the in-process dispatcher (tests call runOnce). */
    OUTBOX_POLL_MS: z.coerce.number().int().min(0).default(2000),
    /**
     * ADR-015: `none` until a Firebase project exists (everything goes by SMS), `fake` keeps
     * pushes in memory (dev and tests).
     */
    PUSH_PROVIDER: z.enum(['none', 'fake']).default('none'),
    /** SMS per shop per calendar month (Addis), by plan (ADR-015). Invites are never capped. */
    SMS_CAP_FREE: z.coerce.number().int().min(0).default(300),
    SMS_CAP_SHOP: z.coerce.number().int().min(0).default(1500),
    SMS_CAP_SHOP_PLUS: z.coerce.number().int().min(0).default(5000),
    /** How often the reminders job runs; 0 disables it (tests call runOnce). */
    REMINDERS_INTERVAL_MS: z.coerce.number().int().min(0).default(3_600_000),
    /** Postgres connections per process. Serverless instances (ADR-017) keep it small. */
    DB_POOL_MAX: z.coerce.number().int().min(1).default(20),
    /**
     * ADR-017: bearer secret for `GET /v1/cron/daily` (Vercel Cron sends it). Unset: the route
     * answers 404, as on hosts where the in-process timers run.
     */
    CRON_SECRET: z.string().min(16).optional(),
    /**
     * Dev-only routes under /v1/dev (e.g. reading the last OTP for the mobile integration test).
     * Off by default and refused outside NODE_ENV=development.
     */
    DEV_ROUTES: z.stringbool().default(false),
  })
  .refine((env) => !env.DEV_ROUTES || env.NODE_ENV === 'development', {
    path: ['DEV_ROUTES'],
    message: 'DEV_ROUTES is only allowed with NODE_ENV=development',
  })
  .refine((env) => !env.VAPID_PUBLIC_KEY === !env.VAPID_PRIVATE_KEY, {
    path: ['VAPID_PRIVATE_KEY'],
    message: 'Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither',
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
