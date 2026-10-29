import type { Point, WalkGrid } from '@enu/map';
import { DIR_DELTA, Dir } from '@enu/protocol';

/** Grid helpers for the director's walker and the pet follower (nobody steers an avatar). */

export function stepTarget(p: Point, dir: Dir): Point {
  const d = DIR_DELTA[dir];
  return { x: p.x + d.dx, y: p.y + d.dy };
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Direction of travel from `from` to `to` (dominant axis; `fallback` when they are equal). */
export function dirBetween(from: Point, to: Point, fallback: Dir = Dir.Down): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? Dir.Right : Dir.Left;
  return dy > 0 ? Dir.Down : Dir.Up;
}

export function opposite(dir: Dir): Dir {
  switch (dir) {
    case Dir.Up:
      return Dir.Down;
    case Dir.Down:
      return Dir.Up;
    case Dir.Left:
      return Dir.Right;
    default:
      return Dir.Left;
  }
}

/** Walkable 4-neighbour of `p`, preferring the tile behind someone facing `facing`. */
export function adjacentWalkable(grid: WalkGrid, p: Point, facing: Dir): Point | null {
  const order: Dir[] = [opposite(facing), Dir.Down, Dir.Left, Dir.Right, Dir.Up];
  for (const d of order) {
    const t = stepTarget(p, d);
    if (grid.isWalkable(t.x, t.y)) return t;
  }
  return null;
}
