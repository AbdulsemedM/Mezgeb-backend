import { z } from 'zod';
import { listRoutes, type RouteInfo } from './routes.js';

const ERROR = {
  description: 'Error: `{ code, message, details? }` (CLAUDE.md conventions)',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['code', 'message'],
        properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
      },
    },
  },
};

function jsonSchema(schema: z.ZodType): unknown {
  // Input shape: what clients send (defaults optional), without the draft marker.
  const { $schema: _draft, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return rest;
}

function operation(r: RouteInfo): Record<string, unknown> {
  const parameters: unknown[] = [...r.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  if (r.query) {
    const q = jsonSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
    for (const [name, schema] of Object.entries(q.properties ?? {})) {
      parameters.push({ name, in: 'query', required: q.required?.includes(name) ?? false, schema });
    }
  }
  return {
    operationId: `${r.controller.replace(/Controller$/, '')}.${r.handler}`,
    ...(r.public ? { security: [] } : {}),
    ...(r.accountAction && { 'x-account-action': r.accountAction }),
    ...(r.merchantAction && { 'x-merchant-action': r.merchantAction }),
    ...(parameters.length > 0 && { parameters }),
    ...(r.body && {
      requestBody: {
        required: true,
        content: { 'application/json': { schema: jsonSchema(r.body) } },
      },
    }),
    responses: { default: ERROR, '2XX': { description: 'Success' } },
  };
}

/**
 * The OpenAPI 3.1 document of the API (M12), generated from the controllers and their zod
 * schemas. Response bodies are described in the ADRs; requests are exact.
 */
export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of listRoutes()) {
    paths[r.path] ??= {};
    paths[r.path]![r.method] = operation(r);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Mezgeb API',
      version: '1',
      description:
        'The shared dube book. Decisions in docs/decisions (ADR-001 to ADR-015); every write is idempotent on a client UUID.',
    },
    servers: [{ url: '/' }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    paths,
  };
}
