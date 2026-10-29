import path from 'node:path';
import { Dir, STEP_MS } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { loadOfficeMap } from '../src/world/loadMap';
import {
  STEP_BURST,
  STEP_MIN_INTERVAL_MS,
  chooseSpawn,
  createStepGate,
  dirBetween,
  stepTarget,
} from '../src/world/Movement';

const MAPS_DIR = path.resolve(import.meta.dirname, '../../web/public/assets/maps');
const map = loadOfficeMap(MAPS_DIR);
const world = map.world;

describe('office map', () => {
  it('loads the 606 map and its hash', () => {
    expect(map.mapId).toBe('office-606');
    expect(map.mapHash).toMatch(/^[0-9a-f]{64}$/);
    expect(world.desks).toHaveLength(14);
  });
});

describe('spawn', () => {
  it('own desk seat, facing the desk', () => {
    expect(chooseSpawn(world, { deskId: 'L2a', lastPresence: null })).toEqual({
      x: 3,
      y: 8,
      dir: Dir.Up,
      source: 'desk',
    });
    expect(chooseSpawn(world, { deskId: 'L1b', lastPresence: null })).toEqual({
      x: 6,
      y: 5,
      dir: Dir.Down,
      source: 'desk',
    });
    expect(chooseSpawn(world, { deskId: 'R1', lastPresence: null })).toEqual({
      x: 17,
      y: 6,
      dir: Dir.Left,
      source: 'desk',
    });
  });

  it('last presence when walkable, otherwise the entrance spawn area', () => {
    expect(chooseSpawn(world, { deskId: null, lastPresence: { x: 9, y: 10, dir: Dir.Left } })).toEqual({
      x: 9,
      y: 10,
      dir: Dir.Left,
      source: 'presence',
    });
    const wall = chooseSpawn(world, { deskId: null, lastPresence: { x: 0, y: 0, dir: 0 } });
    expect(wall.source).toBe('spawn');
    expect(world.isWalkable(wall.x, wall.y)).toBe(true);
    const r = world.spawn.tileRect;
    expect(wall.x).toBeGreaterThanOrEqual(r.x);
    expect(wall.x).toBeLessThan(r.x + r.w);
    const second = chooseSpawn(world, { deskId: null, lastPresence: null, occupied: [wall] });
    expect(second).not.toEqual(wall);
  });
});

describe('movement primitives', () => {
  it('stepTarget / dirBetween', () => {
    expect(stepTarget({ x: 3, y: 5 }, Dir.Down)).toEqual({ x: 3, y: 6 });
    expect(stepTarget({ x: 3, y: 5 }, Dir.Left)).toEqual({ x: 2, y: 5 });
    expect(dirBetween({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(Dir.Up);
    expect(dirBetween({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(Dir.Right);
  });

  it('desk tiles block, seats and the aisle do not', () => {
    expect(world.isWalkable(3, 5)).toBe(true); // L1a seat
    expect(world.isWalkable(3, 6)).toBe(false); // L1 desk
    expect(world.isWalkable(10, 10)).toBe(true); // aisle
    expect(world.zoneAt(5, 19)?.zoneId).toBe('meeting');
  });

  it('step gate: burst of STEP_BURST, then >= 0.75*STEP_MS spacing', () => {
    expect(STEP_MIN_INTERVAL_MS).toBe(Math.round(STEP_MS * 0.75));
    const g = createStepGate();
    let ok = 0;
    for (let i = 0; i < 10; i++) if (g.take(0)) ok++;
    expect(ok).toBe(STEP_BURST);
    expect(g.take(STEP_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(g.take(STEP_MIN_INTERVAL_MS * 2)).toBe(true);
    // steady walking at STEP_MS is always accepted
    const steady = createStepGate();
    for (let i = 0; i < 50; i++) expect(steady.take(1000 + i * STEP_MS)).toBe(true);
  });
});
