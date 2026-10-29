import { nearestWalkable, type OfficeWorld, type Point, type WalkGrid } from '@enu/map';
import { DIR_DELTA, Dir, STEP_MS, facingToDir } from '@enu/protocol';
import { TokenBucket } from '../infra/RateLimiter';

/** Minimum average spacing between accepted steps (clients step every STEP_MS). */
export const STEP_MIN_INTERVAL_MS = Math.round(STEP_MS * 0.75);
/** How many early steps (network jitter) are tolerated back to back. */
export const STEP_BURST = 3;

/** Cadence gate for `step`: sustained <= 1 step / 0.75*STEP_MS (~8/s), bursts of STEP_BURST. */
export function createStepGate(): TokenBucket {
  return new TokenBucket(STEP_BURST, STEP_MIN_INTERVAL_MS);
}

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

export interface SpawnPoint extends Point {
  dir: Dir;
  source: 'desk' | 'presence' | 'spawn';
}

export interface SpawnInput {
  deskId: string | null;
  lastPresence: { x: number; y: number; dir: number } | null;
  /** Tiles currently taken by other people (only used to spread out entrance spawns). */
  occupied?: readonly Point[];
}

function isDir(n: number): n is Dir {
  return n === Dir.Down || n === Dir.Left || n === Dir.Right || n === Dir.Up;
}

/**
 * Spawn rule: own desk seat (facing the desk) > last position within 24h (if still walkable) >
 * a free walkable tile of the entrance spawn area (nearest walkable as a last resort).
 */
export function chooseSpawn(world: OfficeWorld, input: SpawnInput): SpawnPoint {
  if (input.deskId) {
    const desk = world.deskById(input.deskId);
    if (desk && world.isWalkable(desk.seatX, desk.seatY)) {
      return { x: desk.seatX, y: desk.seatY, dir: facingToDir(desk.facing), source: 'desk' };
    }
  }
  const last = input.lastPresence;
  if (last && world.isWalkable(last.x, last.y)) {
    return { x: last.x, y: last.y, dir: isDir(last.dir) ? last.dir : Dir.Down, source: 'presence' };
  }
  const r = world.spawn.tileRect;
  const occupied = input.occupied ?? [];
  const free: Point[] = [];
  const any: Point[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!world.isWalkable(x, y)) continue;
      any.push({ x, y });
      if (!occupied.some((o) => o.x === x && o.y === y)) free.push({ x, y });
    }
  }
  const pick = free[0] ?? any[0] ?? nearestWalkable(world, r.x, r.y) ?? { x: r.x, y: r.y };
  return { x: pick.x, y: pick.y, dir: Dir.Up, source: 'spawn' };
}
