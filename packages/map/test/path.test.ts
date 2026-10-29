import { DESK_IDS } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  findPath,
  isReachable,
  nearestWalkable,
  reachableMask,
  type Point,
  type WalkGrid,
} from '../src/index';
import { bfsDistance, key, world } from './fixtures';

const SPAWN: Point = { x: 10, y: 21 };

function gridFromAscii(rows: readonly string[]): WalkGrid {
  return {
    width: rows[0]!.length,
    height: rows.length,
    isWalkable: (x, y) => rows[Math.floor(y)]?.[Math.floor(x)] === '.',
  };
}

function expectValidPath(grid: WalkGrid, from: Point, to: Point, path: Point[]): void {
  let prev = from;
  for (const step of path) {
    expect(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y), `${key(prev)} -> ${key(step)}`).toBe(1);
    expect(grid.isWalkable(step.x, step.y), key(step)).toBe(true);
    prev = step;
  }
  expect(prev).toEqual(to);
}

describe('findPath (A*)', () => {
  it('reaches all 14 seats from the spawn with shortest valid paths', () => {
    for (const id of DESK_IDS) {
      const seat = world.seatOf(id)!;
      expect(isReachable(world, SPAWN, seat), id).toBe(true);
      const path = findPath(world, SPAWN, seat);
      expect(path, id).not.toBeNull();
      expectValidPath(world, SPAWN, seat, path!);
      expect(path!.length, id).toBe(bfsDistance(world, SPAWN, seat));
    }
  });

  it('routes to the CEO seat (R1) via the y4 walkway, never through the partition', () => {
    const seat = world.seatOf('R1')!;
    const path = findPath(world, SPAWN, seat)!;
    expectValidPath(world, SPAWN, seat, path);
    const firstInside = path.find((p) => p.x >= 14);
    expect(firstInside).toEqual({ x: 14, y: 4 });
    for (const p of path) {
      if (p.x === 14) expect(p.y).toBe(4);
      expect(p.y === 7 && p.x >= 14).toBe(false);
    }
    // right next to the partition, but the only way in is around it (and around the desk return)
    const around = findPath(world, { x: 13, y: 6 }, seat)!;
    expect(around).toHaveLength(10);
    expect(around.map(key)).toContain('14,4');
  });

  it('cannot enter the server room', () => {
    expect(findPath(world, SPAWN, { x: 16, y: 19 })).toBeNull();
    expect(isReachable(world, SPAWN, { x: 14, y: 21 })).toBe(false);
    expect(findPath(world, { x: 12, y: 19 }, { x: 13, y: 19 })).toBeNull(); // closed door
  });

  it('handles trivial and invalid requests', () => {
    expect(findPath(world, SPAWN, SPAWN)).toEqual([]);
    expect(findPath(world, SPAWN, { x: 11, y: 21 })).toEqual([{ x: 11, y: 21 }]);
    expect(findPath(world, SPAWN, { x: -1, y: 0 })).toBeNull();
    expect(findPath(world, { x: 99, y: 0 }, SPAWN)).toBeNull();
    expect(findPath(world, SPAWN, { x: 3, y: 6 })).toBeNull(); // desk surface
    expect(findPath(world, { x: 3, y: 6 }, { x: 3, y: 5 })).toEqual([{ x: 3, y: 5 }]); // walk off a blocked tile
    expect(isReachable(world, SPAWN, SPAWN)).toBe(true);
    expect(isReachable(world, SPAWN, { x: 3, y: 6 })).toBe(false);
  });

  it('gives up after maxNodes expansions', () => {
    const seat = world.seatOf('R1')!;
    expect(findPath(world, SPAWN, seat, { maxNodes: 5 })).toBeNull();
    expect(findPath(world, SPAWN, seat, { maxNodes: 4000 })).not.toBeNull();
  });

  it('matches BFS distances on a maze for every pair of cells', () => {
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const rows = Array.from({ length: 10 }, () =>
      Array.from({ length: 12 }, () => (rand() < 0.3 ? '#' : '.')).join(''),
    );
    const grid = gridFromAscii(rows);
    const cells: Point[] = [];
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) if (grid.isWalkable(x, y)) cells.push({ x, y });
    for (const a of cells) {
      for (const b of cells) {
        const expected = bfsDistance(grid, a, b);
        const path = findPath(grid, a, b);
        if (expected === null) {
          expect(path).toBeNull();
          expect(isReachable(grid, a, b)).toBe(false);
        } else {
          expect(path?.length, `${key(a)} -> ${key(b)}`).toBe(expected);
          expectValidPath(grid, a, b, path!);
        }
      }
    }
    expect(cells.length).toBeGreaterThan(50);
  });
});

describe('reachableMask / nearestWalkable', () => {
  it('floods walkable tiles from the spawn', () => {
    const mask = reachableMask(world, [SPAWN, { x: 11, y: 21 }]);
    expect(mask[4 * 22 + 17]).toBe(1); // CEO area via walkway
    expect(mask[1 * 22 + 5]).toBe(1); // balcony via glass door
    expect(mask[19 * 22 + 16]).toBe(0); // server room
    expect(mask[6 * 22 + 3]).toBe(0); // desk
  });

  it('returns the tile itself when walkable', () => {
    expect(nearestWalkable(world, 10, 10)).toEqual({ x: 10, y: 10 });
    expect(nearestWalkable(world, 10.6, 10.2)).toEqual({ x: 10, y: 10 });
  });

  it('finds the closest walkable tile from blocked or out-of-bounds positions', () => {
    const fromDesk = nearestWalkable(world, 3, 6)!;
    expect(world.isWalkable(fromDesk.x, fromDesk.y)).toBe(true);
    expect(Math.abs(fromDesk.x - 3) + Math.abs(fromDesk.y - 6)).toBe(1);
    expect(nearestWalkable(world, 17, 19)).toEqual({ x: 17, y: 16 }); // server room -> pantry above
    expect(nearestWalkable(world, 0, 10)).toEqual({ x: 1, y: 10 }); // wall
    const outside = nearestWalkable(world, -5, 100)!;
    expect(world.isWalkable(outside.x, outside.y)).toBe(true);
    expect(nearestWalkable(gridFromAscii(['###', '###']), 1, 1)).toBeNull();
  });
});
