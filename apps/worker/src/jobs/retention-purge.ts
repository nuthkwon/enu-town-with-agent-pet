import {
  activityReports,
  audit,
  auditEvents,
  chatMessages,
  claudeLinks,
  nudgeDeliveries,
  petChannelTokens,
  petMessages,
  petNudges,
  profiles,
  todos,
  workLogs,
  type DbOrTx,
} from '@enu/db';
import { retentionCutoffs, type RetentionDays } from '@enu/domain';
import { NUDGE_POLICY, localDateKey, startOfLocalDay } from '@enu/shared';
import { and, eq, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { WorkerEnv } from '../env';
import { affected, inBatches } from './types';

export const RETENTION_BATCH_SIZE = 5000;
/** Soft-deleted work logs are scrubbed at once and removed for good after this many days. */
export const SOFT_DELETED_WORK_LOG_DAYS = 30;
/** Done/dismissed to-dos untouched for this many days are removed. */
export const CLOSED_TODO_DAYS = 30;
/** Pet channel tokens are removed this many days after they expired or their link was revoked. */
export const CHANNEL_TOKEN_GRACE_DAYS = 30;

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
  /** Activity reports of earlier office days (activity is current-day only). */
  activityReports: number;
  /** Expired hand-set statuses cleared (상태 문구 is never touched). */
  clearedManual: number;
  /** Pet conversation messages of days past the retention window (replies go with their questions). */
  petMessages: number;
  /** Pet channel tokens expired or revoked more than 30 days ago (their revoked link rows stay). */
  petChannelTokens: number;
  /** Claude Code channel link rows (the machine's name) whose token is gone. */
  petChannelLinks: number;
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
  | 'RETENTION_PET_MESSAGE_DAYS'
>;

export function retentionDaysFromEnv(env: RetentionEnv): RetentionDays {
  return {
    dm: env.RETENTION_DM_DAYS,
    roomChat: env.RETENTION_ROOM_CHAT_DAYS,
    workLog: env.RETENTION_WORKLOG_DAYS,
    nudge: env.RETENTION_NUDGE_DAYS,
    audit: env.RETENTION_AUDIT_DAYS,
    petMessage: env.RETENTION_PET_MESSAGE_DAYS,
  };
}

/**
 * retention.purge (daily 03:17 local). Every cutoff is strict ("older than"): a row stamped
 * exactly at the cutoff is kept. Deletes run in batches of `batchSize` rows per statement.
 *
 * - chat: DMs older than the DM cutoff; room messages older than the room cutoff.
 * - work logs: `period_key` (owner's local date, keyed in APP_TIMEZONE) before the cutoff's local date.
 * - soft-deleted work logs: content columns emptied immediately; rows deleted 30 days after `deleted_at`.
 * - nudges: terminal ones created and expired before the nudge cutoff (active ones belong to nudges.expire).
 * - bubble deliveries: only what the bubble policy still reads survives a run (`nudgeDeliveryCutoff`), not
 *   the nudge cutoff: each row says the owner's tab was visible at `shown_at`, so two weeks of them would be
 *   a presence history (ADR 0004 P4).
 * - audit events older than the audit cutoff; done/dismissed to-dos untouched for 30 days.
 * - activity reports of any office day (APP_TIMEZONE) before today: the town keeps no activity history.
 *   Writers and readers key reports by the same day, so a live row is never deleted.
 * - expired manual statuses (`manual_status_until < now`) are cleared; readers already ignore them, so no
 *   NOTIFY is sent. 상태 문구 is not touched. No presence or attendance data exists to purge (ADR 0004).
 * - pet conversations by `day_key` before the pet-message cutoff; pet channel tokens 30 days after they
 *   expired or were revoked.
 */
/**
 * Bubble deliveries shown before this instant are deleted. The policy only reads today's count, the last
 * show (the minimum interval, minutes) and the due keys of the last `candidateHorizonMs` (CandidateLoader),
 * so the earlier of today's start (APP_TIMEZONE) and `now - candidateHorizonMs` keeps all of that. A
 * `lastShownAt` dropped at night only skips an interval check that passed long ago.
 */
export function nudgeDeliveryCutoff(now: Date, timeZone: string): Date {
  const dayStart = startOfLocalDay(now, timeZone).getTime();
  return new Date(Math.min(dayStart, now.getTime() - NUDGE_POLICY.candidateHorizonMs));
}

export async function purgeRetention(
  db: DbOrTx,
  now: Date,
  env: RetentionEnv,
  opts: RetentionOptions = {},
): Promise<RetentionSummary> {
  const batch = opts.batchSize ?? RETENTION_BATCH_SIZE;
  const cut = retentionCutoffs(now, retentionDaysFromEnv(env));
  const workLogKeyCutoff = localDateKey(cut.workLog, env.APP_TIMEZONE);
  const petMessageKeyCutoff = localDateKey(cut.petMessage, env.APP_TIMEZONE);
  const softDeletedCutoff = new Date(now.getTime() - SOFT_DELETED_WORK_LOG_DAYS * DAY_MS);
  const closedTodoCutoff = new Date(now.getTime() - CLOSED_TODO_DAYS * DAY_MS);
  const deliveryCutoff = nudgeDeliveryCutoff(now, env.APP_TIMEZONE);

  const deleteChat = (where: SQL | undefined) =>
    inBatches(batch, async (limit) =>
      affected(
        await db
          .delete(chatMessages)
          .where(
            inArray(
              chatMessages.id,
              db.select({ id: chatMessages.id }).from(chatMessages).where(where).limit(limit),
            ),
          ),
      ),
    );

  const dmMessages = await deleteChat(and(eq(chatMessages.kind, 'dm'), lt(chatMessages.createdAt, cut.dm)));
  const roomMessages = await deleteChat(
    and(eq(chatMessages.kind, 'room'), lt(chatMessages.createdAt, cut.roomChat)),
  );

  const deleteWorkLogs = (where: SQL | undefined) =>
    inBatches(batch, async (limit) =>
      affected(
        await db
          .delete(workLogs)
          .where(
            inArray(workLogs.id, db.select({ id: workLogs.id }).from(workLogs).where(where).limit(limit)),
          ),
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
        .set({
          summary: null,
          tasks: [],
          blockers: [],
          claudeChatSummary: null,
          updatedAt: sql`${workLogs.updatedAt}`,
        })
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
              .where(lt(nudgeDeliveries.shownAt, deliveryCutoff))
              .limit(limit),
          ),
        ),
    ),
  );

  const nudgeCount = await inBatches(batch, async (limit) =>
    affected(
      await db.delete(petNudges).where(
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
      await db.delete(todos).where(
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

  // At most one row per member and office day, so a single statement is enough.
  const activityReportCount = affected(
    await db
      .delete(activityReports)
      .where(lt(activityReports.periodKey, localDateKey(now, env.APP_TIMEZONE))),
  );

  const clearedManual = await inBatches(batch, async (limit) =>
    affected(
      await db
        .update(profiles)
        // Keep updated_at: clearing an expired value is not a profile edit.
        .set({ manualStatus: null, manualStatusUntil: null, updatedAt: sql`${profiles.updatedAt}` })
        .where(
          inArray(
            profiles.userId,
            db
              .select({ userId: profiles.userId })
              .from(profiles)
              .where(lt(profiles.manualStatusUntil, now))
              .limit(limit),
          ),
        ),
    ),
  );

  // Owner messages first would cascade to their replies; by day both go in the same window anyway.
  const petMessageCount = await inBatches(batch, async (limit) =>
    affected(
      await db
        .delete(petMessages)
        .where(
          inArray(
            petMessages.id,
            db
              .select({ id: petMessages.id })
              .from(petMessages)
              .where(lt(petMessages.dayKey, petMessageKeyCutoff))
              .limit(limit),
          ),
        ),
    ),
  );

  const tokenCutoff = new Date(now.getTime() - CHANNEL_TOKEN_GRACE_DAYS * DAY_MS);
  const petChannelTokenCount = affected(
    await db
      .delete(petChannelTokens)
      .where(
        or(
          lt(petChannelTokens.expiresAt, tokenCutoff),
          inArray(
            petChannelTokens.linkId,
            db.select({ id: claudeLinks.id }).from(claudeLinks).where(lt(claudeLinks.revokedAt, tokenCutoff)),
          ),
        ),
      ),
  );

  // A channel link exists only for its token: once the token is purged, its row (the machine's name) goes too.
  const petChannelLinkCount = affected(
    await db
      .delete(claudeLinks)
      .where(
        and(
          eq(claudeLinks.clientKind, 'claude_code_channel'),
          sql`not exists (select 1 from ${petChannelTokens} where ${petChannelTokens.linkId} = ${claudeLinks.id})`,
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
    activityReports: activityReportCount,
    clearedManual,
    petMessages: petMessageCount,
    petChannelTokens: petChannelTokenCount,
    petChannelLinks: petChannelLinkCount,
  };
  // Counts only (no content): proof that retention ran, kept like any other audit event.
  await audit(db, { actorType: 'system', action: 'retention.purge', metadata: { ...summary } });
  return summary;
}
