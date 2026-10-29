import path from 'node:path';
import { Encoder } from '@colyseus/schema';
import { NEUTRAL_PROJECTION } from '@enu/domain';
import {
  ActivityCode,
  Anim,
  Dir,
  Indicator,
  OfficeState,
  PlateNote,
  SourceCode,
  facingToDir,
} from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { Director, type ActorSignals, type ActorSnapshot } from '../src/director/Director';
import { loadOfficeMap } from '../src/world/loadMap';
import { MIN, kst } from './helpers/unit';

const world = loadOfficeMap(path.resolve(import.meta.dirname, '../../web/public/assets/maps')).world;
const TZ = 'Asia/Seoul';
const T0950 = kst(2026, 10, 28, 9, 50);
const T10 = kst(2026, 10, 28, 10, 0);
const T11 = kst(2026, 10, 28, 11, 0);
const T20 = kst(2026, 10, 28, 20, 0);
const H = 60 * MIN;
const hash = (c: string) => c.repeat(32).slice(0, 32);
const at = (d: Date, ms: number) => new Date(d.getTime() + ms);

function snap(userId: string, deskId: string | null, over: Partial<ActorSnapshot> = {}): ActorSnapshot {
  return {
    userId,
    displayName: userId,
    avatarKey: 'av-m-short-black-sky-warm',
    deskId,
    petSpecies: 'cat',
    petName: '펫',
    linkState: 'linked',
    statusText: '',
    shareActivity: true,
    showLive: true,
    manual: null,
    ...over,
  };
}

function make(actors: ActorSnapshot[], opts: { pulseStep?: () => number } = {}) {
  const state = new OfficeState();
  const warnings: string[] = [];
  const d = new Director({ world, state, timeZone: TZ, warn: (msg) => warnings.push(msg), ...opts });
  for (const a of actors) d.upsertActor(a);
  return {
    d,
    state,
    warnings,
    p: (id: string) => state.players.get(id)!,
    pet: (id: string) => state.pets.get(id)!,
  };
}

function steps(d: Director, fromMs: number, toMs: number): void {
  for (let t = fromMs; t <= toMs; t += 50) d.step(t);
}

const meetingSignals = (start: Date, end: Date, ref: string | null): ActorSignals => ({
  report: { now: null, schedule: [{ start, end, kind: 'meeting', refHash: ref }] },
  todayLog: null,
});
const nowSignals = (
  kind: 'work' | 'review' | 'docs' | 'collab',
  ref: string | null,
  until: Date,
): ActorSignals => ({
  report: { now: { kind, refHash: ref, until }, schedule: [] },
  todayLog: null,
});
const companyLog: ActorSignals['todayLog'] = {
  log: { ownerId: 'x', visibility: 'company', chatSummaryVisibility: 'private', deletedAt: null },
  hasWorkTask: true,
};

const seatOf = (deskId: string) => {
  const desk = world.deskById(deskId)!;
  return { x: desk.seatX, y: desk.seatY, dir: facingToDir(desk.facing) };
};
const isMeetingSeat = (x: number, y: number) => world.spots.meetingSeats.some((s) => s.x === x && s.y === y);

