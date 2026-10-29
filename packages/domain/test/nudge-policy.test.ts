import { describe, expect, it } from 'vitest';
import { bubbleDisplayMs, selectBubble, type BubbleCandidate } from '../src/nudge-policy';

const now = new Date('2026-10-29T03:00:00Z'); // Thu 12:00 KST
const prefs = {
  nudgesEnabled: true,
  minIntervalMin: 25,
  maxPerDay: 8,
  quietStart: '19:30',
  quietEnd: '08:30',
  timeZone: 'Asia/Seoul',
  holidays: new Set<string>(),
};
const presence = {
  linkState: 'linked' as const,
  tabVisible: true,
  uiBusy: false,
  doNotDisturb: false,
  officeOpen: true,
  joinedAt: new Date(now.getTime() - 60_000),
  lastHiddenMs: 0,
  hasActiveBubble: false,
};
const history = { lastShownAt: null, shownToday: 0 };
const flags = { joinFired: false, glanceArmed: false, firedDueKeys: new Set<string>() };
const afterJoin = { ...flags, joinFired: true };
const longAgo = { lastShownAt: new Date(now.getTime() - 60 * 60_000), shownToday: 1 };
const nudge = (over: Partial<BubbleCandidate> = {}): BubbleCandidate => ({
  kind: 'nudge',
  refId: 'n1',
  text: '점심 전에 PR 리뷰 하나 끝내 볼까요?',
  priority: 2,
  eligibleAt: new Date(now.getTime() - 1000),
  expiresAt: new Date(now.getTime() + 3600_000),
  dueAt: null,
  shownCount: 0,
  maxShows: 2,
  createdAt: new Date(now.getTime() - 5000),
  ...over,
});
const run = (over: Partial<Parameters<typeof selectBubble>[0]> = {}) =>
  selectBubble({ now, prefs, presence, history, flags, candidates: [nudge()], ...over });

