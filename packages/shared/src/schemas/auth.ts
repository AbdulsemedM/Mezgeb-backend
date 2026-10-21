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
