import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import type { z } from 'zod';
import { AccountsController } from '../accounts/accounts.controller.js';
import { AuthController } from '../auth/auth.controller.js';
import { IS_PUBLIC } from '../auth/auth.decorators.js';
import { DevicesController } from '../devices/devices.controller.js';
import { HealthController } from '../health/health.controller.js';
import { LedgerController } from '../ledger/ledger.controller.js';
import { MerchantsController } from '../merchants/merchants.controller.js';
import { OrdersController } from '../orders/orders.controller.js';
import { PaymentsController } from '../payments/payments.controller.js';
import { RepresentativesController } from '../representatives/representatives.controller.js';
import { StatementsController } from '../statements/statements.controller.js';
import { SyncController } from '../sync/sync.controller.js';
import { UsersController } from '../users/users.controller.js';

/** Every public API controller (the dev controller is left out on purpose). */
export const API_CONTROLLERS = [
  HealthController,
  AuthController,
  DevicesController,
  UsersController,
  MerchantsController,
  AccountsController,
  LedgerController,
  PaymentsController,
  OrdersController,
  RepresentativesController,
  StatementsController,
  SyncController,
] as const;

export interface RouteInfo {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** OpenAPI style, e.g. `/v1/accounts/{id}/entries`. */
  path: string;
  controller: string;
  handler: string;
  public: boolean;
  /** The permission the access guard checks on `{id}` (ADR-006), if any. */
  accountAction?: string;
  merchantAction?: string;
  body?: z.ZodType;
  query?: z.ZodType;
}

const METHODS: Partial<Record<RequestMethod, RouteInfo['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

interface RouteArg {
  index: number;
  pipes?: unknown[];
}

/** The zod schema a parameter's ZodValidationPipe validates with. */
function schemaOf(arg: RouteArg | undefined): z.ZodType | undefined {
  const pipe = arg?.pipes?.find((p) => p && typeof p === 'object' && 'schema' in p) as
    { schema: z.ZodType } | undefined;
  return pipe?.schema;
}

/** Reads the routes straight from the controllers' Nest metadata, so the docs cannot drift. */
export function listRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const controller of API_CONTROLLERS) {
    const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
    const proto = controller.prototype as unknown as Record<string, unknown>;
    for (const handler of Object.getOwnPropertyNames(proto)) {
      if (handler === 'constructor') continue;
      const fn = proto[handler] as object;
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod];
      const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      if (!method || sub === undefined) continue;
      const path = `/v1/${[base, sub].filter((p) => p && p !== '/').join('/')}`
        .replace(/\/+/g, '/')
        .replace(/\/$/, '')
        .replace(/:(\w+)/g, '{$1}');
      // Nest keeps each handler's arguments under (controller, handler).
      const params = Object.entries(
        (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) ?? {}) as Record<
          string,
          RouteArg
        >,
      );
      const byType = (type: RouteParamtypes) =>
        params.find(([key]) => key.startsWith(`${type}:`))?.[1];
      routes.push({
        method,
        path,
        controller: controller.name,
        handler,
        public:
          Reflect.getMetadata(IS_PUBLIC, fn) === true ||
          Reflect.getMetadata(IS_PUBLIC, controller) === true,
        accountAction: Reflect.getMetadata('mezgeb:accountAction', fn) as string | undefined,
        merchantAction: Reflect.getMetadata('mezgeb:merchantAction', fn) as string | undefined,
        body: schemaOf(byType(RouteParamtypes.BODY)),
        query: schemaOf(byType(RouteParamtypes.QUERY)),
      });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
