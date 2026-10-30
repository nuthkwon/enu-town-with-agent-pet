import { desks, privacyConsents, profiles, user, workLogEntries, workLogs, type DbOrTx } from '@enu/db';
import {
  DEFAULT_RETENTION,
  canListWorkLogEntry,
  clampFeedDay,
  compareFeedPeople,
  feedDayNav,
  lastUpdateTime,
  projectWorkLogFeed,
  type FeedRow,
} from '@enu/domain';
import {
  PRIVACY_NOTICE_VERSION,
  TASK_STATUSES,
  localDateKey,
  type OverviewMemberDto,
  type OverviewTodayDto,
  type TaskStatus,
  type WorkLogFeedDto,
} from '@enu/shared';
import { and, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import { asTeamId, provenanceLabel } from '../dto';
import { getEnv } from '../env';

/**
 * The work overview (ADR 0007): the company-wide feed of work-log changes and today's status, the same for every
 * viewer. SQL pre-filters (company, not deleted, not edited, active author with the current notice accepted); every
 * row still passes `canListWorkLogEntry`, and `projectWorkLogFeed` decides times and digests. Nothing that carries
 * time (ISO timestamps, sequences, sources) leaves this module.
 */

const consented = (db: DbOrTx) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(privacyConsents)
      .where(
        and(
          eq(privacyConsents.userId, workLogs.userId),
          eq(privacyConsents.noticeVersion, PRIVACY_NOTICE_VERSION),
          eq(privacyConsents.scope, 'service'),
          isNull(privacyConsents.withdrawnAt),
        ),
      ),
  );

const listable = (db: DbOrTx) =>
  and(
    eq(workLogs.visibility, 'company'),
    isNull(workLogs.deletedAt),
    eq(workLogs.editedByUser, false),
    eq(user.status, 'active'),
    consented(db),
  );

async function feedRows(db: DbOrTx, day: string): Promise<FeedRow[]> {
  const rows = await db
    .select({
      entry: workLogEntries,
      log: {
        ownerId: workLogs.userId,
        visibility: workLogs.visibility,
        chatSummaryVisibility: workLogs.chatSummaryVisibility,
        deletedAt: workLogs.deletedAt,
        editedByUser: workLogs.editedByUser,
      },
      name: profiles.displayName,
      fallbackName: user.name,
      team: profiles.team,
      shareActivity: profiles.shareActivity,
      status: user.status,
      noticeAccepted: sql<boolean>`${consented(db)}`,
      deskId: desks.deskId,
    })
    .from(workLogEntries)
    .innerJoin(workLogs, eq(workLogs.id, workLogEntries.logId))
    .innerJoin(user, eq(user.id, workLogs.userId))
    .leftJoin(profiles, eq(profiles.userId, workLogs.userId))
    .leftJoin(desks, eq(desks.userId, workLogs.userId))
    .where(and(eq(workLogEntries.dayKey, day), listable(db)));
  return rows
    .filter((r) =>
      canListWorkLogEntry(r.log, {
        active: r.status === 'active',
        noticeAccepted: r.noticeAccepted === true,
      }),
    )
    .map((r) => ({
      entryId: r.entry.id,
      logId: r.entry.logId,
      userId: r.log.ownerId,
      authorName: r.name ?? r.fallbackName,
      team: asTeamId(r.team),
      deskId: r.deskId ?? null,
      dayKey: r.entry.dayKey,
      seq: r.entry.seq,
      writtenAt: r.entry.writtenAt,
      inOfficeHours: r.entry.inOfficeHours,
      changes: r.entry.changes,
      author: { active: r.status === 'active', shareActivity: r.shareActivity },
    }));
}

/** GET /api/v1/overview/feed?day: one office day of the feed (today when absent or out of range). */
export async function loadFeed(
  db: DbOrTx,
  requestedDay: string | null,
  now = new Date(),
): Promise<WorkLogFeedDto> {
  const timeZone = getEnv().APP_TIMEZONE;
  const todayKey = localDateKey(now, timeZone);
  const retention = DEFAULT_RETENTION.workLog;
  const day = clampFeedDay(requestedDay, todayKey, retention);
  const items = projectWorkLogFeed(await feedRows(db, day), { todayKey, timeZone });
  return { day, isToday: day === todayKey, items, ...feedDayNav(day, todayKey, retention) };
}

const STATUSES: ReadonlySet<string> = new Set(TASK_STATUSES);

/**
 * GET /api/v1/overview/today: the people with a company log listed in today's feed, with that log as it is now.
 * Nobody appears for having no log.
 */
export async function loadToday(db: DbOrTx, now = new Date()): Promise<OverviewTodayDto> {
  const timeZone = getEnv().APP_TIMEZONE;
  const todayKey = localDateKey(now, timeZone);
  const rows = await feedRows(db, todayKey);
  const byLog = new Map<string, FeedRow[]>();
  for (const r of rows) byLog.set(r.logId, [...(byLog.get(r.logId) ?? []), r]);
  if (byLog.size === 0) return { day: todayKey, members: [] };

  const logs = await db
    .select({
      id: workLogs.id,
      summary: workLogs.summary,
      tasks: workLogs.tasks,
      blockers: workLogs.blockers,
    })
    .from(workLogs)
    .where(inArray(workLogs.id, [...byLog.keys()]));
  const people: (OverviewMemberDto & { deskId: string | null })[] = [];
  for (const log of logs) {
    const entries = byLog.get(log.id);
    const first = entries?.[0];
    if (!entries || !first) continue;
    people.push({
      userId: first.userId,
      authorName: first.authorName,
      team: first.team,
      deskId: first.deskId,
      logId: log.id,
      summary: log.summary,
      tasks: (log.tasks ?? [])
        .filter((t) => STATUSES.has(t.status))
        .map((t) => ({ title: t.title, status: t.status as TaskStatus })),
      blockers: log.blockers ?? [],
      provenanceLabel: provenanceLabel(first.authorName, false),
      lastUpdate: lastUpdateTime(entries, { todayKey, timeZone }),
    });
  }
  people.sort(compareFeedPeople);
  return { day: todayKey, members: people.map(({ deskId: _deskId, ...m }) => m) };
}
