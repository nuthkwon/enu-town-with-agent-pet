import { DEFAULT_TIMING, type NudgePrefs } from '@enu/domain';
import { Indicator } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { BubblePresenter, type BubblePet, type DeliveryRecord } from '../src/pet/BubblePresenter';
import { nudgeRowToCandidate, type Candidate, type OwnerSnapshot } from '../src/pet/CandidateLoader';
import { NudgeScheduler } from '../src/pet/NudgeScheduler';
import { MIN, ManualClock, kst } from './helpers/unit';

const WED_10 = kst(2026, 10, 28, 10, 0);

function prefs(over: Partial<NudgePrefs> = {}): NudgePrefs {
  return {
    nudgesEnabled: true,
    minIntervalMin: 25,
    maxPerDay: 8,
    quietStart: '19:30',
    quietEnd: '08:30',
    timeZone: 'Asia/Seoul',
    holidays: new Set(),
    ...over,
  };
}

function nudge(
  id: string,
  now: Date,
  over: Partial<Parameters<typeof nudgeRowToCandidate>[0]> = {},
): Candidate {
  return nudgeRowToCandidate({
    id,
    text: `넛지 ${id}`,
    priority: 2,
    showAfter: new Date(now.getTime() - MIN),
    snoozedUntil: null,
    expiresAt: new Date(now.getTime() + 8 * 60 * MIN),
    showCount: 0,
    maxShows: 2,
    createdAt: new Date(now.getTime() - 2 * MIN),
    dueAt: null,
    ...over,
  });
}

function setup(
  opts: {
    candidates?: (now: Date) => Candidate[];
    prefs?: Partial<NudgePrefs>;
    dnd?: boolean;
    showable?: boolean;
  } = {},
) {
  const clock = new ManualClock(WED_10.getTime());
  const pet: BubblePet = {
    bubbleId: '',
    bubbleKind: 0,
    bubbleText: '',
    bubbleDueAt: 0,
    bubbleUntil: 0,
    indicator: 0,
  };
  const records: DeliveryRecord[] = [];
  let showable = opts.showable ?? true;
  const loader = {
    load: async (): Promise<OwnerSnapshot> => ({
      candidates: (opts.candidates ?? ((n) => [nudge('n1', n)]))(clock.now()),
      history: { lastShownAt: null, shownToday: 0, dayKey: '2026-10-28', firedDueKeys: [] },
      prefs: prefs(opts.prefs),
    }),
    isStillShowable: async () => showable,
  };
  const presenter = new BubblePresenter({
    clock,
    store: {
      recordShown: async (r) => {
        records.push(r);
        return true;
      },
    },
  });
  const scheduler = new NudgeScheduler({
    loader,
    presenter,
    clock,
    timing: { ...DEFAULT_TIMING, joinDelayMs: 8000 },
    hooks: { pet: () => pet, doNotDisturb: () => opts.dnd ?? false },
  });
  return { clock, pet, records, scheduler, setShowable: (v: boolean) => (showable = v) };
}

describe('NudgeScheduler', () => {
  it('fires the join trigger after the join delay and records the delivery', async () => {
    const t = setup();
    await t.scheduler.join('u1', { linkState: 'linked' });
    await t.scheduler.tick();
    expect(t.pet.bubbleText).toBe('');
    t.clock.advance(8000);
    await t.scheduler.tick();
    expect(t.pet.bubbleText).toBe('넛지 n1');
    expect(t.pet.indicator).toBe(Indicator.Dots);
    expect(t.records).toHaveLength(1);
    expect(t.records[0]?.trigger).toBe('join');
    expect(t.scheduler.state('u1')?.flags.joinFired).toBe(true);
  });

  it('never shows anything while the pet is not linked', async () => {
    const t = setup();
    await t.scheduler.join('u1', { linkState: 'not_linked' });
    t.clock.advance(60 * MIN);
    await t.scheduler.tick();
    expect(t.pet.bubbleText).toBe('');
    expect(t.records).toHaveLength(0);
  });

  it('respects quiet hours', async () => {
    const t = setup();
    t.clock.set(kst(2026, 10, 28, 20, 0));
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(10_000);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(0);
    expect(t.scheduler.evaluate('u1')).toEqual({ show: false, reason: 'quiet' });
  });

  it('expires the bubble after its display time and waits for the interval before the next one', async () => {
    const t = setup({ candidates: (n) => [nudge('n1', n), nudge('n2', n)] });
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(8000);
    await t.scheduler.tick();
    expect(t.pet.bubbleId).toBe(t.records[0]?.candidate.refId);
    t.clock.advance(16_000);
    t.scheduler.expire();
    expect(t.pet.bubbleText).toBe('');
    expect(t.pet.indicator).toBe(Indicator.None);
    // idle trigger only after the interval (25 min)
    t.clock.advance(5 * MIN);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(1);
    t.clock.advance(21 * MIN);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(2);
    expect(t.records[1]?.trigger).toBe('idle');
  });

  it('do-not-disturb holds normal nudges back', async () => {
    const t = setup({ dnd: true });
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(9000);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(0);
  });

  it('hides the bubble when a reload says its nudge is gone, and when the link drops', async () => {
    const t = setup();
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(8000);
    await t.scheduler.tick();
    expect(t.pet.bubbleText).not.toBe('');
    t.setShowable(false);
    await t.scheduler.reload('u1');
    expect(t.pet.bubbleText).toBe('');
    expect(t.scheduler.state('u1')?.active).toBeNull();

    const u = setup();
    await u.scheduler.join('u1', { linkState: 'linked' });
    u.clock.advance(8000);
    await u.scheduler.tick();
    expect(u.pet.bubbleText).not.toBe('');
    u.scheduler.setLinkState('u1', 'not_linked');
    expect(u.pet.bubbleText).toBe('');
  });

  it('hidden tab or busy UI postpones bubbles', async () => {
    const t = setup();
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.scheduler.setPresence('u1', false, false);
    t.clock.advance(9000);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(0);
    t.scheduler.setPresence('u1', true, false);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(1);
  });
});