describe('Director placement', () => {
  it('snaps everyone at creation: shown people sit at their seats, hidden pets perch on their desks', () => {
    const t = make([snap('a', 'L1a'), snap('b', 'R1'), snap('c', 'L4b')]);
    t.d.setSession('a', 'open', T10);
    t.d.setManual('b', { status: 'focus', until: at(T10, H) });
    t.d.evaluate(T10, 0, { snap: true });
    expect(t.state.officeOpen).toBe(true);
    for (const [id, desk] of [
      ['a', 'L1a'],
      ['b', 'R1'],
    ] as const) {
      const p = t.p(id);
      expect({ x: p.x, y: p.y, dir: p.dir, anim: p.anim }).toEqual({ ...seatOf(desk), anim: Anim.Sit });
      expect(p.shown).toBe(true);
      const pet = t.pet(id);
      expect(Math.abs(pet.x - p.x) + Math.abs(pet.y - p.y)).toBe(1);
    }
    expect(t.p('a')).toMatchObject({ online: true, activity: ActivityCode.None, source: SourceCode.Town });
    expect(t.p('b')).toMatchObject({
      online: false,
      activity: ActivityCode.Focus,
      source: SourceCode.Manual,
    });
    expect(t.p('b').until).toBe(at(T10, H).getTime());
    // c: no signal -> hidden, name only; the pet rests on the desk surface the seat faces
    expect(t.p('c')).toMatchObject({
      shown: false,
      online: false,
      note: PlateNote.None,
      activity: 0,
      source: 0,
    });
    const perch = world.spots.perch('L4b');
    expect({ x: t.pet('c').x, y: t.pet('c').y, dir: t.pet('c').dir }).toEqual({
      x: perch.x,
      y: perch.y,
      dir: facingToDir(perch.facing),
    });
    expect(world.isWalkable(perch.x, perch.y)).toBe(false);
    expect(t.d.ids()).toEqual(['a', 'c', 'b']); // desk order: L1a, L4b, R1
  });

  it('hidden -> shown places the avatar directly at the spot (no walk)', () => {
    const t = make([snap('a', 'L3b')]);
    t.d.evaluate(T10, 0, { snap: true });
    expect(t.p('a').shown).toBe(false);
    t.d.setSession('a', 'open', T10);
    t.d.evaluate(T10, 1000);
    expect({ x: t.p('a').x, y: t.p('a').y, dir: t.p('a').dir, anim: t.p('a').anim }).toEqual({
      ...seatOf('L3b'),
      anim: Anim.Sit,
    });
    expect(t.p('a').shown).toBe(true);
    expect(t.d.snapshot().actors[0]?.spot).toMatchObject({ x: seatOf('L3b').x, y: seatOf('L3b').y });
  });

  it('a 10:00 meeting of 3 matching people walks them (staggered) to the chairs and 11:00 walks them back', () => {
    const t = make([snap('a', 'L1a'), snap('b', 'L2b'), snap('c', 'R2a')]);
    for (const id of ['a', 'b', 'c']) {
      t.d.setSession(id, 'open', T0950);
      t.d.setSignals(id, meetingSignals(T10, T11, hash('m')));
    }
    t.d.evaluate(T0950, 0, { snap: true });
    for (const [id, desk] of [
      ['a', 'L1a'],
      ['b', 'L2b'],
      ['c', 'R2a'],
    ] as const) {
      expect({ x: t.p(id).x, y: t.p(id).y }).toEqual({ x: seatOf(desk).x, y: seatOf(desk).y });
    }

    t.d.evaluate(T10, 1000);
    const gid = t.p('a').groupId;
    expect(gid).toMatch(/^g[0-9a-z]+$/);
    for (const id of ['a', 'b', 'c']) {
      expect(t.p(id)).toMatchObject({
        groupId: gid,
        activity: ActivityCode.Meeting,
        source: SourceCode.Calendar,
        until: T11.getTime(),
      });
    }
    // stagger: a leaves at once, b 350 ms later, c 700 ms later
    t.d.step(1000);
    expect(t.p('a').anim).toBe(Anim.Walk);
    expect({ x: t.p('b').x, y: t.p('b').y }).toEqual({ x: seatOf('L2b').x, y: seatOf('L2b').y });
    t.d.step(1350);
    expect(t.p('b').anim).toBe(Anim.Walk);
    expect({ x: t.p('c').x, y: t.p('c').y }).toEqual({ x: seatOf('R2a').x, y: seatOf('R2a').y });
    t.d.step(1700);
    expect(t.p('c').anim).toBe(Anim.Walk);
    steps(t.d, 1750, 12_000);
    const tiles = new Set<string>();
    for (const id of ['a', 'b', 'c']) {
      const p = t.p(id);
      expect(isMeetingSeat(p.x, p.y)).toBe(true);
      const seat = world.spots.meetingSeats.find((s) => s.x === p.x && s.y === p.y)!;
      expect(p.dir).toBe(facingToDir(seat.facing));
      expect(p.anim).toBe(Anim.Sit);
      tiles.add(`${p.x},${p.y}`);
    }
    expect(tiles.size).toBe(3);

    t.d.evaluate(T11, 13_000);
    for (const id of ['a', 'b', 'c'])
      expect(t.p(id)).toMatchObject({ groupId: '', activity: 0, source: SourceCode.Town });
    steps(t.d, 13_000, 26_000);
    for (const [id, desk] of [
      ['a', 'L1a'],
      ['b', 'L2b'],
      ['c', 'R2a'],
    ] as const) {
      expect({ x: t.p(id).x, y: t.p(id).y, dir: t.p(id).dir, anim: t.p(id).anim }).toEqual({
        ...seatOf(desk),
        anim: Anim.Sit,
      });
    }
    expect(t.warnings).toEqual([]);
  });

  it('2 matching people stay at their desks with a headset (no group, no pair meeting)', () => {
    const t = make([snap('a', 'L1a'), snap('b', 'L1b')]);
    for (const id of ['a', 'b']) t.d.setSignals(id, meetingSignals(T10, T11, hash('m')));
    t.d.evaluate(T10, 0, { snap: true });
    for (const [id, desk] of [
      ['a', 'L1a'],
      ['b', 'L1b'],
    ] as const) {
      expect(t.p(id)).toMatchObject({
        shown: true,
        activity: ActivityCode.Meeting,
        groupId: '',
        x: seatOf(desk).x,
        y: seatOf(desk).y,
      });
    }
  });

  it('a review/work pair on the same ref: the reviewer stands on a visitor tile of the author', () => {
    const t = make([snap('author', 'L3a'), snap('rev', 'R3b')]);
    t.d.setSession('author', 'open', T10);
    t.d.setSession('rev', 'open', T10);
    t.d.setSignals('author', nowSignals('work', hash('w'), at(T10, 90 * MIN)));
    t.d.setSignals('rev', nowSignals('review', hash('w'), at(T10, 90 * MIN)));
    t.d.evaluate(T10, 0, { snap: true });
    const visitors = world.spots.visitorTiles('L3a');
    const r = t.p('rev');
    const tile = visitors.find((v) => v.x === r.x && v.y === r.y);
    expect(tile).toBeDefined();
    expect(r.dir).toBe(facingToDir(tile!.facing));
    expect(r.anim).toBe(Anim.Idle);
    expect({ x: t.p('author').x, y: t.p('author').y }).toEqual({ x: seatOf('L3a').x, y: seatOf('L3a').y });
    expect(t.p('author').groupId).toBe(r.groupId);
    expect(r.groupId).not.toBe('');
    expect(r).toMatchObject({ activity: ActivityCode.Review, source: SourceCode.Claude });
  });

  it('a manual break goes to the pantry', () => {
    const t = make([snap('a', 'L5b')]);
    t.d.setManual('a', { status: 'break', until: at(T10, 30 * MIN) });
    t.d.evaluate(T10, 0, { snap: true });
    const p = t.p('a');
    expect(world.spots.breakSpots.some((s) => s.x === p.x && s.y === p.y)).toBe(true);
    expect(world.zoneAt(p.x, p.y)?.zoneId).toBe('pantry');
    expect(p).toMatchObject({ activity: ActivityCode.Break, source: SourceCode.Manual, dir: Dir.Down });
  });

  it('people without a desk appear on guest spots; their pets have no perch', () => {
    const t = make([snap('g', null)]);
    t.d.setSession('g', 'open', T10);
    t.d.evaluate(T10, 0, { snap: true });
    const p = t.p('g');
    expect(world.spots.guestSpots.some((s) => s.x === p.x && s.y === p.y)).toBe(true);
    expect(p.dir).toBe(Dir.Up);
  });
});

