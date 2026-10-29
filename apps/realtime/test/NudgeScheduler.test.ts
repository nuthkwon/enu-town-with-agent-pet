import path from 'node:path';
import { DEFAULT_TIMING, type NudgePrefs } from '@enu/domain';
import { Indicator, OfficeState } from '@enu/protocol';
import { NUDGE_POLICY } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { Director, bubbleHooks, type ActorSnapshot } from '../src/director/Director';
import { BubblePresenter, type BubblePet, type DeliveryRecord } from '../src/pet/BubblePresenter';
import { nudgeRowToCandidate, type Candidate, type OwnerSnapshot } from '../src/pet/CandidateLoader';
import { NudgeScheduler, type SchedulerHooks } from '../src/pet/NudgeScheduler';
import { loadOfficeMap } from '../src/world/loadMap';
import { MIN, ManualClock, kst } from './helpers/unit';

const WED_10 = kst(2026, 10, 28, 10, 0);
const GLANCE = NUDGE_POLICY.glanceHiddenMs;

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

function emptyPet(): BubblePet {
  return { bubbleId: '', bubbleKind: 0, bubbleText: '', bubbleDueAt: 0, bubbleUntil: 0, indicator: 0 };
}

function setup(
  opts: {
    candidates?: (now: Date) => Candidate[];
    prefs?: Partial<NudgePrefs>;
    dnd?: boolean;
    showable?: boolean;
    hooks?: (pet: BubblePet) => Partial<SchedulerHooks>;
    clock?: ManualClock;
  } = {},
) {
  const clock = opts.clock ?? new ManualClock(WED_10.getTime());
  const pet = emptyPet();
  const records: DeliveryRecord[] = [];
  let showable = opts.showable ?? true;
  const flags = { officeOpen: true, dnd: opts.dnd ?? false };
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
    hooks: {
      pet: () => pet,
      pets: () => [pet],
      doNotDisturb: () => flags.dnd,
      officeOpen: () => flags.officeOpen,
      ...opts.hooks?.(pet),
    },
  });
  return { clock, pet, records, scheduler, flags, setShowable: (v: boolean) => (showable = v) };
}

