import path from 'node:path';
import type { WalkGrid } from '@enu/map';
import { Anim, Dir, OfficeState, STEP_MS } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { Director } from '../src/director/Director';
import { Walker } from '../src/director/Walker';
import { loadOfficeMap } from '../src/world/loadMap';
import { kst } from './helpers/unit';

/** 12x8 open floor with a wall column at x=6 for y<=5 (gap at y=6..7). */
const grid: WalkGrid = {
  width: 12,
  height: 8,
  isWalkable: (x, y) => x >= 0 && y >= 0 && x < 12 && y < 8 && !(x === 6 && y <= 5),
};

/** Steps the walker on a 50 ms tick until it arrives; returns the arrival times of every tile. */
function run(w: Walker, from: { x: number; y: number }, startMs: number, untilMs = 20_000) {
  const at = { ...from };
  const times: number[] = [];
  const tiles: { x: number; y: number }[] = [];
  for (let t = startMs; t <= untilMs && w.walking; t += 50) {
    const s = w.step(t, at);
    if (!s) continue;
    expect(Math.abs(s.to.x - at.x) + Math.abs(s.to.y - at.y)).toBe(1);
    at.x = s.to.x;
    at.y = s.to.y;
    times.push(t);
    tiles.push({ ...at });
  }
  return { at, times, tiles };
}

describe('Walker', () => {
  it('walks one tile per STEP_MS on average (50 ms tick) and ends on the target', () => {
    const w = new Walker(grid);
    expect(w.walkTo({ x: 0, y: 0 }, { x: 5, y: 0 }, 0)).toBe('walk');
    expect(w.target).toEqual({ x: 5, y: 0 });
    const { at, times } = run(w, { x: 0, y: 0 }, 0);
    expect(at).toEqual({ x: 5, y: 0 });
    expect(times).toHaveLength(5);
    expect(times[0]).toBe(0);
    const avg = (times.at(-1)! - times[0]!) / (times.length - 1);
    expect(avg).toBeGreaterThanOrEqual(STEP_MS - 15);
    expect(avg).toBeLessThanOrEqual(STEP_MS + 45);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(STEP_MS / 2);
    expect(w.walking).toBe(false);
    expect(w.target).toBeNull();
  });

  it('a staggered walker starts at startAtMs, not before', () => {
    const w = new Walker(grid);
    w.walkTo({ x: 0, y: 0 }, { x: 2, y: 0 }, 700);
    expect(w.step(0, { x: 0, y: 0 })).toBeNull();
    expect(w.step(650, { x: 0, y: 0 })).toBeNull();
    const first = w.step(700, { x: 0, y: 0 });
    expect(first).toEqual({ from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, arrived: false });
    expect(w.step(750, { x: 1, y: 0 })).toBeNull();
    expect(w.step(700 + STEP_MS, { x: 1, y: 0 })).toEqual({
      from: { x: 1, y: 0 },
      to: { x: 2, y: 0 },
      arrived: true,
    });
  });

  it('never bursts after a stall', () => {
    const w = new Walker(grid);
    w.walkTo({ x: 0, y: 0 }, { x: 4, y: 0 }, 0);
    w.step(0, { x: 0, y: 0 });
    expect(w.step(5000, { x: 1, y: 0 })).not.toBeNull();
    expect(w.step(5050, { x: 2, y: 0 })).toBeNull();
  });

  it('re-paths from the current tile when the target changes mid-walk (around the wall)', () => {
    const w = new Walker(grid);
    w.walkTo({ x: 0, y: 0 }, { x: 4, y: 0 }, 0);
    const at = { x: 0, y: 0 };
    for (let t = 0; t <= 400; t += 50) {
      const s = w.step(t, at);
      if (s) Object.assign(at, s.to);
    }
    expect(at.x).toBeGreaterThan(0);
    expect(at.x).toBeLessThan(4);
    expect(w.walkTo(at, { x: 8, y: 0 }, 400)).toBe('walk');
    expect(w.target).toEqual({ x: 8, y: 0 });
    const res = run(w, at, 450);
    expect(res.at).toEqual({ x: 8, y: 0 });
    expect(res.tiles.some((p) => p.y >= 6)).toBe(true); // through the gap below the wall
    expect(res.tiles.every((p) => grid.isWalkable(p.x, p.y))).toBe(true);
  });

  it('already there -> arrived; unreachable or blocked target -> teleport (the caller places directly)', () => {
    const w = new Walker(grid);
    expect(w.walkTo({ x: 3, y: 3 }, { x: 3, y: 3 }, 0)).toBe('arrived');
    expect(w.walking).toBe(false);
    expect(w.walkTo({ x: 0, y: 0 }, { x: 6, y: 2 }, 0)).toBe('teleport');
    expect(w.walking).toBe(false);
    const sealed: WalkGrid = { width: 5, height: 1, isWalkable: (x) => x !== 2 };
    expect(new Walker(sealed).walkTo({ x: 0, y: 0 }, { x: 4, y: 0 }, 0)).toBe('teleport');
  });
});

describe('Walker in the director: arrival anim and facing', () => {
  const world = loadOfficeMap(path.resolve(import.meta.dirname, '../../web/public/assets/maps')).world;

  it('walks with Anim.Walk, then sits on the seat facing the desk (or stands facing the spot)', () => {
    const state = new OfficeState();
    const d = new Director({ world, state, timeZone: 'Asia/Seoul' });
    const now = kst(2026, 10, 28, 10, 0);
    d.upsertActor({
      userId: 'u1',
      displayName: '가',
      avatarKey: 'av',
      deskId: 'L1a',
      petSpecies: 'cat',
      petName: '나비',
      linkState: 'linked',
      statusText: '',
      shareActivity: null,
      showLive: true,
      manual: { status: 'break', until: new Date(now.getTime() + 3_600_000) },
    });
    d.evaluate(now, 0, { snap: true });
    const p = state.players.get('u1')!;
    const pantry = world.spots.breakSpots[0]!;
    expect({ x: p.x, y: p.y, dir: p.dir, anim: p.anim }).toEqual({
      x: pantry.x,
      y: pantry.y,
      dir: Dir.Down,
      anim: Anim.Idle,
    });

    d.setManual('u1', { status: 'available', until: new Date(now.getTime() + 3_600_000) });
    d.evaluate(now, 1000);
    let walked = false;
    for (let t = 1000; t < 12_000; t += 50) {
      d.step(t);
      if (p.anim === Anim.Walk) walked = true;
    }
    expect(walked).toBe(true);
    expect({ x: p.x, y: p.y, dir: p.dir, anim: p.anim }).toEqual({
      x: 3,
      y: 5,
      dir: Dir.Down,
      anim: Anim.Sit,
    });
  });
});
