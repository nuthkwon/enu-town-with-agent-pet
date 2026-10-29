import { audit, newId, notifyTown, todos, type Db } from '@enu/db';
import { prepareTodoText } from '@enu/domain';
import { LIMITS, type TodoStatus, type UpsertTodosInput, type UpsertTodosOutput } from '@enu/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { lockOwnerScope, recordLinkWrite, type CallerInfo } from '../links';
import { ToolError, type ToolProblem } from '../result';

type TodoRow = typeof todos.$inferSelect;
type TodoItemInput = UpsertTodosInput['items'][number];

interface PreparedTodo {
  index: number;
  externalRef: string;
  title: string;
  note: string | null;
  dueAt: Date | null;
  dueDate: string | null;
  priority: number;
  status: 'open' | 'done';
}

const OPEN_STATUSES: readonly string[] = ['open', 'snoozed'];
const isOpen = (status: string) => (OPEN_STATUSES.includes(status) ? 1 : 0);

export function isRealCalendarDate(key: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === key;
}

/** Validates and normalizes every item; any problem rejects the whole batch. */
export function prepareTodoItems(items: TodoItemInput[]): { items: PreparedTodo[]; problems: ToolProblem[] } {
  const problems: ToolProblem[] = [];
  const firstIndexOfRef = new Map<string, number>();
  const prepared = items.map((item, index): PreparedTodo => {
    const text = prepareTodoText(item.title, item.note);
    for (const p of text.problems) {
      problems.push({ index, field: p.field, reason: p.reason, ...(p.detail ? { detail: p.detail } : {}) });
    }
    const seen = firstIndexOfRef.get(item.external_ref);
    if (seen !== undefined) {
      problems.push({ index, field: 'external_ref', reason: 'duplicate', detail: `same external_ref as items[${seen}]` });
    } else {
      firstIndexOfRef.set(item.external_ref, index);
    }
    if (item.due_date && !isRealCalendarDate(item.due_date)) {
      problems.push({ index, field: 'due_date', reason: 'invalid_time', detail: 'not a real calendar date' });
    }
    if (item.due_at && item.due_date) {
      problems.push({ index, field: 'due_at', reason: 'invalid_time', detail: 'use either due_at or due_date, not both' });
    }
    return {
      index,
      externalRef: item.external_ref,
      title: text.title,
      note: text.note,
      dueAt: item.due_at ? new Date(item.due_at) : null,
      dueDate: item.due_date ?? null,
      priority: item.priority ?? 2,
      status: item.status ?? 'open',
    };
  });
  return { items: prepared, problems };
}

interface Plan {
  item: PreparedTodo;
  existing: TodoRow | undefined;
  id: string;
  finalStatus: string;
  completedAt: Date | null;
  changed: boolean;
  statusSkipped: boolean;
}

function planItem(item: PreparedTodo, existing: TodoRow | undefined, now: Date): Plan {
  if (!existing) {
    return {
      item,
      existing,
      id: newId(),
      finalStatus: item.status,
      completedAt: item.status === 'done' ? now : null,
      changed: true,
      statusSkipped: false,
    };
  }
  let finalStatus = existing.status;
  let completedAt = existing.completedAt;
  let statusSkipped = false;
  const alreadyThere = item.status === 'open' ? isOpen(existing.status) === 1 : existing.status === 'done';
  if (!alreadyThere) {
    // Claude may only move status it set itself; owner/system decisions and dismissals stick.
    if (existing.statusSource === 'claude' && existing.status !== 'dismissed') {
      finalStatus = item.status;
      completedAt = item.status === 'done' ? now : null;
    } else {
      statusSkipped = true;
    }
  }
  const changed =
    existing.title !== item.title ||
    (existing.note ?? null) !== item.note ||
    (existing.dueAt?.getTime() ?? null) !== (item.dueAt?.getTime() ?? null) ||
    (existing.dueDate ?? null) !== item.dueDate ||
    existing.priority !== item.priority ||
    finalStatus !== existing.status;
  return { item, existing, id: existing.id, finalStatus, completedAt, changed, statusSkipped };
}

