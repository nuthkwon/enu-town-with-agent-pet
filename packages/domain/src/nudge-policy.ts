import type { LinkState } from '@enu/shared';
import { NUDGE_POLICY, graphemeLength, isBusinessDay, isWithinLocalRange } from '@enu/shared';

/**
 * Pure rules for WHEN a pet shows one of its owner's Claude-authored texts.
 * The realtime scheduler feeds presence/history in and applies the result;
 * nothing here produces text — candidates carry Claude's text unchanged.
 */

export type CandidateKind = 'nudge' | 'todo_due';
export type Trigger = 'join' | 'idle' | 'due' | 'urgent';

export interface BubbleCandidate {
  kind: CandidateKind;
  refId: string;
  /** Exactly what the owner's Claude wrote (nudge text or to-do title). */
  text: string;
  priority: number;
  eligibleAt: Date;
  expiresAt: Date;
  dueAt: Date | null;
  shownCount: number;
  maxShows: number;
  createdAt: Date;
}

export interface NudgePrefs {
  nudgesEnabled: boolean;
  minIntervalMin: number;
  maxPerDay: number;
  quietStart: string;
  quietEnd: string;
  timeZone: string;
  holidays: ReadonlySet<string>;
  /** Development/e2e only (NUDGE_IGNORE_QUIET_HOURS): never treat the time as quiet. */
  ignoreQuietHours?: boolean;
}

export interface OwnerPresence {
  linkState: LinkState;
  tabVisible: boolean;
  uiBusy: boolean;
  /** Focus status or inside the meeting room zone. */
  doNotDisturb: boolean;
  joinedAt: Date;
  lastActivityAt: Date;
  hasActiveBubble: boolean;
}

export interface DeliveryHistory {
  lastShownAt: Date | null;
  shownToday: number;
}

export interface SchedulerFlags {
  joinFired: boolean;
  /** Idle trigger fires once per idle period; re-armed by activity. */
  idleArmed: boolean;
  firedDueKeys: ReadonlySet<string>;
}

export interface PolicyTiming {
  joinDelayMs: number;
  idleMs: number;
  dueWindowsMin: readonly number[];
  urgentMinIntervalMin: number;
}

export const DEFAULT_TIMING: PolicyTiming = {
  joinDelayMs: NUDGE_POLICY.joinDelayMs,
  idleMs: NUDGE_POLICY.idleMs,
  dueWindowsMin: NUDGE_POLICY.dueWindowsMin,
  urgentMinIntervalMin: NUDGE_POLICY.urgentMinIntervalMin,
};

export type Selection =
  | { show: true; candidate: BubbleCandidate; trigger: Trigger; dueKey?: string }
  | { show: false; reason: string };

const MIN = 60_000;

export function compareCandidates(a: BubbleCandidate, b: BubbleCandidate): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const ad = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bd = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export function isQuietTime(now: Date, prefs: NudgePrefs): boolean {
  if (prefs.ignoreQuietHours) return false;
  return (
    !isBusinessDay(now, prefs.timeZone, prefs.holidays) ||
    isWithinLocalRange(now, prefs.timeZone, prefs.quietStart, prefs.quietEnd)
  );
}

function isLive(c: BubbleCandidate, now: Date): boolean {
  if (c.eligibleAt > now || c.expiresAt <= now) return false;
  return c.kind === 'todo_due' || c.shownCount < c.maxShows;
}

/** Finds the to-do whose due window was just entered and has not fired yet. */
function dueTrigger(candidates: BubbleCandidate[], now: Date, flags: SchedulerFlags, timing: PolicyTiming) {
  const due = candidates
    .filter((c) => c.kind === 'todo_due' && c.dueAt && c.dueAt > now)
    .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime());
  for (const c of due) {
    const minutesLeft = ((c.dueAt as Date).getTime() - now.getTime()) / MIN;
    // Smallest window that has been entered, e.g. 4 min left -> the 5-min window.
    const windows = [...timing.dueWindowsMin].sort((a, b) => a - b);
    const w = windows.find((win) => minutesLeft <= win);
    if (w === undefined) continue;
    const key = `${c.refId}:${w}`;
    if (!flags.firedDueKeys.has(key)) return { candidate: c, key };
  }
  return null;
}

export function selectBubble(input: {
  now: Date;
  prefs: NudgePrefs;
  presence: OwnerPresence;
  history: DeliveryHistory;
  flags: SchedulerFlags;
  candidates: BubbleCandidate[];
  timing?: PolicyTiming;
}): Selection {
  const { now, prefs, presence, history, flags } = input;
  const timing = input.timing ?? DEFAULT_TIMING;

  if (!prefs.nudgesEnabled) return { show: false, reason: 'disabled' };
  if (presence.linkState === 'not_linked') return { show: false, reason: 'not_linked' };
  if (presence.hasActiveBubble) return { show: false, reason: 'busy_bubble' };
  if (!presence.tabVisible || presence.uiBusy) return { show: false, reason: 'not_watching' };
  if (isQuietTime(now, prefs)) return { show: false, reason: 'quiet' };
  if (history.shownToday >= prefs.maxPerDay) return { show: false, reason: 'daily_cap' };

  const live = input.candidates.filter((c) => isLive(c, now)).sort(compareCandidates);
  if (live.length === 0) return { show: false, reason: 'no_candidates' };

  const sinceLast = history.lastShownAt ? (now.getTime() - history.lastShownAt.getTime()) / MIN : Infinity;
  const normalOk = sinceLast >= prefs.minIntervalMin && !presence.doNotDisturb;
  const urgentOk = sinceLast >= Math.min(timing.urgentMinIntervalMin, prefs.minIntervalMin);

  const due = dueTrigger(live, now, flags, timing);
  if (due && urgentOk) return { show: true, candidate: due.candidate, trigger: 'due', dueKey: due.key };

  const urgent = live.find((c) => c.kind === 'nudge' && c.priority === 1 && c.shownCount === 0);
  if (urgent && urgentOk) return { show: true, candidate: urgent, trigger: 'urgent' };

  if (!normalOk) return { show: false, reason: presence.doNotDisturb ? 'do_not_disturb' : 'interval' };

  const nudges = live.filter((c) => c.kind === 'nudge');
  const best = nudges[0];
  if (!best) return { show: false, reason: 'no_nudges' };

  if (!flags.joinFired && now.getTime() - presence.joinedAt.getTime() >= timing.joinDelayMs) {
    return { show: true, candidate: best, trigger: 'join' };
  }
  if (flags.idleArmed && now.getTime() - presence.lastActivityAt.getTime() >= timing.idleMs) {
    return { show: true, candidate: best, trigger: 'idle' };
  }
  return { show: false, reason: 'no_trigger' };
}

export function bubbleDisplayMs(text: string): number {
  const ms = 5000 + 70 * graphemeLength(text);
  return Math.min(NUDGE_POLICY.displayMaxMs, Math.max(NUDGE_POLICY.displayMinMs, ms));
}