describe('Director visibility rules', () => {
  it('closed phase: NEUTRAL_PROJECTION for everyone, pets asleep on their perches, no indicator', () => {
    const t = make([snap('a', 'L1a'), snap('b', 'L2a')]);
    t.d.setSession('a', 'open', T20);
    t.d.setManual('b', { status: 'available', until: at(T20, H) });
    t.d.setSignals('b', { report: null, todayLog: companyLog });
    t.d.evaluate(T10, 0, { snap: true });
    t.pet('a').bubbleId = 'b1';
    t.pet('a').indicator = Indicator.Dots;
    t.d.evaluate(T20, 1000);
    expect(t.state.officeOpen).toBe(false);
    expect(t.d.officeOpen).toBe(false);
    for (const id of ['a', 'b']) {
      expect(t.d.projected(id)).toEqual(NEUTRAL_PROJECTION);
      expect(t.p(id)).toMatchObject({
        shown: false,
        online: false,
        activity: 0,
        source: 0,
        until: 0,
        note: 0,
        groupId: '',
        statusText: '',
      });
      expect(t.pet(id).indicator).toBe(Indicator.None);
    }
    steps(t.d, 1000, 12_000);
    for (const [id, desk] of [
      ['a', 'L1a'],
      ['b', 'L2a'],
    ] as const) {
      const perch = world.spots.perch(desk);
      expect({ x: t.pet(id).x, y: t.pet(id).y, anim: t.pet(id).anim }).toEqual({
        x: perch.x,
        y: perch.y,
        anim: Anim.Sleep,
      });
    }
    expect(t.d.noteLogWrite('b', 'claude')).toBe(false);
  });

  it('live grace: 59 s shown, 61 s hidden after the session ended; held is live but not online', () => {
    const t = make([snap('a', 'L1a')]);
    t.d.setSession('a', 'open', T10);
    t.d.evaluate(T10, 0, { snap: true });
    expect(t.p('a')).toMatchObject({ shown: true, online: true });
    t.d.setSession('a', 'held', T10);
    t.d.evaluate(at(T10, 5000), 5000);
    expect(t.p('a')).toMatchObject({ shown: true, online: false });
    t.d.setSession('a', 'ended', at(T10, 20_000));
    t.d.evaluate(at(T10, 20_000 + 59_000), 79_000);
    expect(t.p('a')).toMatchObject({ shown: true, online: false });
    t.d.evaluate(at(T10, 20_000 + 61_000), 81_000);
    expect(t.p('a')).toMatchObject({ shown: false, online: false, source: SourceCode.None });
  });

  it('show_live=false: connected with no other signal -> hidden and not online', () => {
    const t = make([snap('a', 'L1a', { showLive: false })]);
    t.d.setSession('a', 'open', T10);
    t.d.evaluate(T10, 0, { snap: true });
    expect(t.p('a')).toMatchObject({ shown: false, online: false, note: PlateNote.None, activity: 0 });
    // a status the owner sets still draws them, but never with an online dot
    t.d.setManual('a', { status: 'available', until: at(T10, H) });
    t.d.evaluate(T10, 1000);
    expect(t.p('a')).toMatchObject({ shown: true, online: false, activity: ActivityCode.Available });
  });

  it('a calendar away block hides the person as 부재: until 0, source None (beats an open town)', () => {
    const t = make([snap('a', 'L1a')]);
    t.d.setSession('a', 'open', T10);
    t.d.setSignals('a', {
      report: { now: null, schedule: [{ start: T0950, end: T11, kind: 'away', refHash: null }] },
      todayLog: null,
    });
    t.d.evaluate(T10, 0, { snap: true });
    expect(t.p('a')).toMatchObject({
      shown: false,
      online: false,
      note: PlateNote.Absent,
      source: SourceCode.None,
      until: 0,
      activity: ActivityCode.None,
    });
    expect(t.d.resolved('a')?.until?.getTime()).toBe(T11.getTime()); // owner-side truth only
  });

  it('a fresh `now` without live -> hidden with the plate label (never draws the person)', () => {
    const t = make([snap('a', 'L2b')]);
    t.d.setSignals('a', nowSignals('docs', null, at(T10, 30 * MIN)));
    t.d.evaluate(T10, 0, { snap: true });
    expect(t.p('a')).toMatchObject({
      shown: false,
      note: PlateNote.None,
      activity: ActivityCode.Docs,
      source: SourceCode.Claude,
      until: at(T10, 30 * MIN).getTime(),
    });
    // the same report with sharing off shows nothing
    t.d.upsertActor(snap('a', 'L2b', { shareActivity: false }));
    t.d.evaluate(T10, 1000);
    expect(t.p('a')).toMatchObject({ shown: false, activity: 0, source: 0, until: 0 });
  });

  it('the shared indicator is never Dots: a bubble (owner-only) changes nothing colleagues decode', () => {
    // a: shown and online; b: 접속 표시 off but drawn through a manual status (no online dot).
    const t = make([snap('a', 'L1a'), snap('b', 'L1b', { showLive: false })]);
    t.d.setSession('a', 'open', T10);
    t.d.setSession('b', 'open', T10);
    t.d.setManual('b', { status: 'available', until: at(T10, 2 * H) });
    t.d.evaluate(T10, 0, { snap: true });
    expect(t.p('a')).toMatchObject({ shown: true, online: true });
    expect(t.p('b')).toMatchObject({ shown: true, online: false });
    for (const id of ['a', 'b']) {
      const pet = t.pet(id);
      pet.bubbleId = `n-${id}`;
      pet.bubbleText = '주인만 보는 글';
      pet.indicator = Indicator.Dots; // even a stray Dots is put back
    }
    t.d.evaluate(T10, 1000);
    for (const id of ['a', 'b']) {
      expect(t.pet(id).indicator).toBe(Indicator.None);
      expect(t.pet(id).bubbleText).toBe('주인만 보는 글'); // the owner still has their bubble
    }
    t.d.setManual('a', { status: 'away', until: at(T10, H) });
    t.d.evaluate(T10, 2000);
    expect(t.pet('a').indicator).toBe(Indicator.None);
  });

  it('logPulse: only a Claude write, office open, owner shown, sharing and a colleague-visible log', () => {
    const t = make([snap('a', 'L1a'), snap('p', 'L1b'), snap('n', 'L2a', { shareActivity: false })], {
      pulseStep: () => 200,
    });
    for (const id of ['a', 'p', 'n']) t.d.setSession(id, 'open', T10);
    t.d.setSignals('a', {
      report: null,
      todayLog: { ...companyLog!, log: { ...companyLog!.log, ownerId: 'a' } },
    });
    t.d.setSignals('p', {
      report: null,
      todayLog: {
        log: { ownerId: 'p', visibility: 'private', chatSummaryVisibility: 'private', deletedAt: null },
        hasWorkTask: true,
      },
    });
    t.d.setSignals('n', {
      report: null,
      todayLog: { ...companyLog!, log: { ...companyLog!.log, ownerId: 'n' } },
    });
    t.d.evaluate(T10, 0, { snap: true });
    expect(t.p('a')).toMatchObject({ activity: ActivityCode.Today, source: SourceCode.WorkLog });
    expect(t.d.noteLogWrite('a', 'user')).toBe(false);
    expect(t.p('a').logPulse).toBe(0);
    expect(t.d.noteLogWrite('a', 'claude')).toBe(true);
    const pulsed = t.p('a').logPulse;
    expect(pulsed).not.toBe(0); // changed (that is all the client looks at) ...
    expect(pulsed).not.toBe(1); // ... and not a count of writes
    expect(t.d.noteLogWrite('p', 'claude')).toBe(false);
    expect(t.d.noteLogWrite('n', 'claude')).toBe(false);
    t.d.setSession('a', 'ended', at(T10, -120_000));
    t.d.evaluate(T10, 1000);
    expect(t.p('a').shown).toBe(false);
    expect(t.d.noteLogWrite('a', 'claude')).toBe(false);
    expect(t.p('a').logPulse).toBe(pulsed); // unchanged
    t.d.setSession('a', 'open', T20);
    t.d.evaluate(T20, 2000);
    expect(t.d.noteLogWrite('a', 'claude')).toBe(false);
    expect(t.p('a').logPulse).toBe(0); // the closed phase resets it: no value survives the night
  });

  it('logPulse never counts writes: every step moves it by 1..255 (mod 256)', () => {
    const steps = [255, 1, 128, 7];
    let i = 0;
    const t = make([snap('a', 'L1a')], { pulseStep: () => steps[i++ % steps.length]! });
    t.d.setSession('a', 'open', T10);
    t.d.setSignals('a', {
      report: null,
      todayLog: { ...companyLog!, log: { ...companyLog!.log, ownerId: 'a' } },
    });
    t.d.evaluate(T10, 0, { snap: true });
    const seen: number[] = [t.p('a').logPulse];
    for (let n = 0; n < steps.length; n++) {
      expect(t.d.noteLogWrite('a', 'claude')).toBe(true);
      seen.push(t.p('a').logPulse);
    }
    expect(seen).toEqual([0, 255, 0, 128, 135]);
    for (let n = 1; n < seen.length; n++) expect(seen[n]).not.toBe(seen[n - 1]);
  });

  it('at closing every Player is parked at its seat (or guestSpots[0]) with Idle, whatever it was doing', () => {
    const T1929 = kst(2026, 10, 28, 19, 29);
    const T1930 = kst(2026, 10, 28, 19, 30);
    const t = make([
      snap('brk', 'L5b'),
      snap('m1', 'L1a'),
      snap('m2', 'L2b'),
      snap('m3', 'R2a'),
      snap('desk', 'L3a'),
      snap('none', 'L4a'),
      snap('guest', null),
    ]);
    t.d.setManual('brk', { status: 'break', until: at(T1929, H) });
    for (const id of ['m1', 'm2', 'm3']) {
      t.d.setSession(id, 'open', T1929);
      t.d.setSignals(id, meetingSignals(at(T1929, -H), at(T1929, H), hash('m')));
    }
    t.d.setSession('desk', 'open', T1929);
    t.d.setSession('guest', 'open', T1929);
    t.d.evaluate(T1929, 0, { snap: true });
    // control: the 19:29 state tells what everyone was doing
    expect(world.zoneAt(t.p('brk').x, t.p('brk').y)?.zoneId).toBe('pantry');
    for (const id of ['m1', 'm2', 'm3']) expect(isMeetingSeat(t.p(id).x, t.p(id).y)).toBe(true);
    expect(t.p('desk').anim).toBe(Anim.Sit);

    const guest = world.spots.guestSpots[0]!;
    const parked = (id: string, deskId: string | null) =>
      deskId
        ? { ...seatOf(deskId), anim: Anim.Idle }
        : { x: guest.x, y: guest.y, dir: facingToDir(guest.facing), anim: Anim.Idle };
    const desks: [string, string | null][] = [
      ['brk', 'L5b'],
      ['m1', 'L1a'],
      ['m2', 'L2b'],
      ['m3', 'R2a'],
      ['desk', 'L3a'],
      ['none', 'L4a'],
      ['guest', null],
    ];
    for (const [when, ms] of [
      [T1930, 1000],
      [T20, 2000],
    ] as const) {
      t.d.evaluate(when, ms);
      steps(t.d, ms, ms + 3000);
      expect(t.state.officeOpen).toBe(false);
      for (const [id, deskId] of desks) {
        const p = t.p(id);
        expect({ x: p.x, y: p.y, dir: p.dir, anim: p.anim }, id).toEqual(parked(id, deskId));
      }
    }
    // A room created after hours (a fresh actor) looks exactly the same.
    const fresh = make([snap('brk', 'L5b'), snap('desk', 'L3a')]);
    fresh.d.setManual('brk', { status: 'break', until: at(T20, H) });
    fresh.d.setSession('desk', 'open', T20);
    fresh.d.evaluate(T20, 0, { snap: true });
    for (const id of ['brk', 'desk']) {
      const a = t.p(id);
      const b = fresh.p(id);
      expect({ x: b.x, y: b.y, dir: b.dir, anim: b.anim }).toEqual({
        x: a.x,
        y: a.y,
        dir: a.dir,
        anim: a.anim,
      });
    }
  });
});

