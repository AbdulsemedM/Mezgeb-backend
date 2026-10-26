import { z } from 'zod';

export const languageSchema = z.enum(['am', 'om', 'en']);
export type Language = z.infer<typeof languageSchema>;

/** Phone as typed by the user; the server normalizes it (normalizeEthiopianPhone). */
const phoneInput = z.string().min(1).max(32);

export const otpRequestSchema = z.object({
  phone: phoneInput,
  language: languageSchema.optional(),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const deviceRegistrationSchema = z.object({
  id: z.uuid(),
  /** ECDSA P-256 public key, SPKI DER, base64 (ADR-001). */
  public_key: z.base64().max(512),
  label: z.string().max(64).optional(),
});
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;

export const verifyRequestSchema = z.object({
  phone: phoneInput,
  code: z.string().regex(/^\d{6}$/),
  device: deviceRegistrationSchema,
  /**
   * `cookie` (the PWA, ADR-016): the refresh token goes in an httpOnly cookie and never in the
   * body. Absent: the app's token flow (ADR-005).
   */
  session: z.enum(['token', 'cookie']).optional(),
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const refreshRequestSchema = z.object({
  refresh_token: z.string().min(20).max(128),
  device_id: z.uuid(),
  /** ECDSA P-256 / SHA-256, DER, base64, over `mezgeb-refresh-v1:<refresh_token>` (ADR-005). */
  device_sig: z.base64().max(256),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/** The exact string a device signs to refresh its session (ADR-005). */
export function refreshSigningInput(refreshToken: string): string {
  return `mezgeb-refresh-v1:${refreshToken}`;
}

/**
 * `POST /v1/auth/web/refresh` (ADR-016): the refresh token comes from the cookie, which the PWA
 * cannot read, so it signs the token's public id (`refresh_id` from the last sign-in or refresh).
 */
export const webRefreshRequestSchema = z.object({
  device_id: z.uuid(),
  /** ECDSA P-256 / SHA-256, DER, base64, over `mezgeb-refresh-web-v1:<refresh_id>`. */
  device_sig: z.base64().max(256),
});
export type WebRefreshRequest = z.infer<typeof webRefreshRequestSchema>;

/** The exact string the PWA signs to refresh its cookie session (ADR-016). */
export function webRefreshSigningInput(refreshId: string): string {
  return `mezgeb-refresh-web-v1:${refreshId}`;
}

/** Prefix of a Web Push subscription stored as a device's push token (ADR-016). */
export const WEB_PUSH_TOKEN_PREFIX = 'webpush:';

/** A browser's PushSubscription JSON (Web Push, RFC 8030 / 8291). */
export const webPushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({ p256dh: z.base64url().max(256), auth: z.base64url().max(64) }),
});
export type WebPushSubscription = z.infer<typeof webPushSubscriptionSchema>;

/** `PUT /v1/devices/me/push-token` (M10, ADR-015). */
export const setPushTokenSchema = z.object({ token: z.string().min(1).max(4096).nullable() });
export type SetPushToken = z.infer<typeof setPushTokenSchema>;
