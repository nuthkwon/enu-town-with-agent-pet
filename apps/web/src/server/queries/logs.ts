import { audit, notifyTown, profiles, user, workLogs, type Db, type DbOrTx } from '@enu/db';
import { prepareWorkLog } from '@enu/domain';
import type { ClaudeSummaryDto, Visibility, WorkLogDto, WorkLogPatch } from '@enu/shared';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { toClaudeSummaryDto, toWorkLogDto, type LogAuthor, type WorkLogRow } from '../dto';
import { HttpError, notFound, paginate, type Cursor, type Page } from '../http';
import type { Viewer } from '../session';
import { beforeDate } from './sql';

/** Display name + account state of a log author; null when the user does not exist. */
export async function findAuthor(db: DbOrTx, userId: string): Promise<LogAuthor | null> {
  const [row] = await db
    .select({ name: profiles.displayName, fallback: user.name, status: user.status })
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return null;
  return { name: row.name ?? row.fallback, active: row.status === 'active' };
}

/**
 * The author for someone else's data: unknown or deactivated authors look exactly like
 * "not found" to other viewers (owners always see their own).
 */
export async function requireVisibleAuthor(db: DbOrTx, viewer: Viewer, ownerId: string): Promise<LogAuthor> {
  const author = await findAuthor(db, ownerId);
  if (!author || (ownerId !== viewer.userId && !author.active)) throw notFound();
  return author;
}

/**
 * Logs of `ownerId` that `viewer` may see, newest day first. SQL only pre-filters (never more
 * permissive than the domain rule); every row still passes canViewLog in toWorkLogDto.
 */
export async function listLogs(db: DbOrTx, viewer: Viewer, ownerId: string, cursor: Cursor | null, limit: number): Promise<Page<WorkLogDto>> {
  const author = await requireVisibleAuthor(db, viewer, ownerId);
  const own = ownerId === viewer.userId;
  const rows = await db
    .select()
    .from(workLogs)
    .where(
      and(
        eq(workLogs.userId, ownerId),
        isNull(workLogs.deletedAt),
        own ? undefined : eq(workLogs.visibility, 'company'),
        beforeDate(workLogs.periodKey, workLogs.id, cursor),
      ),
    )
    .orderBy(desc(workLogs.periodKey), desc(workLogs.id))
    .limit(limit + 1);
  const page = paginate(rows, limit, (r) => ({ k: r.periodKey, id: r.id }));
  return { items: page.items.map((r) => toWorkLogDto(r, author, viewer)).filter((d) => d !== null), nextCursor: page.nextCursor };
}

/** The most recent log the viewer may see (profile card). */
export async function latestVisibleLog(db: DbOrTx, viewer: Viewer, ownerId: string, author: LogAuthor): Promise<WorkLogDto | null> {
  const own = ownerId === viewer.userId;
  const [row] = await db
    .select()
    .from(workLogs)
    .where(and(eq(workLogs.userId, ownerId), isNull(workLogs.deletedAt), own ? undefined : eq(workLogs.visibility, 'company')))
    .orderBy(desc(workLogs.periodKey), desc(workLogs.id))
    .limit(1);
  return row ? toWorkLogDto(row, author, viewer) : null;
}

/** Claude work-chat summaries the viewer may see (both the log and the summary must allow it). */
export async function listClaudeSummaries(
  db: DbOrTx,
  viewer: Viewer,
  ownerId: string,
  cursor: Cursor | null,
  limit: number,
): Promise<Page<ClaudeSummaryDto>> {
  const author = await requireVisibleAuthor(db, viewer, ownerId);
  const own = ownerId === viewer.userId;
  const rows = await db
    .select()
    .from(workLogs)
    .where(
      and(
        eq(workLogs.userId, ownerId),
        isNull(workLogs.deletedAt),
        isNotNull(workLogs.claudeChatSummary),
        own ? undefined : and(eq(workLogs.visibility, 'company'), eq(workLogs.chatSummaryVisibility, 'company')),
        beforeDate(workLogs.periodKey, workLogs.id, cursor),
      ),
    )
    .orderBy(desc(workLogs.periodKey), desc(workLogs.id))
    .limit(limit + 1);
  const page = paginate(rows, limit, (r) => ({ k: r.periodKey, id: r.id }));
  return {
    items: page.items.map((r) => toClaudeSummaryDto(r, author, viewer)).filter((d) => d !== null),
    nextCursor: page.nextCursor,
  };
}

async function loadOwnLog(tx: DbOrTx, viewer: Viewer, id: string): Promise<WorkLogRow> {
  const [row] = await tx
    .select()
    .from(workLogs)
    .where(and(eq(workLogs.id, id), eq(workLogs.userId, viewer.userId), isNull(workLogs.deletedAt)))
    .for('update');
  if (!row) throw notFound();
  return row;
}

const CONTENT_KEYS = ['summary', 'tasks', 'blockers', 'claude_chat_summary'] as const;

