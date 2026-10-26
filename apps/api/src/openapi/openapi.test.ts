import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { listRoutes } from './routes.js';

describe('OpenAPI (M12)', () => {
  it('docs/api/openapi.json matches the code (run `pnpm --filter @mezgeb/api openapi`)', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../../../../docs/api/openapi.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApi())));
  });

  it('every write with a body validates it with a shared zod schema', () => {
    const unvalidated = listRoutes().filter(
      (r) =>
        ['post', 'put', 'patch'].includes(r.method) &&
        !r.body &&
        // Bodiless actions: the path says everything. A receipt is a raw image (ADR-016).
        !/\/(accept|confirm|logout|seen|receipt)$/.test(r.path),
    );
    expect(unvalidated.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  // ADR-016 adds the invite screen and the VAPID key, both shown before sign-in.
  it('only sign-in, health, invite codes and the web push key are public', () => {
    expect(
      listRoutes()
        .filter((r) => r.public)
        .map((r) => r.path),
    ).toEqual(expect.arrayContaining(['/v1/health', '/v1/auth/otp', '/v1/auth/verify']));
    for (const r of listRoutes().filter((x) => x.public)) {
      expect(r.path).toMatch(/^\/v1\/(health|auth\/|invites\/\{code\}$|devices\/web-push-key$)/);
    }
  });
});
