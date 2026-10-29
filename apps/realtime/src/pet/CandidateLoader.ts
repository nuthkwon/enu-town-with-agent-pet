import { loadHolidays, nudgeDeliveries, petNudges, profiles, todos, type Db } from '@enu/db';
import type { BubbleCandidate, DeliveryHistory, NudgePrefs, PolicyTiming } from '@enu/domain';
import { NUDGE_POLICY, localDateKey, startOfLocalDay } from '@enu/shared';
import { and, count, eq, gt, gte, inArray, isNotNull, lt, lte, max, sql } from 'drizzle-orm';
import type { Clock } from '../clock';

declare const claudeAuthoredBrand: unique symbol;

/**
 * Text exactly as the owner's own Claude wrote it (pet nudge text or to-do title).
 * Only this module can produce the brand, so nothing else can put arbitrary text in a pet bubble.
 */
export type ClaudeAuthoredText = string & { readonly [claudeAuthoredBrand]: true };

function claudeAuthored(text: string): ClaudeAuthoredText {
  return text as ClaudeAuthoredText;
}

/** A bubble candidate whose text provably came from the DB rows Claude wrote. */
export interface Candidate extends BubbleCandidate {
  text: ClaudeAuthoredText;
  /** The pet that says it (a nudge's `pet_id`); null = the owner's default pet. */
  petId: string | null;
}

export interface NudgeRow {
  id: string;
  text: string;
  priority: number;
  showAfter: Date;
  snoozedUntil: Date | null;
  expiresAt: Date;
  showCount: number;
  maxShows: number;
  createdAt: Date;
  /** Due time of the linked to-do, if any (drawn as a chip outside the bubble). */
  dueAt: Date | null;
  /** The owner's pet chosen by their Claude; null = the default pet. */
  petId?: string | null;
}

export interface TodoRow {
  id: string;
  title: string;
  priority: number;
  dueAt: Date;
  createdAt: Date;
}

export function nudgeRowToCandidate(row: NudgeRow): Candidate {
  const eligibleAt =
    row.snoozedUntil && row.snoozedUntil.getTime() > row.showAfter.getTime()
      ? row.snoozedUntil
      : row.showAfter;
  return {
    kind: 'nudge',
    refId: row.id,
    text: claudeAuthored(row.text),
    priority: row.priority,
    eligibleAt,
    expiresAt: row.expiresAt,
    dueAt: row.dueAt,
    shownCount: row.showCount,
    maxShows: row.maxShows,
    createdAt: row.createdAt,
    petId: row.petId ?? null,
  };
}

export function todoRowToCandidate(row: TodoRow, timing: Pick<PolicyTiming, 'dueWindowsMin'>): Candidate {
  const widestMin = Math.max(0, ...timing.dueWindowsMin);
  return {
    kind: 'todo_due',
    refId: row.id,
    text: claudeAuthored(row.title),
    priority: row.priority,
    eligibleAt: new Date(row.dueAt.getTime() - widestMin * 60_000),
    expiresAt: row.dueAt,
    dueAt: row.dueAt,
    shownCount: 0,
    maxShows: timing.dueWindowsMin.length,
    createdAt: row.createdAt,
    petId: null,
  };
}

export interface HistorySnapshot extends DeliveryHistory {
  /** Local date key the `shownToday` count belongs to. */
  dayKey: string;
  /** Due-window keys (`todoId:minutes`) already delivered recently, so a reconnect never repeats them. */
  firedDueKeys: string[];
}

export interface OwnerSnapshot {
  candidates: Candidate[];
  history: HistorySnapshot;
  prefs: NudgePrefs;
}

export interface CandidateLoaderDeps {
  db: Db;
  clock: Clock;
  timing: PolicyTiming;
  /** NUDGE_MIN_INTERVAL_MIN env override (e2e/tests); replaces the profile value. */
  minIntervalOverrideMin?: number;
  /** NUDGE_IGNORE_QUIET_HOURS (development/e2e only). */
  ignoreQuietHours?: boolean;
  holidaysTtlMs?: number;
}

/** Reads a connected owner's bubble candidates, delivery history and preferences. */
export class CandidateLoader {
  private holidayCache: { at: number; set: Set<string> } | null = null;

  constructor(private readonly deps: CandidateLoaderDeps) {}

  async load(userId: string): Promise<OwnerSnapshot | null> {
    const now = this.deps.clock.now();
    const prefs = await this.loadPrefs(userId);
    if (!prefs) return null;
    const [candidates, history] = await Promise.all([
      this.loadCandidates(userId, now),
      this.loadHistory(userId, now, prefs.timeZone),
    ]);
    return { candidates, history, prefs };
  }