/**
 * Upserts the owner's to-dos keyed by (user, external_ref). New rows start as Claude-controlled;
 * on existing rows Claude's status only applies while status_source is 'claude', and dismissed
 * rows are never resurrected. Enforces the open to-do cap atomically.
 */
export async function upsertTodos(
  db: Db,
  caller: CallerInfo,
  input: UpsertTodosInput,
  now: Date,
): Promise<UpsertTodosOutput> {
  const { items, problems } = prepareTodoItems(input.items);
  if (problems.length) {
    throw new ToolError(
      'validation_failed',
      'to-dos rejected: ENU Town never edits your text. Fix the listed items (titles: no personal data, no links; notes: no personal data) and resend the whole batch. Nothing was saved.',
      { problems },
    );
  }

  return db.transaction(async (tx) => {
    await lockOwnerScope(tx, 'todos', caller.userId);
    const refs = items.map((i) => i.externalRef);
    const existingRows = await tx
      .select()
      .from(todos)
      .where(and(eq(todos.userId, caller.userId), inArray(todos.externalRef, refs)))
      .for('update');
    const byRef = new Map(existingRows.map((r) => [r.externalRef, r]));
    const plans = items.map((item) => planItem(item, byRef.get(item.externalRef), now));

    const delta = plans.reduce((acc, p) => acc + isOpen(p.finalStatus) - (p.existing ? isOpen(p.existing.status) : 0), 0);
    if (delta > 0) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(todos)
        .where(and(eq(todos.userId, caller.userId), inArray(todos.status, ['open', 'snoozed'])));
      const currentOpen = Number(row?.n ?? 0);
      if (currentOpen + delta > LIMITS.todosOpenMax) {
        throw new ToolError(
          'open_todo_limit',
          `too many open to-dos: the owner would have ${currentOpen + delta} open items (max ${LIMITS.todosOpenMax}). Mark finished items done or send fewer new items. Nothing was saved.`,
        );
      }
    }

    const inserts = plans.filter((p) => !p.existing);
    if (inserts.length) {
      await tx.insert(todos).values(
        inserts.map((p) => ({
          id: p.id,
          userId: caller.userId,
          externalRef: p.item.externalRef,
          title: p.item.title,
          note: p.item.note,
          dueAt: p.item.dueAt,
          dueDate: p.item.dueDate,
          priority: p.item.priority,
          status: p.finalStatus,
          statusSource: 'claude',
          oauthClientId: caller.clientId,
          lastSeenByClaudeAt: now,
          completedAt: p.completedAt,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    for (const p of plans) {
      if (!p.existing) continue;
      await tx
        .update(todos)
        .set(
          p.changed
            ? {
                title: p.item.title,
                note: p.item.note,
                dueAt: p.item.dueAt,
                dueDate: p.item.dueDate,
                priority: p.item.priority,
                status: p.finalStatus,
                completedAt: p.completedAt,
                oauthClientId: caller.clientId,
                lastSeenByClaudeAt: now,
                updatedAt: now,
              }
            : { lastSeenByClaudeAt: now, updatedAt: p.existing.updatedAt },
        )
        .where(eq(todos.id, p.existing.id));
    }

    const created = inserts.length;
    const updated = plans.filter((p) => p.existing && p.changed).length;
    const unchanged = plans.filter((p) => p.existing && !p.changed).length;
    const skippedUserControlled = plans.filter((p) => p.statusSkipped).length;

    if (created + updated > 0) await notifyTown(tx, { v: 1, type: 'todos_changed', user_id: caller.userId });
    await recordLinkWrite(tx, caller, now);
    await audit(tx, {
      actorType: 'claude',
      actorUserId: caller.userId,
      oauthClientId: caller.clientId,
      action: 'todos.upsert',
      targetType: 'todo',
      metadata: {
        items: plans.length,
        created,
        updated,
        unchanged,
        skipped_user_controlled: skippedUserControlled,
      },
    });

    return {
      created,
      updated,
      unchanged,
      skipped_user_controlled: skippedUserControlled,
      items: plans.map((p) => ({
        external_ref: p.item.externalRef,
        todo_id: p.id,
        status: p.finalStatus as TodoStatus,
      })),
    };
  });
}
