import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@mezgeb/shared';
import { Clock } from '../common/clock.js';
import type { Db } from '../db/db.module.js';
import { auditLog } from '../db/schema.js';

export interface AuditRecord {
  actorUserId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
}

/** Appends to the immutable audit log, inside the caller's transaction. */
@Injectable()
export class AuditService {
  constructor(private readonly clock: Clock) {}

  async record(tx: Pick<Db, 'insert'>, r: AuditRecord): Promise<void> {
    const now = this.clock.now();
    await tx.insert(auditLog).values({
      id: uuidv7(now.getTime()),
      actorUserId: r.actorUserId,
      action: r.action,
      objectType: r.objectType,
      objectId: r.objectId,
      before: r.before ?? null,
      after: r.after ?? null,
      at: now,
    });
  }
}
