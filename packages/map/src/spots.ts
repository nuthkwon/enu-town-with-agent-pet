/**
 * Places the realtime director may send an avatar or a pet, derived from the existing tiles, zones,
 * desks and spawn area (no extra object layer, so the map stays editable in Tiled). Spatial only:
 * the director decides who wants to go where; `allocateSpots` only resolves who gets which tile.
 */
import { TILE_CATALOG, type TileName, type ZoneId } from '@enu/shared';
import { MAP_LAYERS, OFFICE_TILESET_NAME } from './constants';
import type { Facing } from './layouts/office-606';
import { findTileLayers, getProperty, tileGid, type TiledMap, type TiledTileset } from './tiled';
// world.ts imports this module to fill `OfficeWorld.spots`: use these values inside functions only.
import {
  FACING_DELTA,
  FACINGS,
  rectContains,
  type OfficeWorld,
  type OfficeWorldBase,
  type Point,
} from './world';

/** A tile plus the direction whoever stands on it looks. */
export interface Spot {
  x: number;
  y: number;
  facing: Facing;
}

export interface OfficeSpots {
  /** `meeting_chair` tiles inside the `meeting` zone, each facing its 4-adjacent `meeting_table`; (y, x) order. */
  readonly meetingSeats: readonly Spot[];
  /** Walkable `pantry` tiles, (y, x) order, facing down. */
  readonly breakSpots: readonly Spot[];
  /** Walkable tiles of `world.spawn` (just inside the entrance), (y, x) order, facing up. */
  readonly guestSpots: readonly Spot[];
  /**
   * Overflow for people without a desk: every tile that is not a seat or a chair, in BFS order from the
   * guest spots (neighbours up, right, down, left), facing up. The BFS never steps onto a door (a
   * walkable `walls` tile), so overflow stays inside the room.
   */
  readonly overflowTiles: readonly Spot[];
  /** Walkable W, E, N, S neighbours of the desk's seat that are not a seat or a chair, facing the seat. */
  visitorTiles(deskId: string): readonly Spot[];
  /**
   * Where the owner's pet rests while the owner is hidden: the desk-surface tile the seat faces, with the
   * seat's facing (pets fly, so a blocked tile is fine and the seat stays free). Unknown desk ids get the
   * first guest spot.
   */
  perch(deskId: string): Spot;
}

export type SpotIntent =
  | { kind: 'desk' }
  | { kind: 'meeting' }
  | { kind: 'visit'; hostDeskId: string }
  | { kind: 'break' }
  | { kind: 'guest' };

export interface SpotRequest {
  userId: string;
  deskId: string | null;
  intent: SpotIntent;
  /** The tile the person was given last time (null when not placed yet). */
  current: Spot | null;
}

/** `fallback`: the intent could not be met, so this is the person's own seat or an overflow tile. */
export type AllocatedSpot = Spot & { fallback: boolean };

const CHAIR_TILES: ReadonlySet<string> = new Set<TileName>([
  'chair_up',
  'chair_down',
  'chair_left',
  'chair_right',
  'meeting_chair',
]);

/** Visitor tiles are listed W, E, N, S. */
const AROUND: readonly Facing[] = ['left', 'right', 'up', 'down'];
/** BFS neighbour order (same as the path helpers). */
const BFS_ORDER: readonly Facing[] = ['up', 'right', 'down', 'left'];

/** `names[gid]` = the tile's `name` property; the office tileset falls back to TILE_CATALOG. */
function gidNames(tilesets: readonly TiledTileset[]): (string | undefined)[] {
  const names: (string | undefined)[] = [];
  for (const ts of tilesets) {
    const tiles = new Map((ts.tiles ?? []).map((t) => [t.id, t]));
    for (let id = 0; id < ts.tilecount; id++) {
      const name = getProperty(tiles.get(id), 'name');
      if (typeof name === 'string') names[ts.firstgid + id] = name;
      else if (ts.name === OFFICE_TILESET_NAME) names[ts.firstgid + id] = TILE_CATALOG[id]?.name;
    }
  }
  return names;
}

