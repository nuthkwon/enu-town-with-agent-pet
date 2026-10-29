import {
  activityReports,
  chatMessages,
  dmReadState,
  petNudges,
  profiles,
  todos,
  workLogs,
  type DbOrTx,
} from '@enu/db';
import { canShareActivity, checkinSkipReason } from '@enu/domain';
import {
  APP_TIMEZONE_DEFAULT,
  CONTEXT_SECTIONS,
  INSTRUCTIONS_VERSION,
  NUDGE_STATUSES,
  SCHEDULE_KINDS,
  TASK_STATUSES,
  TODO_STATUSES,
  localDateKey,
  normalizeText,
  truncateGraphemes,
  type GetMyContextInput,
  type GetMyContextOutput,
  type NudgeStatus,
  type TaskStatus,
  type TodoStatus,
} from '@enu/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { formatLocalIso } from '../format';
import { activeOwnerStatus, loadOwnerContext, type OwnerContext } from '../owner';

export const CONTEXT_LIMITS = {
  openTodosMax: 50,
  pendingNudgesMax: 20,
  townMessagesMax: 20,
  townMessageTextMax: 300,
  defaultSinceMs: 24 * 60 * 60 * 1000,
  maxSinceMs: 7 * 24 * 60 * 60 * 1000,
} as const;

type ContextSection = (typeof CONTEXT_SECTIONS)[number];
type TownMessages = NonNullable<GetMyContextOutput['town_messages']>;
type TodayLog = NonNullable<GetMyContextOutput['today_log']>;
type OpenTodo = NonNullable<GetMyContextOutput['open_todos']>[number];
type PendingNudge = NonNullable<GetMyContextOutput['pending_nudges']>[number];
type Activity = NonNullable<GetMyContextOutput['activity']>;

export interface GetMyContextOptions {
  /** APP_TIMEZONE: the office day that keys `activity_reports` (default Asia/Seoul). */
  officeTimeZone?: string;
  owner?: OwnerContext;
}

/** Effective lower bound for town messages: default 24h ago, never older than 7 days, never after now. */
export function resolveSince(now: Date, since: string | undefined): Date {
  const floor = new Date(now.getTime() - CONTEXT_LIMITS.maxSinceMs);
  if (!since) return new Date(now.getTime() - CONTEXT_LIMITS.defaultSinceMs);
  const s = new Date(since);
  if (Number.isNaN(s.getTime()) || s < floor) return floor;
  return s > now ? now : s;
}

/**
 * Everything the owner's Claude needs for a check-in. Read-only: nothing is marked read.
 * When the check-in should be skipped (weekend, holiday, outside work hours) only `me` and
 * `link` are returned so Claude can stop gracefully.
 */
export async function getMyContext(
  db: DbOrTx,
  userId: string,
  now: Date,
  input: GetMyContextInput = {},
  opts: GetMyContextOptions = {},
): Promise<GetMyContextOutput> {
  const owner = opts.owner ?? (await loadOwnerContext(db, userId));
  const tz = owner.timezone;
  const include = new Set<ContextSection>(input.include?.length ? input.include : CONTEXT_SECTIONS);
  const skipReason = checkinSkipReason(now, tz, owner.holidays);
  const today = localDateKey(now, tz);

  const out: GetMyContextOutput = {
    skip: skipReason !== null,
    instructions_version: INSTRUCTIONS_VERSION,
    now_local: formatLocalIso(now, tz),
    today,
    link: { state: owner.linkState, last_work_log_at: owner.lastWorkLogAt?.toISOString() ?? null },
  };
  if (skipReason !== null) out.skip_reason = skipReason;

  if (include.has('profile') || skipReason !== null) {
    out.me = {
      display_name: owner.displayName,
      email: owner.email,
      timezone: tz,
      desk_id: owner.deskId,
      default_log_visibility: owner.defaultLogVisibility,
      team: owner.team,
      title: owner.title,
      role: owner.role,
    };
  }
  if (skipReason !== null) return out;

  if (include.has('today_log')) out.today_log = await loadTodayLog(db, userId, today);
  if (include.has('todos')) out.open_todos = await loadOpenTodos(db, userId, tz);
  if (include.has('nudges')) out.pending_nudges = await loadPendingNudges(db, userId, now);
  if (include.has('town_messages')) {
    out.town_messages = await loadTownMessages(db, owner, now, resolveSince(now, input.since));
  }
  if (include.has('activity')) {
    out.activity = await loadActivity(db, owner, now, opts.officeTimeZone ?? APP_TIMEZONE_DEFAULT);
  }
  return out;
}

