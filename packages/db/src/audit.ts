import { auditEvents } from './schema/app';
import type { DbOrTx } from './client';

export interface AuditInput {
  actorType: 'user' | 'claude' | 'admin' | 'system';
  actorUserId?: string | null;
  oauthClientId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Records an audit event. Never put message bodies or Claude-written text in metadata. */
export async function audit(db: DbOrTx, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: e.actorType,
    actorUserId: e.actorUserId ?? null,
    oauthClientId: e.oauthClientId ?? null,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ? e.userAgent.slice(0, 300) : null,
    metadata: e.metadata ?? null,
  });
}
