import { audit, notifyTown, petNudges, todos, type Db, type DbOrTx } from '@enu/db';
import type { TodoDto, TodoPatch } from '@enu/shared';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { toTodoDto } from '../dto';
import { HttpError, notFound } from '../http';
import type { Viewer } from '../session';

const RECENT_CLOSED_MS = 7 * 24 * 60 * 60 * 1000;

/** Open and snoozed to-dos (by due time), then those closed in the last 7 days. */
export async function listTodos(db: DbOrTx, userId: string, now = new Date(), opts: { activeOnly?: boolean } = {}): Promise<TodoDto[]> {
  const recent = new Date(now.getTime() - RECENT_CLOSED_MS);
  const rows = await db
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.userId, userId),
        opts.activeOnly
          ? inArray(todos.status, ['open', 'snoozed'])
          : or(inArray(todos.status, ['open', 'snoozed']), gt(todos.updatedAt, recent)),
      ),
    )
    .orderBy(
      sql`case when ${todos.status} in ('open','snoozed') then 0 else 1 end`,
      asc(sql`coalesce(${todos.dueAt}, ${todos.dueDate}::timestamptz)`),
      asc(todos.priority),
      desc(todos.updatedAt),
    )
    .limit(200);
  return rows.map(toTodoDto);
}

/**
 * The owner's change always wins over Claude's (status_source='user'). Closing a to-do also
 * retires the pet bubbles attached to it so the pet stops reminding about it.
 */
export async function patchTodo(db: Db, viewer: Viewer, id: string, patch: TodoPatch, now = new Date()): Promise<TodoDto> {
  if (patch.status === undefined && patch.snoozed_until === undefined) throw new HttpError(400, 'empty_patch', ko.errors.emptyPatch);
  let status: 'open' | 'done' | 'dismissed' | 'snoozed';
  let snoozedUntil: Date | null = null;
  if (typeof patch.snoozed_until === 'string') {
    snoozedUntil = new Date(patch.snoozed_until);
    if (!(snoozedUntil.getTime() > now.getTime())) {
      throw new HttpError(400, 'invalid_body', ko.errors.snoozePast, [{ field: 'snoozed_until', reason: 'too_small' }]);
    }
    status = 'snoozed';
  } else {
    status = patch.status ?? 'open';
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(todos)
      .set({ status, snoozedUntil, statusSource: 'user', completedAt: status === 'done' ? now : null })
      .where(and(eq(todos.id, id), eq(todos.userId, viewer.userId)))
      .returning();
    if (!row) throw notFound();
    let nudgesChanged = false;
    if (status === 'done' || status === 'dismissed') {
      const retired = await tx
        .update(petNudges)
        .set({ status: 'superseded' })
        .where(and(eq(petNudges.todoId, id), eq(petNudges.userId, viewer.userId), inArray(petNudges.status, ['pending', 'shown', 'snoozed'])))
        .returning({ id: petNudges.id });
      nudgesChanged = retired.length > 0;
    }
    await audit(tx, { actorType: 'user', actorUserId: viewer.userId, action: 'todo.status', targetType: 'todo', targetId: id, metadata: { status } });
    await notifyTown(tx, { v: 1, type: 'todos_changed', user_id: viewer.userId });
    if (nudgesChanged) await notifyTown(tx, { v: 1, type: 'nudges_changed', user_id: viewer.userId });
    return toTodoDto(row);
  });
}
