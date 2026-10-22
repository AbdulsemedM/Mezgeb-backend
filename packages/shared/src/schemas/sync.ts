import { z } from 'zod';

/**
 * `POST /v1/sync` (M7, ADR-010). Each queued write names its operation; the body is the same
 * JSON the REST route takes, plus the ids the REST route has in its path.
 */
export const SYNC_OPS = [
  'entry.create',
  'account.create',
  'account.update',
  'representative.create',
  'representative.update',
  'representative.status',
  'dispute.create',
  'limit.set',
  'limit.delete',
] as const;
export type SyncOp = (typeof SYNC_OPS)[number];

/** `0` for a first sync, then exactly what the previous response returned. */
export const syncCursorSchema = z.string().regex(/^(0|\d+:\d+)$/, 'not a sync cursor');

export const syncRequestSchema = z.object({
  cursor: syncCursorSchema.default('0'),
  writes: z
    .array(z.object({ op: z.enum(SYNC_OPS), body: z.record(z.string(), z.unknown()) }))
    .max(200)
    .default([]),
  /** Changes per response; the app keeps syncing while `has_more` is true. */
  page_size: z.number().int().min(1).max(1000).default(1000),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;