describe('selectBubble', () => {
  it('shows the best nudge on join', () => {
    expect(run()).toMatchObject({ show: true, trigger: 'join', candidate: { refId: 'n1' } });
  });

  it('never speaks for an unlinked pet', () => {
    expect(run({ presence: { ...presence, linkState: 'not_linked' } })).toEqual({ show: false, reason: 'not_linked' });
  });

  it('respects quiet hours, weekends and the daily cap', () => {
    expect(run({ now: new Date('2026-10-29T11:00:00Z') })).toMatchObject({ show: false, reason: 'quiet' });
    expect(run({ now: new Date('2026-10-31T03:00:00Z') })).toMatchObject({ show: false, reason: 'quiet' });
    expect(run({ history: { lastShownAt: null, shownToday: 8 } })).toMatchObject({ show: false, reason: 'daily_cap' });
  });

  it('can ignore quiet hours for development and e2e runs', () => {
    const night = new Date('2026-10-31T13:00:00Z'); // Saturday 22:00 KST
    const at = {
      now: night,
      presence: { ...presence, joinedAt: new Date(night.getTime() - 60_000) },
      candidates: [nudge({ eligibleAt: new Date(night.getTime() - 1000), expiresAt: new Date(night.getTime() + 3600_000) })],
    };
    expect(run(at)).toMatchObject({ show: false, reason: 'quiet' });
    expect(run({ ...at, prefs: { ...prefs, ignoreQuietHours: true } })).toMatchObject({ show: true });
  });

  it('enforces the interval but lets urgent items through after 10 minutes', () => {
    const recent = { lastShownAt: new Date(now.getTime() - 12 * 60_000), shownToday: 1 };
    expect(run({ history: recent })).toMatchObject({ show: false, reason: 'interval' });
    expect(run({ history: recent, candidates: [nudge({ priority: 1 })] })).toMatchObject({ show: true, trigger: 'urgent' });
  });

  it('fires the due window once per to-do and window', () => {
    const todo = nudge({ kind: 'todo_due', refId: 't1', text: '견적서 회신', dueAt: new Date(now.getTime() + 4 * 60_000) });
    const first = run({ candidates: [todo], flags: { ...flags, joinFired: true } });
    expect(first).toMatchObject({ show: true, trigger: 'due', dueKey: 't1:5' });
    const again = run({ candidates: [todo], flags: { ...flags, joinFired: true, firedDueKeys: new Set(['t1:5']) } });
    expect(again).toMatchObject({ show: false });
  });

  it('only urgent items during focus/meeting', () => {
    const dnd = { ...presence, doNotDisturb: true };
    expect(run({ presence: dnd })).toMatchObject({ show: false, reason: 'do_not_disturb' });
    expect(run({ presence: dnd, candidates: [nudge({ priority: 1 })] })).toMatchObject({ show: true });
  });

  it('stops repeating after max shows and when expired', () => {
    expect(run({ candidates: [nudge({ shownCount: 2 })] })).toMatchObject({ show: false, reason: 'no_candidates' });
    expect(run({ candidates: [nudge({ expiresAt: now })] })).toMatchObject({ show: false, reason: 'no_candidates' });
  });

  it('is forced quiet while the office is closed, even with no quiet hours configured', () => {
    const closed = { ...presence, officeOpen: false };
    const noQuiet = { ...prefs, quietStart: '00:00', quietEnd: '00:00', ignoreQuietHours: true };
    expect(run({ presence: closed, prefs: noQuiet })).toEqual({ show: false, reason: 'quiet' });
    const todo = nudge({ kind: 'todo_due', refId: 't1', dueAt: new Date(now.getTime() + 4 * 60_000) });
    expect(run({ presence: closed, candidates: [todo, nudge({ priority: 1 })] })).toEqual({ show: false, reason: 'quiet' });
  });

  it('waits for the join delay before anything but due and urgent items', () => {
    const justJoined = { ...presence, joinedAt: new Date(now.getTime() - 2_000) };
    expect(run({ presence: justJoined })).toEqual({ show: false, reason: 'no_trigger' });
    expect(run({ presence: justJoined, candidates: [nudge({ priority: 1 })] })).toMatchObject({ trigger: 'urgent' });
  });

  it('shows a newly eligible nudge once after join, respecting the interval and DND', () => {
    const fresh = nudge({ refId: 'n2', createdAt: new Date(now.getTime() - 1000) });
    const seen = nudge({ refId: 'n1', priority: 1, shownCount: 1 });
    const at = { flags: afterJoin, history: longAgo, candidates: [seen, fresh] };
    // The higher-priority nudge was already shown; `eligible` picks the best one never shown.
    expect(run(at)).toMatchObject({ show: true, trigger: 'eligible', candidate: { refId: 'n2' } });
    expect(run({ ...at, candidates: [seen] })).toEqual({ show: false, reason: 'no_trigger' });
    const recent = { lastShownAt: new Date(now.getTime() - 10 * 60_000), shownToday: 1 };
    expect(run({ ...at, history: recent })).toEqual({ show: false, reason: 'interval' });
    expect(run({ ...at, presence: { ...presence, doNotDisturb: true } })).toEqual({ show: false, reason: 'do_not_disturb' });
    // show_after not reached yet: not eligible.
    const later = nudge({ refId: 'n3', eligibleAt: new Date(now.getTime() + 60_000) });
    expect(run({ ...at, candidates: [seen, later] })).toEqual({ show: false, reason: 'no_trigger' });
  });

  it('repeats a shown nudge only when the owner returns after being away from the tab long enough', () => {
    const seen = nudge({ shownCount: 1 });
    const back = (hiddenMs: number, over: { armed?: boolean; dnd?: boolean; candidate?: BubbleCandidate } = {}) =>
      run({
        presence: { ...presence, lastHiddenMs: hiddenMs, doNotDisturb: over.dnd ?? false },
        flags: { ...afterJoin, glanceArmed: over.armed ?? true },
        history: longAgo,
        candidates: [over.candidate ?? seen],
      });
    expect(back(600_000)).toMatchObject({ show: true, trigger: 'glance', candidate: { refId: 'n1', shownCount: 1 } });
    expect(back(599_999)).toEqual({ show: false, reason: 'no_trigger' });
    // Once per return: the scheduler disarms the flag after it fired.
    expect(back(600_000, { armed: false })).toEqual({ show: false, reason: 'no_trigger' });
    expect(back(600_000, { dnd: true })).toEqual({ show: false, reason: 'do_not_disturb' });
    // max_shows keeps its meaning.
    expect(back(600_000, { candidate: nudge({ shownCount: 2 }) })).toEqual({ show: false, reason: 'no_candidates' });
  });

  it('orders triggers due > urgent > join > eligible > glance', () => {
    const todo = nudge({ kind: 'todo_due', refId: 't1', text: '견적서 회신', dueAt: new Date(now.getTime() + 4 * 60_000) });
    const urgent = nudge({ refId: 'u1', priority: 1 });
    const fresh = nudge({ refId: 'n2' });
    const seen = nudge({ refId: 'n1', shownCount: 1 });
    const all = {
      presence: { ...presence, lastHiddenMs: 600_000 },
      flags: { ...flags, glanceArmed: true },
      history: longAgo,
      candidates: [seen, fresh, urgent, todo],
    };
    expect(run(all)).toMatchObject({ trigger: 'due' });
    expect(run({ ...all, candidates: [seen, fresh, urgent] })).toMatchObject({ trigger: 'urgent' });
    expect(run({ ...all, candidates: [seen, fresh] })).toMatchObject({ trigger: 'join' });
    expect(run({ ...all, flags: { ...all.flags, joinFired: true }, candidates: [seen, fresh] })).toMatchObject({
      trigger: 'eligible',
    });
    expect(run({ ...all, flags: { ...all.flags, joinFired: true }, candidates: [seen] })).toMatchObject({
      trigger: 'glance',
    });
  });

  it('scales display time with text length', () => {
    expect(bubbleDisplayMs('짧게')).toBe(6000);
    expect(bubbleDisplayMs('가'.repeat(200))).toBe(15000);
  });
});