describe('Director state discipline', () => {
  it('upsertActor on an existing id keeps the same Player and Pet instances', () => {
    const t = make([snap('a', 'L1a')]);
    t.d.setSession('a', 'open', T10);
    t.d.evaluate(T10, 0, { snap: true });
    const player = t.p('a');
    const pet = t.pet('a');
    const r = t.d.upsertActor(
      snap('a', 'L5a', { displayName: '새이름', petName: '모찌', linkState: 'not_linked' }),
    );
    expect(r).toEqual({ created: false, linkChanged: true });
    expect(t.state.players.get('a')).toBe(player);
    expect(t.state.pets.get('a')).toBe(pet);
    expect(t.d.pet('a')).toBe(pet);
    expect(player).toMatchObject({ name: '새이름', deskId: 'L5a' });
    expect(pet.name).toBe('모찌');
    t.d.evaluate(T10, 1000);
    steps(t.d, 1000, 8000);
    expect({ x: player.x, y: player.y }).toEqual({ x: seatOf('L5a').x, y: seatOf('L5a').y });
    expect(t.d.removeActor('a')).toBe(true);
    expect(t.state.players.has('a')).toBe(false);
    expect(t.state.pets.has('a')).toBe(false);
  });

  it('unchanged inputs produce zero schema writes', () => {
    const t = make([snap('a', 'L1a'), snap('b', 'L2b'), snap('c', 'R2a'), snap('d', 'L4a'), snap('e', null)]);
    for (const id of ['a', 'b', 'c']) {
      t.d.setSession(id, 'open', T10);
      t.d.setSignals(id, meetingSignals(T0950, T11, hash('m')));
    }
    t.d.setManual('d', { status: 'away', until: at(T10, H) });
    t.d.setStatusText('d', '외근');
    t.d.setSession('e', 'open', T10);
    const encoder = new Encoder(t.state);
    t.d.evaluate(T10, 0, { snap: true });
    steps(t.d, 0, 5000);
    t.d.evaluate(at(T10, 5000), 5000);
    steps(t.d, 5000, 8000);
    encoder.encode();
    encoder.discardChanges();
    expect(encoder.hasChanges).toBe(false);
    for (let i = 1; i <= 5; i++) {
      t.d.evaluate(at(T10, 8000 + i * 1000), 8000 + i * 1000);
      steps(t.d, 8000 + i * 1000, 8000 + i * 1000 + 950);
    }
    expect(encoder.hasChanges).toBe(false);
    expect(t.p('d')).toMatchObject({ note: PlateNote.Away, statusText: '외근', shown: false });
  });

  it('the same roster, rows and clock give the same snapshot (insertion order does not matter)', () => {
    const actors = [snap('a', 'L1a'), snap('b', 'L2b'), snap('c', 'R2a'), snap('d', null), snap('e', 'L3a')];
    const build = (list: ActorSnapshot[]) => {
      const t = make(list);
      for (const id of ['a', 'b', 'c', 'd']) t.d.setSession(id, 'open', T0950);
      for (const id of ['a', 'b', 'c']) t.d.setSignals(id, meetingSignals(T10, T11, hash('m')));
      t.d.setSignals('e', nowSignals('review', hash('x'), at(T10, H)));
      t.d.setManual('d', { status: 'break', until: at(T10, H) });
      t.d.evaluate(T0950, 0, { snap: true });
      t.d.evaluate(T10, 1000);
      steps(t.d, 1000, 4000);
      return t.d.snapshot();
    };
    const one = build(actors);
    const two = build([...actors].reverse());
    expect(two).toEqual(one);
    expect(one.actors.map((a) => a.userId)).toEqual(['a', 'b', 'e', 'c', 'd']);
  });
});
