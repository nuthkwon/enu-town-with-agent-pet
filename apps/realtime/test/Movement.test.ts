import path from 'node:path';
import { Dir } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { loadOfficeMap } from '../src/world/loadMap';
import {
  adjacentWalkable,
  dirBetween,
  manhattan,
  opposite,
  samePoint,
  stepTarget,
} from '../src/world/Movement';

const MAPS_DIR = path.resolve(import.meta.dirname, '../../web/public/assets/maps');
const map = loadOfficeMap(MAPS_DIR);
const world = map.world;

describe('office map', () => {
  it('loads the 606 map, its hash and the director spots', () => {
    expect(map.mapId).toBe('office-606');
    expect(map.mapHash).toMatch(/^[0-9a-f]{64}$/);
    expect(world.desks).toHaveLength(14);
    expect(world.spots.meetingSeats).toHaveLength(12);
    expect(world.spots.guestSpots.length).toBeGreaterThan(0);
  });
});

describe('movement primitives', () => {
  it('stepTarget / dirBetween / opposite / manhattan / samePoint', () => {
    expect(stepTarget({ x: 3, y: 5 }, Dir.Down)).toEqual({ x: 3, y: 6 });
    expect(stepTarget({ x: 3, y: 5 }, Dir.Left)).toEqual({ x: 2, y: 5 });
    expect(dirBetween({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(Dir.Up);
    expect(dirBetween({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(Dir.Right);
    expect(dirBetween({ x: 1, y: 1 }, { x: 1, y: 1 }, Dir.Left)).toBe(Dir.Left);
    expect(opposite(Dir.Up)).toBe(Dir.Down);
    expect(opposite(Dir.Right)).toBe(Dir.Left);
    expect(manhattan({ x: 0, y: 0 }, { x: 2, y: -3 })).toBe(5);
    expect(samePoint({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
  });

  it('desk tiles block, seats and the aisle do not', () => {
    expect(world.isWalkable(3, 5)).toBe(true); // L1a seat
    expect(world.isWalkable(3, 6)).toBe(false); // L1 desk
    expect(world.isWalkable(10, 10)).toBe(true); // aisle
    expect(world.zoneAt(5, 19)?.zoneId).toBe('meeting');
  });

  it('adjacentWalkable prefers the tile behind someone', () => {
    expect(adjacentWalkable(world, { x: 3, y: 5 }, Dir.Down)).toEqual({ x: 3, y: 4 });
  });
});
