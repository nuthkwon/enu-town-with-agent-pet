import { readFileSync } from 'node:fs';
import { TILE_INDEX, type TileName } from '@enu/shared';
import { OFFICE_606_TMJ_PATH } from '../scripts/paths';
import {
  buildWorld,
  findTileLayers,
  generateOfficeTmj,
  parseTmj,
  type Point,
  type TiledMap,
} from '../src/index';

/** The generated map shipped to the web app (`pnpm map:gen` output, possibly edited in Tiled). */
export function readShippedMapJson(): unknown {
  return JSON.parse(readFileSync(OFFICE_606_TMJ_PATH, 'utf8'));
}

export const shippedMap = parseTmj(readShippedMapJson());
export const world = buildWorld(shippedMap);

/** A fresh, mutable copy of the generator output. */
export function freshMap(): TiledMap {
  return structuredClone(generateOfficeTmj());
}

export function gidOf(name: TileName): number {
  return TILE_INDEX[name] + 1;
}

export function tileAt(map: TiledMap, layer: string, x: number, y: number): number {
  const l = findTileLayers(map, layer)[0];
  if (!l) throw new Error(`no tile layer ${layer}`);
  return l.data[y * map.width + x] ?? -1;
}

export function setTile(map: TiledMap, layer: string, x: number, y: number, name: TileName | null): void {
  const l = findTileLayers(map, layer)[0];
  if (!l) throw new Error(`no tile layer ${layer}`);
  l.data[y * map.width + x] = name ? gidOf(name) : 0;
}

export const key = (p: Point): string => `${p.x},${p.y}`;

/** Plain BFS distance (reference implementation for A* tests). */
export function bfsDistance(
  grid: { width: number; height: number; isWalkable(x: number, y: number): boolean },
  from: Point,
  to: Point,
): number | null {
  const dist = new Map<string, number>([[key(from), 0]]);
  const queue: Point[] = [from];
  for (let q = 0; q < queue.length; q++) {
    const p = queue[q]!;
    const d = dist.get(key(p))!;
    if (p.x === to.x && p.y === to.y) return d;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (n.x < 0 || n.y < 0 || n.x >= grid.width || n.y >= grid.height) continue;
      if (dist.has(key(n)) || !grid.isWalkable(n.x, n.y)) continue;
      dist.set(key(n), d + 1);
      queue.push(n);
    }
  }
  return null;
}