  async loadCandidates(userId: string, now: Date): Promise<Candidate[]> {
    const { db, timing } = this.deps;
    const horizon = new Date(now.getTime() + NUDGE_POLICY.candidateHorizonMs);
    const eligible = sql<Date>`coalesce(${petNudges.snoozedUntil}, ${petNudges.showAfter})`;
    const nudgeRows = await db
      .select({
        id: petNudges.id,
        text: petNudges.text,
        priority: petNudges.priority,
        showAfter: petNudges.showAfter,
        snoozedUntil: petNudges.snoozedUntil,
        expiresAt: petNudges.expiresAt,
        showCount: petNudges.showCount,
        maxShows: petNudges.maxShows,
        createdAt: petNudges.createdAt,
        dueAt: todos.dueAt,
        petId: petNudges.petId,
      })
      .from(petNudges)
      .leftJoin(todos, eq(todos.id, petNudges.todoId))
      .where(
        and(
          eq(petNudges.userId, userId),
          inArray(petNudges.status, ['pending', 'shown', 'snoozed']),
          gt(petNudges.expiresAt, now),
          lte(eligible, horizon),
          lt(petNudges.showCount, petNudges.maxShows),
        ),
      );
    const todoRows = await db
      .select({
        id: todos.id,
        title: todos.title,
        priority: todos.priority,
        dueAt: todos.dueAt,
        createdAt: todos.createdAt,
      })
      .from(todos)
      .where(
        and(
          eq(todos.userId, userId),
          eq(todos.status, 'open'),
          isNotNull(todos.dueAt),
          gt(todos.dueAt, now),
          lte(todos.dueAt, horizon),
        ),
      );
    return [
      ...nudgeRows.map(nudgeRowToCandidate),
      ...todoRows.flatMap((r) => (r.dueAt ? [todoRowToCandidate({ ...r, dueAt: r.dueAt }, timing)] : [])),
    ];
  }

  async loadHistory(userId: string, now: Date, timeZone: string): Promise<HistorySnapshot> {
    const { db } = this.deps;
    const dayStart = startOfLocalDay(now, timeZone);
    const [last] = await db
      .select({ lastShownAt: max(nudgeDeliveries.shownAt) })
      .from(nudgeDeliveries)
      .where(eq(nudgeDeliveries.userId, userId));
    const [today] = await db
      .select({ n: count() })
      .from(nudgeDeliveries)
      .where(and(eq(nudgeDeliveries.userId, userId), gte(nudgeDeliveries.shownAt, dayStart)));
    const dueRows = await db
      .select({ dueKey: nudgeDeliveries.dueKey })
      .from(nudgeDeliveries)
      .where(
        and(
          eq(nudgeDeliveries.userId, userId),
          isNotNull(nudgeDeliveries.dueKey),
          gte(nudgeDeliveries.shownAt, new Date(now.getTime() - NUDGE_POLICY.candidateHorizonMs)),
        ),
      );
    return {
      lastShownAt: last?.lastShownAt ?? null,
      shownToday: today?.n ?? 0,
      dayKey: localDateKey(now, timeZone),
      firedDueKeys: dueRows.flatMap((r) => (r.dueKey ? [r.dueKey] : [])),
    };
  }

  async loadPrefs(userId: string): Promise<NudgePrefs | null> {
    const [p] = await this.deps.db
      .select({
        nudgesEnabled: profiles.nudgesEnabled,
        minIntervalMin: profiles.nudgeMinIntervalMin,
        maxPerDay: profiles.maxBubblesPerDay,
        quietStart: profiles.quietStart,
        quietEnd: profiles.quietEnd,
        timeZone: profiles.timezone,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!p) return null;
    return {
      nudgesEnabled: p.nudgesEnabled,
      minIntervalMin: this.deps.minIntervalOverrideMin ?? p.minIntervalMin,
      maxPerDay: p.maxPerDay,
      quietStart: p.quietStart,
      quietEnd: p.quietEnd,
      timeZone: p.timeZone,
      holidays: await this.holidays(),
      ignoreQuietHours: this.deps.ignoreQuietHours ?? false,
    };
  }

  /** Holiday calendar, cached (it changes about once a year). */
  async holidays(): Promise<ReadonlySet<string>> {
    const ttl = this.deps.holidaysTtlMs ?? 6 * 60 * 60 * 1000;
    const nowMs = Date.now();
    if (this.holidayCache && nowMs - this.holidayCache.at < ttl) return this.holidayCache.set;
    const set = await loadHolidays(this.deps.db);
    this.holidayCache = { at: nowMs, set };
    return set;
  }

  /**
   * Whether a bubble on screen may stay: its nudge is still pending/shown (not acked, dismissed,
   * snoozed, expired or superseded) or its to-do is still open.
   */
  async isStillShowable(bubble: { kind: Candidate['kind']; refId: string }, now: Date): Promise<boolean> {
    const { db } = this.deps;
    if (bubble.kind === 'nudge') {
      const [n] = await db
        .select({ status: petNudges.status, expiresAt: petNudges.expiresAt })
        .from(petNudges)
        .where(eq(petNudges.id, bubble.refId))
        .limit(1);
      return !!n && (n.status === 'pending' || n.status === 'shown') && n.expiresAt > now;
    }
    const [t] = await db
      .select({ status: todos.status })
      .from(todos)
      .where(eq(todos.id, bubble.refId))
      .limit(1);
    return !!t && t.status === 'open';
  }
}
