/** Session strings shared by the API, the app and the PWA. No zod here: the PWA bundles this. */

/** The exact string a device signs to refresh its session (ADR-005). */
export function refreshSigningInput(refreshToken: string): string {
  return `mezgeb-refresh-v1:${refreshToken}`;
}

/** The exact string the PWA signs to refresh its cookie session (ADR-016). */
export function webRefreshSigningInput(refreshId: string): string {
  return `mezgeb-refresh-web-v1:${refreshId}`;
}

/** Prefix of a Web Push subscription stored as a device's push token (ADR-016). */
export const WEB_PUSH_TOKEN_PREFIX = 'webpush:';