/** Row-major mask: 1 where a tile on any layer called `layer` passes `test`. */
function tileMask(
  map: TiledMap,
  names: readonly (string | undefined)[],
  layer: string,
  test: (name: string | undefined) => boolean,
): Uint8Array {
  const mask = new Uint8Array(map.width * map.height);
  for (const l of findTileLayers(map, layer)) {
    l.data.forEach((raw, i) => {
      const gid = tileGid(raw);
      if (gid !== 0 && test(names[gid])) mask[i] = 1;
    });
  }
  return mask;
}

/** Tiles covered by any zone `zoneId`, in (y, x) order. */
function zoneTiles(world: OfficeWorldBase, zoneId: ZoneId): Point[] {
  const rects = world.zones.filter((z) => z.zoneId === zoneId).map((z) => z.tileRect);
  const out: Point[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) if (rects.some((r) => rectContains(r, x, y))) out.push({ x, y });
  }
  return out;
}

const step = (p: Point, f: Facing): Point => ({ x: p.x + FACING_DELTA[f].x, y: p.y + FACING_DELTA[f].y });

const opposite = (f: Facing): Facing =>
  f === 'up' ? 'down' : f === 'down' ? 'up' : f === 'left' ? 'right' : 'left';

/**
 * Derives the director's spots from the map. Never throws: a map without a meeting table, pantry or
 * visitor tile simply yields empty lists, which `validateOfficeMap` reports.
 */
export function buildSpots(map: TiledMap, world: OfficeWorldBase): OfficeSpots {
  const { width, height } = world;
  const has = (mask: Uint8Array, p: Point): boolean =>
    p.x >= 0 && p.y >= 0 && p.x < width && p.y < height && mask[p.y * width + p.x] === 1;
  const names = gidNames(map.tilesets);
  const meetingChairs = tileMask(map, names, MAP_LAYERS.furniture, (n) => n === 'meeting_chair');
  const meetingTables = tileMask(map, names, MAP_LAYERS.furniture, (n) => n === 'meeting_table');
  const chairs = tileMask(map, names, MAP_LAYERS.furniture, (n) => n !== undefined && CHAIR_TILES.has(n));
  const doors = tileMask(map, names, MAP_LAYERS.walls, () => true);
  const seats = new Set(world.desks.map((d) => `${d.seatX},${d.seatY}`));
  const sitting = (p: Point): boolean => seats.has(`${p.x},${p.y}`) || has(chairs, p);

  const meetingSeats: Spot[] = [];
  for (const p of zoneTiles(world, 'meeting')) {
    if (!has(meetingChairs, p)) continue;
    const facing = FACINGS.find((f) => has(meetingTables, step(p, f)));
    if (facing) meetingSeats.push({ ...p, facing });
  }

  const breakSpots = zoneTiles(world, 'pantry')
    .filter((p) => world.isWalkable(p.x, p.y))
    .map((p): Spot => ({ ...p, facing: 'down' }));

  const guestSpots: Spot[] = [];
  const sr = world.spawn.tileRect;
  for (let y = sr.y; y < sr.y + sr.h; y++) {
    for (let x = sr.x; x < sr.x + sr.w; x++)
      if (world.isWalkable(x, y)) guestSpots.push({ x, y, facing: 'up' });
  }

  const overflowTiles: Spot[] = [];
  const seen = new Uint8Array(width * height);
  const queue: Point[] = [];
  for (const g of guestSpots) {
    seen[g.y * width + g.x] = 1;
    queue.push(g);
  }
  for (let q = 0; q < queue.length; q++) {
    const p = queue[q]!;
    if (!sitting(p)) overflowTiles.push({ x: p.x, y: p.y, facing: 'up' });
    for (const f of BFS_ORDER) {
      const n = step(p, f);
      if (!world.isWalkable(n.x, n.y) || has(doors, n) || seen[n.y * width + n.x]) continue;
      seen[n.y * width + n.x] = 1;
      queue.push(n);
    }
  }

  const visitors = new Map<string, readonly Spot[]>();
  const perches = new Map<string, Spot>();
  for (const d of world.desks) {
    const seat = { x: d.seatX, y: d.seatY };
    const tiles: Spot[] = [];
    for (const f of AROUND) {
      const p = step(seat, f);
      if (world.isWalkable(p.x, p.y) && !sitting(p)) tiles.push({ ...p, facing: opposite(f) });
    }
    visitors.set(d.deskId, tiles);
    perches.set(d.deskId, { ...step(seat, d.facing), facing: d.facing });
  }
  const unknownPerch: Spot = guestSpots[0] ?? { x: sr.x, y: sr.y, facing: 'up' };

  return {
    meetingSeats,
    breakSpots,
    guestSpots,
    overflowTiles,
    visitorTiles: (deskId) => visitors.get(deskId) ?? [],
    perch: (deskId) => perches.get(deskId) ?? unknownPerch,
  };
}

