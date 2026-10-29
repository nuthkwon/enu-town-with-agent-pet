import type { ManualDuration, ManualStatus, NowKind, ScheduleKind, TaskStatus } from '@enu/shared';
import {
  WORK_HOURS,
  addLocalDays,
  atLocalTime,
  isBusinessDay,
  isWithinLocalRange,
  startOfLocalDay,
} from '@enu/shared';

/**
 * What a roster member is doing right now, from their own signals only (no steering, no guessing).
 * `resolveActivity` is the owner's state; what colleagues (and, alike, the owner) see of it is decided
 * by `projectForColleagues` in visibility.ts. Nothing here reads the clock: `now` is always an argument.
 * The town's office day is APP_TIMEZONE for every rule, never an owner's own time zone.
 */

export type ActivityName =
  'none' | 'available' | 'focus' | 'meeting' | 'break' | 'work' | 'docs' | 'review' | 'collab' | 'today';
export type ActivitySource = 'none' | 'manual' | 'calendar' | 'claude' | 'work_log' | 'town';
export type PlateNoteName = 'none' | 'away' | 'absent';

/** A calendar block from the owner's own Claude (`refHash` is the keyed daily hash of its ref). */
export interface ScheduleBlockIn {
  start: Date;
  end: Date;
  kind: ScheduleKind;
  refHash: string | null;
}

/** The owner's Claude's "now" report: a kind of work, never free text. */
export interface NowIn {
  kind: NowKind;
  refHash: string | null;
  until: Date;
}

export interface ActivityInputs {
  now: Date;
  /** Session open, held or within the grace after it ended; already gated by canShowLive(). */
  live: boolean;
  /** The owner's own status; an expired one is ignored. */
  manual: { status: ManualStatus; until: Date } | null;
  /** canShareActivity(): without it every Claude-derived input (blocks, now, log) is ignored. */
  share: boolean;
  /** Today's (office date) activity report only. */
  report: { now: NowIn | null; schedule: readonly ScheduleBlockIn[] } | null;
  /** Today's work log: `colleagueVisible` = canViewLog(ANY_COLLEAGUE, ...). Never the log text. */
  todayLog: { colleagueVisible: boolean; hasWorkTask: boolean } | null;
}

export interface ResolvedActivity {
  shown: boolean;
  note: PlateNoteName;
  activity: ActivityName;
  source: ActivitySource;
  until: Date | null;
  groupKey: { family: 'meeting' | 'work'; hash: string } | null;
  /** Focus or meeting: pet bubbles wait (except urgent ones). */
  dnd: boolean;
}

function resolved(
  shown: boolean,
  note: PlateNoteName,
  activity: ActivityName,
  source: ActivitySource,
  until: Date | null,
  groupKey: ResolvedActivity['groupKey'] = null,
): ResolvedActivity {
  return {
    shown,
    note,
    activity,
    source,
    until,
    groupKey,
    dnd: activity === 'focus' || activity === 'meeting',
  };
}

function meetingKey(block: ScheduleBlockIn | null): ResolvedActivity['groupKey'] {
  return block?.refHash ? { family: 'meeting', hash: block.refHash } : null;
}

/**
 * Precedence rows 2–10 of the spec (§2.2), first match wins. Row 1 (office closed) is the projection's.
 * A `now` report or today's log only labels: `shown` then equals `live`, so neither ever draws a person.
 */
