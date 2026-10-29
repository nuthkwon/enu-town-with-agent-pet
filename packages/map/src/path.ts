import type { OfficeWorld, Point } from './world';

/** The part of `OfficeWorld` the path helpers need (handy for tiny test grids). */
export type WalkGrid = Pick<OfficeWorld, 'width' | 'height' | 'isWalkable'>;

export interface PathOptions {
  /** Give up (return null) after expanding this many nodes. */
  maxNodes?: number;
}

/** 4-neighbourhood in a fixed order (up, right, down, left) so results are deterministic. */
const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

interface HeapEntry {
  idx: number;
  f: number;
  h: number;
  seq: number;
}

function before(a: HeapEntry, b: HeapEntry): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.seq < b.seq;
}

class MinHeap {
  private readonly items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(e: HeapEntry): void {
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const parent = a[p];
      if (!parent || !before(e, parent)) break;
      a[i] = parent;
      i = p;
    }
    a[i] = e;
  }

  pop(): HeapEntry | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length === 0 || !last) return top;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= a.length) break;
      const left = a[l];
      const right = a[l + 1];
      let c = l;
      let child = left;
      if (right && left && before(right, left)) {
        c = l + 1;
        child = right;
      }
      if (!child || !before(child, last)) break;
      a[i] = child;
      i = c;
    }
    a[i] = last;
    return top;
  }
}

function toCell(grid: WalkGrid, p: Point): Point | null {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? { x, y } : null;
}

/**
 * 4-directional A* (Manhattan heuristic, unit costs). Returns the tile steps from `from` to `to`
 * excluding the start (empty when already there), or null when `to` is blocked, out of bounds,
 * unreachable, or more than `maxNodes` nodes had to be expanded. The start tile itself may be blocked
 * (e.g. someone standing on a desk after a map edit) so they can still walk out.
 */
export function findPath(grid: WalkGrid, from: Point, to: Point, options: PathOptions = {}): Point[] | null {
  const maxNodes = options.maxNodes ?? 4000;
  const s = toCell(grid, from);
  const t = toCell(grid, to);
  if (!s || !t) return null;
  if (s.x === t.x && s.y === t.y) return [];
  if (!grid.isWalkable(t.x, t.y)) return null;

  const w = grid.width;
  const n = w * grid.height;
  const start = s.y * w + s.x;
  const target = t.y * w + t.x;
  const g = new Int32Array(n).fill(0x7fffffff);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const h = (x: number, y: number): number => Math.abs(x - t.x) + Math.abs(y - t.y);

  let seq = 0;
  g[start] = 0;
  heap.push({ idx: start, f: h(s.x, s.y), h: h(s.x, s.y), seq: seq++ });
  let expanded = 0;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (!cur || closed[cur.idx]) continue;
    if (cur.idx === target) {
      const path: Point[] = [];
      for (let i = target; i !== start; i = parent[i] ?? start) path.push({ x: i % w, y: Math.floor(i / w) });
      return path.reverse();
    }
    if (expanded >= maxNodes) return null;
    expanded++;
    closed[cur.idx] = 1;
    const cx = cur.idx % w;
    const cy = Math.floor(cur.idx / w);
    const ng = (g[cur.idx] ?? 0) + 1;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= grid.height) continue;
      const ni = ny * w + nx;
      if (closed[ni] || !grid.isWalkable(nx, ny)) continue;
      if (ng < (g[ni] ?? 0)) {
        g[ni] = ng;
        parent[ni] = cur.idx;
        const hn = h(nx, ny);
        heap.push({ idx: ni, f: ng + hn, h: hn, seq: seq++ });
      }
    }
  }
  return null;
}

/**
 * Flood fill over walkable tiles from one or more start tiles (starts are included even when blocked).
 * Returns a row-major mask: 1 = reachable.
 */
export function reachableMask(grid: WalkGrid, starts: Point | readonly Point[]): Uint8Array {
  const w = grid.width;
  const mask = new Uint8Array(w * grid.height);
  const queue: number[] = [];
  for (const p of Array.isArray(starts) ? (starts as readonly Point[]) : [starts as Point]) {
    const c = toCell(grid, p);
    if (!c) continue;
    const i = c.y * w + c.x;
    if (!mask[i]) {
      mask[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] ?? 0;
    const cx = i % w;
    const cy = Math.floor(i / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= grid.height) continue;
      const ni = ny * w + nx;
      if (mask[ni] || !grid.isWalkable(nx, ny)) continue;
      mask[ni] = 1;
      queue.push(ni);
    }
  }
  return mask;
}

/** True when `to` is walkable and connected to `from` (no node limit). */
export function isReachable(grid: WalkGrid, from: Point, to: Point): boolean {
  const s = toCell(grid, from);
  const t = toCell(grid, to);
  if (!s || !t) return false;
  if (s.x === t.x && s.y === t.y) return true;
  if (!grid.isWalkable(t.x, t.y)) return false;
  return reachableMask(grid, s)[t.y * grid.width + t.x] === 1;
}

/**
 * Closest walkable tile to (x, y) by BFS over the whole grid (Manhattan distance, ties broken
 * up/right/down/left). Out-of-bounds input is clamped into the map first. Null if nothing is walkable.
 */
export function nearestWalkable(grid: WalkGrid, x: number, y: number): Point | null {
  const w = grid.width;
  const hgt = grid.height;
  if (w <= 0 || hgt <= 0) return null;
  const sx = Math.min(w - 1, Math.max(0, Math.floor(Number.isFinite(x) ? x : 0)));
  const sy = Math.min(hgt - 1, Math.max(0, Math.floor(Number.isFinite(y) ? y : 0)));
  const seen = new Uint8Array(w * hgt);
  const queue: number[] = [sy * w + sx];
  seen[sy * w + sx] = 1;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] ?? 0;
    const cx = i % w;
    const cy = Math.floor(i / w);
    if (grid.isWalkable(cx, cy)) return { x: cx, y: cy };
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= hgt) continue;
      const ni = ny * w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return null;
}