const INTENT_ORDER: Readonly<Record<SpotIntent['kind'], number>> = {
  desk: 0,
  meeting: 1,
  visit: 2,
  break: 3,
  guest: 4,
};

const byUserId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const tileKey = (p: Point): string => `${p.x},${p.y}`;

/**
 * Gives every request one tile, deterministically (processed by intent: desk, meeting, visit, break,
 * guest, then by userId; duplicate userIds after the first are ignored):
 * 1. current holders keep their spot when it is still one their intent asks for;
 * 2. the others take the first free spot of their intent (desk = own seat, meeting = meeting seats,
 *    visit = the host's visitor tiles, break = break spots, guest = guest spots);
 * 3. overflow (`fallback: true`) goes to the person's own seat, otherwise to the first free overflow tile
 *    (keeping their current overflow tile when it is still free).
 * No two people get the same tile. Allocation is total: should the room ever run out of free tiles, the
 * rest share the first guest spot.
 */
export function allocateSpots(
  world: OfficeWorld,
  spots: OfficeSpots,
  req: readonly SpotRequest[],
): Map<string, AllocatedSpot> {
  const seen = new Set<string>();
  const order = [...req]
    .sort((a, b) => INTENT_ORDER[a.intent.kind] - INTENT_ORDER[b.intent.kind] || byUserId(a.userId, b.userId))
    .filter((r) => !seen.has(r.userId) && seen.add(r.userId));

  const seatOf = (r: SpotRequest): Spot | null => {
    const d = r.deskId === null ? null : world.deskById(r.deskId);
    return d ? { x: d.seatX, y: d.seatY, facing: d.facing } : null;
  };
  const wanted = (r: SpotRequest): readonly Spot[] => {
    switch (r.intent.kind) {
      case 'desk': {
        const seat = seatOf(r);
        return seat ? [seat] : [];
      }
      case 'meeting':
        return spots.meetingSeats;
      case 'visit':
        return spots.visitorTiles(r.intent.hostDeskId);
      case 'break':
        return spots.breakSpots;
      case 'guest':
        return spots.guestSpots;
    }
  };

  const taken = new Set<string>();
  const out = new Map<string, AllocatedSpot>();
  const isFree = (p: Point): boolean => !taken.has(tileKey(p));
  const give = (r: SpotRequest, s: Spot, fallback: boolean): void => {
    taken.add(tileKey(s));
    out.set(r.userId, { x: s.x, y: s.y, facing: s.facing, fallback });
  };
  const current = (r: SpotRequest, list: readonly Spot[]): Spot | undefined => {
    const c = r.current;
    return c ? list.find((s) => s.x === c.x && s.y === c.y && isFree(s)) : undefined;
  };
  const open = (): SpotRequest[] => order.filter((r) => !out.has(r.userId));

  for (const r of order) {
    const keep = current(r, wanted(r));
    if (keep) give(r, keep, false);
  }
  for (const r of open()) {
    const first = wanted(r).find(isFree);
    if (first) give(r, first, false);
  }
  for (const r of open()) {
    const seat = seatOf(r);
    if (seat && isFree(seat)) give(r, seat, true);
  }
  for (const r of open()) {
    const keep = current(r, spots.overflowTiles);
    if (keep) give(r, keep, true);
  }
  const lastResort: Spot = spots.guestSpots[0] ?? {
    x: world.spawn.tileRect.x,
    y: world.spawn.tileRect.y,
    facing: 'up',
  };
  for (const r of open()) give(r, spots.overflowTiles.find(isFree) ?? lastResort, true);
  return out;
}