/**
 * Whether the owner shares activity, today's stored report (office date; refs never echoed, only
 * `has_ref`) and the owner's own status. A `now` report past its `until` is no longer current.
 */
async function loadActivity(
  db: DbOrTx,
  owner: OwnerContext,
  now: Date,
  officeTimeZone: string,
): Promise<Activity> {
  const sharing = canShareActivity(owner, { active: true });
  const ownerStatus = activeOwnerStatus(owner, now);
  if (!sharing) return { sharing, now: null, schedule: [], owner_status: ownerStatus };
  const [row] = await db
    .select({
      nowKind: activityReports.nowKind,
      nowRefHash: activityReports.nowRefHash,
      nowUntil: activityReports.nowUntil,
      schedule: activityReports.schedule,
    })
    .from(activityReports)
    .where(
      and(
        eq(activityReports.userId, owner.userId),
        eq(activityReports.periodKey, localDateKey(now, officeTimeZone)),
      ),
    );
  return {
    sharing,
    now:
      row?.nowKind && row.nowUntil && row.nowUntil > now
        ? { kind: row.nowKind, has_ref: row.nowRefHash !== null, until: row.nowUntil.toISOString() }
        : null,
    schedule: (row?.schedule ?? [])
      .filter((b) => (SCHEDULE_KINDS as readonly string[]).includes(b.kind))
      .map((b) => ({ start_at: b.start_at, end_at: b.end_at, kind: b.kind, has_ref: b.ref_hash !== null })),
    owner_status: ownerStatus,
  };
}

async function loadTodayLog(db: DbOrTx, userId: string, periodKey: string): Promise<TodayLog | null> {
  const [log] = await db
    .select({
      summary: workLogs.summary,
      tasks: workLogs.tasks,
      blockers: workLogs.blockers,
      visibility: workLogs.visibility,
      editedByUser: workLogs.editedByUser,
      updatedAt: workLogs.updatedAt,
    })
    .from(workLogs)
    .where(and(eq(workLogs.userId, userId), eq(workLogs.periodKey, periodKey), isNull(workLogs.deletedAt)));
  if (!log) return null;
  return {
    summary: log.summary ?? '',
    tasks: (log.tasks ?? [])
      .filter((t) => typeof t?.title === 'string' && t.title.length > 0)
      .map((t) => {
        const status: TaskStatus = (TASK_STATUSES as readonly string[]).includes(t.status)
          ? (t.status as TaskStatus)
          : 'in_progress';
        return t.ref ? { title: t.title, status, ref: t.ref } : { title: t.title, status };
      }),
    blockers: (log.blockers ?? []).filter((b) => typeof b === 'string'),
    visibility: log.visibility,
    edited_by_user: log.editedByUser,
    updated_at: log.updatedAt.toISOString(),
  };
}