export function resolveActivity(i: ActivityInputs): ResolvedActivity {
  const manual = i.manual && i.manual.until > i.now ? i.manual : null;
  const report = i.share ? i.report : null;
  const blocks = report?.schedule ?? [];

  if (manual?.status === 'away') return resolved(false, 'away', 'none', 'manual', manual.until);
  if (manual) {
    // A hand-set 회의 중 still joins the meeting the owner's Claude reported for now.
    const meetings = manual.status === 'meeting' ? blocks.filter((b) => b.kind === 'meeting') : [];
    const key = meetingKey(currentBlock(meetings, i.now));
    return resolved(true, 'none', manual.status, 'manual', manual.until, key);
  }

  const block = currentBlock(blocks, i.now);
  // The end of an away block is owner-side truth only; the projection never shows it.
  if (block?.kind === 'away') return resolved(false, 'absent', 'none', 'calendar', block.end);
  if (block?.kind === 'meeting') {
    return resolved(true, 'none', 'meeting', 'calendar', block.end, meetingKey(block));
  }
  if (block?.kind === 'focus') return resolved(true, 'none', 'focus', 'calendar', block.end);

  const reported = report?.now;
  if (reported && i.now < reported.until) {
    const key = reported.refHash ? { family: 'work' as const, hash: reported.refHash } : null;
    return resolved(i.live, 'none', reported.kind, 'claude', reported.until, key);
  }
  if (i.share && i.todayLog?.colleagueVisible && i.todayLog.hasWorkTask) {
    return resolved(i.live, 'none', 'today', 'work_log', null);
  }
  if (i.live) return resolved(true, 'none', 'none', 'town', null);
  return resolved(false, 'none', 'none', 'none', null);
}

const BLOCK_RANK: Record<ScheduleKind, number> = { away: 0, meeting: 1, focus: 2 };

function compareBlocks(a: ScheduleBlockIn, b: ScheduleBlockIn): number {
  const ra = a.refHash ?? '';
  const rb = b.refHash ?? '';
  return (
    BLOCK_RANK[a.kind] - BLOCK_RANK[b.kind] ||
    a.start.getTime() - b.start.getTime() ||
    a.end.getTime() - b.end.getTime() ||
    (ra < rb ? -1 : ra > rb ? 1 : 0)
  );
}

/** The block covering `now` (start ≤ now < end): away > meeting > focus, then earliest start, then earliest end. */
export function currentBlock(blocks: readonly ScheduleBlockIn[], now: Date): ScheduleBlockIn | null {
  let best: ScheduleBlockIn | null = null;
  for (const b of blocks) {
    if (b.start > now || b.end <= now) continue;
    if (!best || compareBlocks(b, best) < 0) best = b;
  }
  return best;
}

/** Business day (weekends and `holidays` excluded) within WORK_HOURS; `ignore` is the dev/e2e override. */
export function isOfficeOpen(
  now: Date,
  timeZone: string,
  holidays: ReadonlySet<string>,
  ignore = false,
): boolean {
  if (ignore) return true;
  return (
    isBusinessDay(now, timeZone, holidays) &&
    isWithinLocalRange(now, timeZone, WORK_HOURS.start, WORK_HOURS.end)
  );
}

/** The office day containing `now`: [00:00, next 00:00) in `timeZone`. */
export function officeDayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  return {
    start: startOfLocalDay(now, timeZone),
    end: startOfLocalDay(addLocalDays(now, timeZone, 1), timeZone),
  };
}

const MIN = 60_000;
const DURATION_MS: Record<Exclude<ManualDuration, 'today'>, number> = {
  '30m': 30 * MIN,
  '1h': 60 * MIN,
  '2h': 120 * MIN,
};

/**
 * When a manual status set at `now` expires. It never outlives the office day: `today` means the end of
 * WORK_HOURS (or one hour when that has passed), and everything is capped at the next midnight.
 */
export function manualStatusUntil(now: Date, timeZone: string, d: ManualDuration = '1h'): Date {
  let until: Date;
  if (d === 'today') {
    const end = atLocalTime(now, timeZone, WORK_HOURS.end);
    until = end > now ? end : new Date(now.getTime() + DURATION_MS['1h']);
  } else {
    until = new Date(now.getTime() + DURATION_MS[d]);
  }
  const midnight = officeDayBounds(now, timeZone).end;
  return until < midnight ? until : midnight;
}

const WORK_TASK_STATUSES: ReadonlySet<string> = new Set<TaskStatus>(['done', 'in_progress', 'blocked']);

/** A log earns the "오늘 업무 기록" label only with a task that was worked on (planned-only logs do not). */
export function hasWorkTask(tasks: readonly { status: string }[]): boolean {
  return tasks.some((t) => WORK_TASK_STATUSES.has(t.status));
}