/**
 * Owner edits. Content edits mark the log as edited by the user (Claude's later upserts then
 * skip it); visibility changes pin visibility_set_by='user' without marking content edited.
 * Edited text goes through the same publishability rules as Claude's (rejected, never rewritten).
 */
export async function patchOwnLog(db: Db, viewer: Viewer, id: string, patch: WorkLogPatch, now = new Date()): Promise<WorkLogDto> {
  const hasContent = CONTENT_KEYS.some((k) => patch[k] !== undefined);
  if (!hasContent && patch.visibility === undefined && patch.chat_summary_visibility === undefined) {
    throw new HttpError(400, 'empty_patch', ko.errors.emptyPatch);
  }
  const author = (await findAuthor(db, viewer.userId)) ?? { name: viewer.name, active: true };

  const updated = await db.transaction(async (tx) => {
    const row = await loadOwnLog(tx, viewer, id);
    const set: Partial<typeof workLogs.$inferInsert> = {};

    if (hasContent) {
      const { log, problems } = prepareWorkLog({
        summary: patch.summary ?? row.summary ?? '',
        tasks: patch.tasks ?? row.tasks,
        blockers: patch.blockers ?? row.blockers,
        claudeChatSummary: (patch.claude_chat_summary !== undefined ? patch.claude_chat_summary : row.claudeChatSummary) ?? undefined,
      });
      if (problems.length) {
        throw new HttpError(
          400,
          'content_rejected',
          ko.errors.contentRejected,
          problems.map((p) => ({ field: p.field, reason: p.reason })),
        );
      }
      const next = {
        summary: patch.summary !== undefined ? log.summary : row.summary,
        tasks: patch.tasks !== undefined ? log.tasks : row.tasks,
        blockers: patch.blockers !== undefined ? log.blockers : row.blockers,
        claudeChatSummary: patch.claude_chat_summary !== undefined ? log.claudeChatSummary : row.claudeChatSummary,
      };
      const changed =
        next.summary !== row.summary ||
        JSON.stringify(next.tasks) !== JSON.stringify(row.tasks) ||
        JSON.stringify(next.blockers) !== JSON.stringify(row.blockers) ||
        next.claudeChatSummary !== row.claudeChatSummary;
      if (changed) {
        Object.assign(set, next, { editedByUser: true, userEditedAt: now });
      }
    }

    const visibilityBefore = row.visibility as Visibility;
    if (patch.visibility !== undefined) {
      set.visibility = patch.visibility;
      set.visibilitySetBy = 'user';
    }
    if (patch.chat_summary_visibility !== undefined) {
      set.chatSummaryVisibility = patch.chat_summary_visibility;
      set.chatSummaryVisibilitySetBy = 'user';
    }
    if (Object.keys(set).length === 0) return row;

    const [after] = await tx.update(workLogs).set(set).where(eq(workLogs.id, row.id)).returning();
    if (!after) throw notFound();

    if (patch.visibility !== undefined && patch.visibility !== visibilityBefore) {
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'work_log.visibility',
        targetType: 'work_log',
        targetId: row.id,
        metadata: { from: visibilityBefore, to: patch.visibility },
      });
    }
    if (patch.chat_summary_visibility !== undefined && patch.chat_summary_visibility !== row.chatSummaryVisibility) {
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'work_log.chat_summary_visibility',
        targetType: 'work_log',
        targetId: row.id,
        metadata: { from: row.chatSummaryVisibility, to: patch.chat_summary_visibility },
      });
    }
    if (set.editedByUser) {
      await audit(tx, { actorType: 'user', actorUserId: viewer.userId, action: 'work_log.edit', targetType: 'work_log', targetId: row.id });
    }
    await notifyTown(tx, {
      v: 1,
      type: 'work_log_changed',
      user_id: viewer.userId,
      log_id: row.id,
      visibility: after.visibility as Visibility,
      created: false,
    });
    return after;
  });

  const dto = toWorkLogDto(updated, author, viewer);
  if (!dto) throw notFound();
  return dto;
}

/** Soft delete: the row stays (so Claude's upsert reports skipped_user_deleted) but content is gone now. */
export async function deleteOwnLog(db: Db, viewer: Viewer, id: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workLogs)
      .set({ deletedAt: now, summary: null, tasks: [], blockers: [], claudeChatSummary: null })
      .where(and(eq(workLogs.id, id), eq(workLogs.userId, viewer.userId), isNull(workLogs.deletedAt)))
      .returning({ id: workLogs.id, visibility: workLogs.visibility });
    if (!row) throw notFound();
    await audit(tx, { actorType: 'user', actorUserId: viewer.userId, action: 'work_log.delete', targetType: 'work_log', targetId: row.id });
    await notifyTown(tx, {
      v: 1,
      type: 'work_log_changed',
      user_id: viewer.userId,
      log_id: row.id,
      visibility: row.visibility as Visibility,
      created: false,
    });
  });
}