async function loadOpenTodos(db: DbOrTx, userId: string, tz: string): Promise<OpenTodo[]> {
  // All-day items sort as if due at the end of their local day.
  const effectiveDue = sql`coalesce(${todos.dueAt}, (${todos.dueDate}::timestamp + interval '23 hours 59 minutes') at time zone ${tz})`;
  const rows = await db
    .select({
      externalRef: todos.externalRef,
      title: todos.title,
      dueAt: todos.dueAt,
      dueDate: todos.dueDate,
      priority: todos.priority,
      status: todos.status,
      statusSource: todos.statusSource,
    })
    .from(todos)
    .where(and(eq(todos.userId, userId), inArray(todos.status, ['open', 'snoozed'])))
    .orderBy(sql`${effectiveDue} asc nulls last`, asc(todos.priority), asc(todos.createdAt))
    .limit(CONTEXT_LIMITS.openTodosMax);
  return rows.map((r) => ({
    external_ref: r.externalRef,
    title: r.title,
    due_at: r.dueAt?.toISOString() ?? null,
    due_date: r.dueDate ?? null,
    priority: r.priority,
    status: (TODO_STATUSES as readonly string[]).includes(r.status) ? (r.status as TodoStatus) : 'open',
    // Anything not set by Claude (owner or system) is owner-controlled from Claude's point of view.
    status_source: r.statusSource === 'claude' ? 'claude' : 'user',
  }));
}

async function loadPendingNudges(db: DbOrTx, userId: string, now: Date): Promise<PendingNudge[]> {
  const rows = await db
    .select({ text: petNudges.text, status: petNudges.status, showAfter: petNudges.showAfter })
    .from(petNudges)
    .where(
      and(
        eq(petNudges.userId, userId),
        inArray(petNudges.status, ['pending', 'snoozed', 'shown']),
        gt(petNudges.expiresAt, now),
      ),
    )
    .orderBy(asc(petNudges.showAfter), asc(petNudges.createdAt))
    .limit(CONTEXT_LIMITS.pendingNudgesMax);
  return rows.map((r) => ({
    text: r.text,
    status: (NUDGE_STATUSES as readonly string[]).includes(r.status) ? (r.status as NudgeStatus) : 'pending',
    show_after: r.showAfter.toISOString(),
  }));
}

/** DMs addressed to the owner (not sent by them, not deleted, not in the future). */
function dmsToMe(userId: string, now: Date) {
  return and(
    eq(chatMessages.kind, 'dm'),
    or(eq(chatMessages.dmLow, userId), eq(chatMessages.dmHigh, userId)),
    ne(chatMessages.senderId, userId),
    isNull(chatMessages.deletedAt),
    lte(chatMessages.createdAt, now),
  );
}

/** Unread = after the owner's read marker for that peer, or after `since` when there is none. */
export async function countUnreadDms(db: DbOrTx, userId: string, now: Date, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(chatMessages)
    .leftJoin(dmReadState, and(eq(dmReadState.userId, userId), eq(dmReadState.peerId, chatMessages.senderId)))
    .where(
      and(
        dmsToMe(userId, now),
        sql`${chatMessages.createdAt} > coalesce(${dmReadState.lastReadAt}, ${since.toISOString()}::timestamptz)`,
      ),
    );
  return Number(row?.n ?? 0);
}

async function loadTownMessages(
  db: DbOrTx,
  owner: OwnerContext,
  now: Date,
  since: Date,
): Promise<TownMessages> {
  const unread = await countUnreadDms(db, owner.userId, now, since);
  // Privacy: colleagues' messages reach Claude only when the owner opted in.
  if (!owner.shareDmsWithMyClaude) return { shared: false, unread_count: unread, items: [] };
  const rows = await db
    .select({
      id: chatMessages.id,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      fromName: profiles.displayName,
    })
    .from(chatMessages)
    .leftJoin(profiles, eq(profiles.userId, chatMessages.senderId))
    .where(and(dmsToMe(owner.userId, now), gt(chatMessages.createdAt, since)))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(CONTEXT_LIMITS.townMessagesMax);
  return {
    shared: true,
    unread_count: unread,
    items: rows.reverse().map((r) => ({
      message_id: r.id,
      from_display_name: r.fromName ?? '(알 수 없음)',
      sent_at: r.createdAt.toISOString(),
      untrusted_text: truncateGraphemes(normalizeText(r.body), CONTEXT_LIMITS.townMessageTextMax),
    })),
  };
}