/** Joins, lets the join trigger fire and the bubble expire. */
async function afterJoinBubble(t: ReturnType<typeof setup>): Promise<void> {
  await t.scheduler.join('u1', { linkState: 'linked' });
  t.clock.advance(8000);
  await t.scheduler.tick();
  expect(t.records.at(-1)?.trigger).toBe('join');
  t.clock.advance(16_000);
  t.scheduler.expire();
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
    expect(t.pet.indicator).toBe(Indicator.None); // shared: never `…`
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

  it('expires the bubble after its display time; a fresh nudge waits for the interval (eligible)', async () => {
    const t = setup({ candidates: (n) => [nudge('n1', n), nudge('n2', n)] });
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(8000);
    await t.scheduler.tick();
    expect(t.pet.bubbleId).toBe(t.records[0]?.candidate.refId);
    t.clock.advance(16_000);
    t.scheduler.expire();
    expect(t.pet.bubbleText).toBe('');
    expect(t.pet.indicator).toBe(Indicator.None);
    t.clock.advance(5 * MIN);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(1);
    t.clock.advance(21 * MIN);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(2);
    expect(t.records[1]?.trigger).toBe('eligible');
    expect(t.records[1]?.candidate.refId).not.toBe(t.records[0]?.candidate.refId);
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

  it('glance: a return after >= glanceHiddenMs hidden shows the best live nudge again, once per return', async () => {
    const t = setup();
    await afterJoinBubble(t);
    t.clock.advance(30 * MIN);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(1); // already shown once, no fresh nudge: nothing without a glance

    // a short absence does not count
    t.scheduler.setPresence('u1', false, false);
    t.clock.advance(GLANCE - 1000);
    t.scheduler.setPresence('u1', true, false);
    expect(t.scheduler.state('u1')?.flags.glanceArmed).toBe(false);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(1);

    // a long one arms exactly one glance
    t.scheduler.setPresence('u1', false, false);
    t.clock.advance(GLANCE);
    t.scheduler.setPresence('u1', true, false);
    expect(t.scheduler.state('u1')?.lastHiddenMs).toBe(GLANCE);
    expect(t.scheduler.state('u1')?.flags.glanceArmed).toBe(true);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(2);
    expect(t.records[1]).toMatchObject({ trigger: 'glance', candidate: { refId: 'n1' } });
    expect(t.scheduler.state('u1')?.flags.glanceArmed).toBe(false);
    t.clock.advance(16_000);
    t.scheduler.expire();
    t.clock.advance(60 * MIN);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(2);
  });

  it('officeOpen=false forces quiet and takes down a bubble left from before closing', async () => {
    const t = setup();
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(8000);
    await t.scheduler.tick();
    expect(t.pet.bubbleText).not.toBe('');
    t.flags.officeOpen = false;
    await t.scheduler.tick();
    expect(t.pet.bubbleText).toBe('');
    expect(t.pet.indicator).toBe(Indicator.None);

    const u = setup();
    u.flags.officeOpen = false;
    await u.scheduler.join('u1', { linkState: 'linked' });
    u.clock.advance(60 * MIN);
    await u.scheduler.tick();
    expect(u.records).toHaveLength(0);
    expect(u.scheduler.evaluate('u1')).toEqual({ show: false, reason: 'quiet' });
  });

  it('leave takes the bubble down on the long-lived pet (nothing would expire it later)', async () => {
    const t = setup();
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(8000);
    await t.scheduler.tick();
    expect(t.pet.bubbleText).toBe('넛지 n1');
    t.scheduler.leave('u1');
    expect(t.pet).toMatchObject({ bubbleId: '', bubbleText: '', bubbleUntil: 0, indicator: Indicator.None });
    expect(t.scheduler.state('u1')).toBeUndefined();
  });

  it('join clears a bubble a replaced session left on the pet', async () => {
    const t = setup();
    Object.assign(t.pet, {
      bubbleId: 'old',
      bubbleKind: 1,
      bubbleText: '지난 세션의 말풍선',
      bubbleDueAt: 123,
      bubbleUntil: t.clock.now().getTime() - 1000,
      indicator: Indicator.Dots,
    });
    await t.scheduler.join('u1', { linkState: 'linked' });
    expect(t.pet).toMatchObject({
      bubbleId: '',
      bubbleKind: 0,
      bubbleText: '',
      bubbleDueAt: 0,
      bubbleUntil: 0,
      indicator: Indicator.None,
    });
    expect(t.scheduler.state('u1')?.active).toBeNull();
  });
});

describe('NudgeScheduler hooks from the director', () => {
  const world = loadOfficeMap(path.resolve(import.meta.dirname, '../../web/public/assets/maps')).world;

  function withDirector(manual: ActorSnapshot['manual'], at: Date) {
    const clock = new ManualClock(at.getTime());
    const state = new OfficeState();
    const director = new Director({ world, state, timeZone: 'Asia/Seoul' });
    director.upsertActor({
      userId: 'u1',
      displayName: '가',
      avatarKey: 'av',
      deskId: 'L1a',
      pets: [{ petId: 'pet-u1', species: 'cat', name: '나비', tint: 'base' }],
      linkState: 'linked',
      statusText: '',
      shareActivity: true,
      showLive: true,
      manual,
    });
    director.setSession('u1', 'open', at);
    director.evaluate(at, 0, { snap: true });
    const t = setup({ clock, prefs: { ignoreQuietHours: true }, hooks: () => bubbleHooks(director) });
    return { t, director, state };
  }

  it('a shown owner: the bubble goes on the director-owned Pet, and the shared indicator stays None', async () => {
    const { t, director } = withDirector(null, WED_10);
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(8000);
    await t.scheduler.tick();
    const pet = director.pet('u1')!;
    expect(pet.bubbleText).toBe('넛지 n1');
    expect(pet.indicator).toBe(Indicator.None);
    director.evaluate(t.clock.now(), 9000);
    expect(pet.indicator).toBe(Indicator.None);
    expect(t.pet.bubbleText).toBe('');
  });

  it('a glance (tab visible again after >= glanceHiddenMs) changes no field a colleague decodes', async () => {
    const { t, director, state } = withDirector(null, WED_10);
    /** Every synced field except the owner-only `.view()` bubble fields. */
    const shared = () => {
      const p = state.players.get('u1')!;
      const pet = state.pets.get('pet-u1')!;
      return {
        player: {
          x: p.x,
          y: p.y,
          dir: p.dir,
          anim: p.anim,
          shown: p.shown,
          online: p.online,
          activity: p.activity,
          source: p.source,
          until: p.until,
          note: p.note,
          groupId: p.groupId,
          statusText: p.statusText,
          logPulse: p.logPulse,
        },
        pet: {
          x: pet.x,
          y: pet.y,
          dir: pet.dir,
          anim: pet.anim,
          indicator: pet.indicator,
          linkState: pet.linkState,
        },
      };
    };
    let ms = 0;
    const step = (dt: number) => {
      t.clock.advance(dt);
      ms += dt;
      director.evaluate(t.clock.now(), ms);
      director.step(ms);
    };
    await afterJoinBubble(t);
    step(30 * MIN);
    t.scheduler.setPresence('u1', false, false);
    step(GLANCE);
    const before = shared();
    t.scheduler.setPresence('u1', true, false);
    await t.scheduler.tick();
    expect(t.records.at(-1)?.trigger).toBe('glance');
    expect(director.pet('u1')!.bubbleText).toBe('넛지 n1'); // the owner does get the bubble
    step(1000);
    expect(shared()).toEqual(before);
  });

  it('a manual focus status is do-not-disturb; a manual away owner still gets the text', async () => {
    const focus = withDirector({ status: 'focus', until: new Date(WED_10.getTime() + 60 * MIN) }, WED_10);
    await focus.t.scheduler.join('u1', { linkState: 'linked' });
    focus.t.clock.advance(9000);
    await focus.t.scheduler.tick();
    expect(focus.t.records).toHaveLength(0);
    expect(focus.t.scheduler.evaluate('u1')).toEqual({ show: false, reason: 'do_not_disturb' });

    const away = withDirector({ status: 'away', until: new Date(WED_10.getTime() + 60 * MIN) }, WED_10);
    await away.t.scheduler.join('u1', { linkState: 'linked' });
    away.t.clock.advance(9000);
    await away.t.scheduler.tick();
    const pet = away.director.pet('u1')!;
    expect(pet.bubbleText).toBe('넛지 n1');
    expect(pet.indicator).toBe(Indicator.None);
  });

  it('after office hours the director closes the office and the scheduler stays quiet', async () => {
    const { t, state } = withDirector(null, kst(2026, 10, 28, 20, 0));
    expect(state.officeOpen).toBe(false);
    await t.scheduler.join('u1', { linkState: 'linked' });
    t.clock.advance(60 * MIN);
    await t.scheduler.tick();
    expect(t.records).toHaveLength(0);
    expect(t.scheduler.evaluate('u1')).toEqual({ show: false, reason: 'quiet' });
  });
});
