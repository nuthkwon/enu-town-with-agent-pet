import {
  audit,
  auditEvents,
  chatMessages,
  nudgeDeliveries,
  petNudges,
  todos,
  workLogs,
  type DbOrTx,
} from '@enu/db';
import { retentionCutoffs, type RetentionDays } from '@enu/domain';
import { localDateKey } from '@enu/shared';
import { and, eq, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { WorkerEnv } from '../env';
import { affected, inBatches } from './types';

export const RETENTION_BATCH_SIZE = 5000;
/** Soft-deleted work logs are scrubbed at once and removed for good after this many days. */
export const SOFT_DELETED_WORK_LOG_DAYS = 30;
/** Done/dismissed to-dos untouched for this many days are removed. */
export const CLOSED_TODO_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_NUDGE_STATUSES = ['acked', 'dismissed', 'expired', 'superseded'];
const CLOSED_TODO_STATUSES = ['done', 'dismissed'];

export interface RetentionSummary {
  dmMessages: number;
  roomMessages: number;
  workLogs: number;
  softDeletedWorkLogsPurged: number;
  softDeletedWorkLogsScrubbed: number;
  nudges: number;
  nudgeDeliveries: number;
  auditEvents: number;
  todos: number;
}

export interface RetentionOptions {
  batchSize?: number;
}

export type RetentionEnv = Pick<
  WorkerEnv,
  | 'APP_TIMEZONE'
  | 'RETENTION_DM_DAYS'
  | 'RETENTION_ROOM_CHAT_DAYS'
  | 'RETENTION_WORKLOG_DAYS'
  | 'RETENTION_NUDGE_DAYS'
  | 'RETENTION_AUDIT_DAYS'
>;

export function retentionDaysFromEnv(env: RetentionEnv): RetentionDays {
  return {
    dm: env.RETENTION_DM_DAYS,
    roomChat: env.RETENTION_ROOM_CHAT_DAYS,
    workLog: env.RETENTION_WORKLOG_DAYS,
    nudge: env.RETENTION_NUDGE_DAYS,
    audit: env.RETENTION_AUDIT_DAYS,
  };
}

/**
 * retention.purge (daily 03:17 local). Every cutoff is strict ("older than"): a row stamped
 * exactly at the cutoff is kept. Deletes run in batches of `batchSize` rows per statement.
 *
 * - chat: DMs older than the DM cutoff; room/nearby older than the room cutoff (recipients cascade).
 * - work logs: `period_key` (owner's local date, keyed in APP_TIMEZONE) before the cutoff's local date.
 * - soft-deleted work logs: content columns emptied immediately; rows deleted 30 days after `deleted_at`.
 * - nudges: terminal ones created and expired before the nudge cutoff (active ones belong to nudges.expire);
 *   deliveries shown before the nudge cutoff.
 * - audit events older than the audit cutoff; done/dismissed to-dos untouched for 30 days.
 */
export async function purgeRetention(
  db: DbOrTx,
  now: Date,
  env: RetentionEnv,
  opts: RetentionOptions = {},
): Promise<RetentionSummary> {
  const batch = opts.batchSize ?? RETENTION_BATCH_SIZE;
  const cut = retentionCutoffs(now, retentionDaysFromEnv(env));
  const workLogKeyCutoff = localDateKey(cut.workLog, env.APP_TIMEZONE);
  const softDeletedCutoff = new Date(now.getTime() - SOFT_DELETED_WORK_LOG_DAYS * DAY_MS);
  const closedTodoCutoff = new Date(now.getTime() - CLOSED_TODO_DAYS * DAY_MS);

  const deleteChat = (where: SQL | undefined) =>
    inBatches(batch, async (limit) =>
      affected(
        await db
          .delete(chatMessages)
          .where(
            inArray(chatMessages.id, db.select({ id: chatMessages.id }).from(chatMessages).where(where).limit(limit)),
          ),
      ),
    );

  const dmMessages = await deleteChat(and(eq(chatMessages.kind, 'dm'), lt(chatMessages.createdAt, cut.dm)));
  const roomMessages = await deleteChat(
    and(inArray(chatMessages.kind, ['room', 'nearby']), lt(chatMessages.createdAt, cut.roomChat)),
  );

  const deleteWorkLogs = (where: SQL | undefined) =>
    inBatches(batch, async (limit) =>
      affected(
        await db
          .delete(workLogs)
          .where(inArray(workLogs.id, db.select({ id: workLogs.id }).from(workLogs).where(where).limit(limit))),
      ),
    );

  const workLogCount = await deleteWorkLogs(lt(workLogs.periodKey, workLogKeyCutoff));
  const softDeletedWorkLogsPurged = await deleteWorkLogs(
    and(isNotNull(workLogs.deletedAt), lt(workLogs.deletedAt, softDeletedCutoff)),
  );

  const hasContent = or(
    isNotNull(workLogs.summary),
    isNotNull(workLogs.claudeChatSummary),
    sql`${workLogs.tasks} <> '[]'::jsonb`,
    sql`${workLogs.blockers} <> '[]'::jsonb`,
  );
  const softDeletedWorkLogsScrubbed = await inBatches(batch, async (limit) =>
    affected(
      await db
        .update(workLogs)
        // Keep updated_at: a system scrub is not an edit (and must not float the row in any feed).
        .set({ summary: null, tasks: [], blockers: [], claudeChatSummary: null, updatedAt: sql`${workLogs.updatedAt}` })
        .where(
          inArray(
            workLogs.id,
            db
              .select({ id: workLogs.id })
              .from(workLogs)
              .where(and(isNotNull(workLogs.deletedAt), hasContent))
              .limit(limit),
          ),
        ),
    ),
  );

  // Deliveries first: deleting nudges would otherwise first null out their nudge_id.
  const nudgeDeliveryCount = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(nudgeDeliveries)
        .where(
          inArray(
            nudgeDeliveries.id,
            db
              .select({ id: nudgeDeliveries.id })
              .from(nudgeDeliveries)
              .where(lt(nudgeDeliveries.shownAt, cut.nudge))
              .limit(limit),
          ),
        ),
    ),
  );

  const nudgeCount = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(petNudges)
        .where(
          inArray(
            petNudges.id,
            db
              .select({ id: petNudges.id })
              .from(petNudges)
              .where(
                and(
                  inArray(petNudges.status, TERMINAL_NUDGE_STATUSES),
                  lt(petNudges.createdAt, cut.nudge),
                  lt(petNudges.expiresAt, cut.nudge),
                ),
              )
              .limit(limit),
          ),
        ),
    ),
  );

  const auditCount = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(auditEvents)
        .where(
          inArray(
            auditEvents.id,
            db
              .select({ id: auditEvents.id })
              .from(auditEvents)
              .where(lt(auditEvents.occurredAt, cut.audit))
              .limit(limit),
          ),
        ),
    ),
  );

  const todoCount = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(todos)
        .where(
          inArray(
            todos.id,
            db
              .select({ id: todos.id })
              .from(todos)
              .where(and(inArray(todos.status, CLOSED_TODO_STATUSES), lt(todos.updatedAt, closedTodoCutoff)))
              .limit(limit),
          ),
        ),
    ),
  );

  const summary: RetentionSummary = {
    dmMessages,
    roomMessages,
    workLogs: workLogCount,
    softDeletedWorkLogsPurged,
    softDeletedWorkLogsScrubbed,
    nudges: nudgeCount,
    nudgeDeliveries: nudgeDeliveryCount,
    auditEvents: auditCount,
    todos: todoCount,
  };
  // Counts only (no content): proof that retention ran, kept like any other audit event.
  await audit(db, { actorType: 'system', action: 'retention.purge', metadata: { ...summary } });
  return summary;
}
