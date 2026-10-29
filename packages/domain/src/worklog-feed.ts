import { DESK_IDS, TEAM_IDS, formatLocalHm, type TeamId, type WorkLogChange } from '@enu/shared';
import { canShowWorkLogEntryTime } from './visibility';
import { mergeWorkLogChanges } from './worklog-delta';

/**
 * The work feed of the overview (ADR 0007), from rows the caller already filtered with `canListWorkLogEntry`.
 * Today's office-hours writes of authors who share activity are listed one per write, newest first, with `HH:MM`;
 * everything else becomes one digest per person per day, ordered by team, desk and name, so neither the number of
 * writes nor their order within a day shows. Pure: the caller passes today's key.
 */

export interface FeedRow {
  entryId: string;
  logId: string;
  userId: string;
  authorName: string;
  team: TeamId | null;
  deskId: string | null;
  /** Office day (`APP_TIMEZONE`). */
  dayKey: string;
  seq: number;
  /** Null once the nightly purge merged the day. */
  writtenAt: Date | null;
  inOfficeHours: boolean;
  changes: WorkLogChange[];
  author: { active: boolean; shareActivity: boolean | null };
}

export interface FeedItem {
  id: string;
  logId: string;
  userId: string;
  authorName: string;
  team: TeamId | null;
  dayKey: string;
  time: string | null;
  form: 'entry' | 'digest';
  changes: WorkLogChange[];
}

const rank = <T>(list: readonly T[], v: T | null): number => {
  const i = v === null ? -1 : list.indexOf(v);
  return i < 0 ? list.length : i;
};

/** Team order, then seat order, then name (Korean collation): never anything that carries time. */
export function compareFeedPeople(
  a: { team: TeamId | null; deskId: string | null; authorName: string; userId: string },
  b: { team: TeamId | null; deskId: string | null; authorName: string; userId: string },
): number {
  return (
    rank(TEAM_IDS, a.team) - rank(TEAM_IDS, b.team) ||
    rank<string>(DESK_IDS, a.deskId) - rank<string>(DESK_IDS, b.deskId) ||
    a.authorName.localeCompare(b.authorName, 'ko') ||
    (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  );
}

const timed = (r: FeedRow, todayKey: string) =>
  r.writtenAt !== null && canShowWorkLogEntryTime(r, todayKey, r.author);

export function projectWorkLogFeed(
  rows: readonly FeedRow[],
  opts: { todayKey: string; timeZone: string },
): FeedItem[] {
  const entries: (FeedItem & { at: number })[] = [];
  const days = new Map<string, FeedRow[]>();
  for (const r of rows) {
    if (timed(r, opts.todayKey)) {
      entries.push({
        id: r.entryId,
        logId: r.logId,
        userId: r.userId,
        authorName: r.authorName,
        team: r.team,
        dayKey: r.dayKey,
        time: formatLocalHm(r.writtenAt!, opts.timeZone),
        form: 'entry',
        changes: r.changes,
        at: r.writtenAt!.getTime(),
      });
    } else {
      const key = `${r.logId}:${r.dayKey}`;
      const list = days.get(key) ?? [];
      list.push(r);
      days.set(key, list);
    }
  }
  entries.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));

  const digests: { item: FeedItem; person: FeedRow }[] = [];
  for (const [key, list] of days) {
    list.sort((a, b) => a.seq - b.seq);
    const changes = mergeWorkLogChanges(list.map((r) => r.changes));
    if (changes.length === 0) continue;
    const first = list[0]!;
    digests.push({
      person: first,
      item: {
        id: key,
        logId: first.logId,
        userId: first.userId,
        authorName: first.authorName,
        team: first.team,
        dayKey: first.dayKey,
        time: null,
        form: 'digest',
        changes,
      },
    });
  }
  digests.sort(
    (a, b) =>
      (a.item.dayKey < b.item.dayKey ? 1 : a.item.dayKey > b.item.dayKey ? -1 : 0) ||
      compareFeedPeople(a.person, b.person),
  );
  return [...entries.map(({ at: _at, ...item }) => item), ...digests.map((d) => d.item)];
}

/**
 * The time to show beside a person's log today: the latest write's `HH:MM` when the feed may show that write, else
 * null (never an earlier write's time, which would hide that a later one happened outside office hours).
 */
export function lastUpdateTime(
  rows: readonly FeedRow[],
  opts: { todayKey: string; timeZone: string },
): string | null {
  let latest: FeedRow | null = null;
  for (const r of rows) if (r.dayKey === opts.todayKey && (!latest || r.seq > latest.seq)) latest = r;
  return latest && timed(latest, opts.todayKey) ? formatLocalHm(latest.writtenAt!, opts.timeZone) : null;
}

const DAY_MS = 86_400_000;
const toUtc = (key: string) => Date.parse(`${key}T00:00:00Z`);
const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Previous and next calendar days inside the retention window (independent of what the days hold). */
export function feedDayNav(
  day: string,
  todayKey: string,
  retentionDays: number,
): { prevDay: string | null; nextDay: string | null } {
  const d = toUtc(day);
  const oldest = toUtc(todayKey) - retentionDays * DAY_MS;
  const prev = d - DAY_MS;
  const next = d + DAY_MS;
  return {
    prevDay: prev >= oldest ? toKey(prev) : null,
    nextDay: next <= toUtc(todayKey) ? toKey(next) : null,
  };
}

/** Clamps a requested day (YYYY-MM-DD, may be junk) into the retention window; today when invalid. */
export function clampFeedDay(requested: string | null, todayKey: string, retentionDays: number): string {
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested) || Number.isNaN(toUtc(requested))) return todayKey;
  const d = toUtc(requested);
  const today = toUtc(todayKey);
  const oldest = today - retentionDays * DAY_MS;
  return toKey(Math.min(today, Math.max(oldest, d)));
}
