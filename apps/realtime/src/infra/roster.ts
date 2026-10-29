import {
  activityReports,
  desks,
  profiles,
  user,
  workLogs,
  type DbOrTx,
  type ScheduleBlockRow,
} from '@enu/db';
import { hasWorkTask, type NowIn, type ScheduleBlockIn } from '@enu/domain';
import { NOW_KINDS, SCHEDULE_KINDS, localDateKey, type NowKind, type ScheduleKind } from '@enu/shared';
import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { ActorSignals, ActorSnapshot } from '../director/Director';
import { asLinkState, asManualStatus, avatarKeyOf, personColumns } from './profiles';

/**
 * Loads the town roster (every active, onboarded member with a profile) and each member's signals for
 * the current office day. The director turns these into the synced state; nothing here decides what
 * is shown. Work-log text is never read: only its visibility fields and the task statuses.
 */

function selectPeople(db: DbOrTx, where: SQL | undefined) {
  return db
    .select(personColumns)
    .from(user)
    .innerJoin(profiles, eq(profiles.userId, user.id))
    .leftJoin(desks, eq(desks.userId, user.id))
    .where(where);
}
type PersonRow = Awaited<ReturnType<typeof selectPeople>>[number];

function toActorSnapshot(r: PersonRow): ActorSnapshot {
  const status = asManualStatus(r.manualStatus);
  return {
    userId: r.userId,
    displayName: r.displayName,
    avatarKey: avatarKeyOf(r.avatar),
    deskId: r.deskId ?? null,
    petSpecies: r.petSpecies,
    petName: r.petName,
    linkState: asLinkState(r.linkState),
    statusText: r.statusText ?? '',
    shareActivity: r.shareActivity,
    showLive: r.showLive,
    manual: status && r.manualStatusUntil ? { status, until: r.manualStatusUntil } : null,
  };
}

/** Roster = active users with a profile whose onboarding is complete (spec §1.1). */
export async function loadRoster(db: DbOrTx): Promise<ActorSnapshot[]> {
  const rows = await selectPeople(
    db,
    and(eq(user.status, 'active'), isNotNull(profiles.onboardingCompletedAt)),
  );
  return rows.map(toActorSnapshot);
}

/** One member's snapshot, or null when they are not (or no longer) on the roster. */
export async function loadRosterMember(db: DbOrTx, userId: string): Promise<ActorSnapshot | null> {
  const [row] = await selectPeople(
    db,
    and(eq(user.id, userId), eq(user.status, 'active'), isNotNull(profiles.onboardingCompletedAt)),
  ).limit(1);
  return row ? toActorSnapshot(row) : null;
}

const isNowKind = (v: string | null): v is NowKind =>
  v !== null && (NOW_KINDS as readonly string[]).includes(v);
const isScheduleKind = (v: string): v is ScheduleKind => (SCHEDULE_KINDS as readonly string[]).includes(v);

function toBlocks(rows: readonly ScheduleBlockRow[]): ScheduleBlockIn[] {
  const out: ScheduleBlockIn[] = [];
  for (const b of rows) {
    if (!isScheduleKind(b.kind)) continue;
    const start = new Date(b.start_at);
    const end = new Date(b.end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    out.push({ start, end, kind: b.kind, refHash: b.ref_hash ?? null });
  }
  return out;
}

function statusesOf(v: unknown): { status: string }[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string').map((status) => ({ status }))
    : [];
}

/**
 * Today's (`localDateKey(now, timeZone)`, APP_TIMEZONE) activity report and work-log flags for each
 * user. Every requested id gets an entry, so a deleted row clears what was loaded before.
 */
export async function loadSignals(
  db: DbOrTx,
  userIds: readonly string[],
  now: Date,
  timeZone: string,
): Promise<Map<string, ActorSignals>> {
  const out = new Map<string, ActorSignals>();
  if (userIds.length === 0) return out;
  const ids = [...new Set(userIds)];
  const periodKey = localDateKey(now, timeZone);
  const [reports, logs] = await Promise.all([
    db
      .select({
        userId: activityReports.userId,
        nowKind: activityReports.nowKind,
        nowRefHash: activityReports.nowRefHash,
        nowUntil: activityReports.nowUntil,
        schedule: activityReports.schedule,
      })
      .from(activityReports)
      .where(and(eq(activityReports.periodKey, periodKey), inArray(activityReports.userId, ids))),
    db
      .select({
        userId: workLogs.userId,
        visibility: workLogs.visibility,
        chatSummaryVisibility: workLogs.chatSummaryVisibility,
        deletedAt: workLogs.deletedAt,
        // Task statuses only: the titles never leave the database.
        statuses: sql<unknown>`jsonb_path_query_array(${workLogs.tasks}, '$[*].status')`,
      })
      .from(workLogs)
      .where(and(eq(workLogs.periodKey, periodKey), inArray(workLogs.userId, ids))),
  ]);
  for (const id of ids) out.set(id, { report: null, todayLog: null });
  for (const r of reports) {
    const now: NowIn | null =
      isNowKind(r.nowKind) && r.nowUntil
        ? { kind: r.nowKind, refHash: r.nowRefHash ?? null, until: r.nowUntil }
        : null;
    const prev = out.get(r.userId);
    if (prev) out.set(r.userId, { ...prev, report: { now, schedule: toBlocks(r.schedule ?? []) } });
  }
  for (const l of logs) {
    const prev = out.get(l.userId);
    if (!prev) continue;
    out.set(l.userId, {
      ...prev,
      todayLog: {
        log: {
          ownerId: l.userId,
          visibility: l.visibility,
          chatSummaryVisibility: l.chatSummaryVisibility,
          deletedAt: l.deletedAt,
        },
        hasWorkTask: hasWorkTask(statusesOf(l.statuses)),
      },
    });
  }
  return out;
}
