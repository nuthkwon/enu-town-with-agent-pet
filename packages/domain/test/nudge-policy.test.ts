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
  joinedAt: new Date(now.getTime() - 60_000),
  lastActivityAt: now,
  hasActiveBubble: false,
};
const history = { lastShownAt: null, shownToday: 0 };
const flags = { joinFired: false, idleArmed: true, firedDueKeys: new Set<string>() };
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

  it('enforces the interval but lets urgent items through after 10 minutes', () => {
    const recent = { lastShownAt: new Date(now.getTime() - 12 * 60_000), shownToday: 1 };
    expect(run({ history: recent })).toMatchObject({ show: false, reason: 'interval' });
    expect(run({ history: recent, candidates: [nudge({ priority: 1 })] })).toMatchObject({ show: true, trigger: 'urgent' });
  });

  it('fires the due window once per to-do and window', () => {
    const todo = nudge({ kind: 'todo_due', refId: 't1', text: '견적서 회신', dueAt: new Date(now.getTime() + 4 * 60_000) });
    const first = run({ candidates: [todo], flags: { ...flags, joinFired: true } });
    expect(first).toMatchObject({ show: true, trigger: 'due', dueKey: 't1:5' });
    const again = run({ candidates: [todo], flags: { ...flags, joinFired: true, idleArmed: false, firedDueKeys: new Set(['t1:5']) } });
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

  it('uses idle when join already fired', () => {
    const idle = { ...presence, lastActivityAt: new Date(now.getTime() - 200_000) };
    expect(run({ presence: idle, flags: { ...flags, joinFired: true } })).toMatchObject({ show: true, trigger: 'idle' });
  });

  it('scales display time with text length', () => {
    expect(bubbleDisplayMs('짧게')).toBe(6000);
    expect(bubbleDisplayMs('가'.repeat(200))).toBe(15000);
  });
});
