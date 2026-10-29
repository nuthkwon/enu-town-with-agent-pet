import { TILE_CATALOG, type TileName, type ZoneId } from '@enu/shared';
import { MAP_LAYERS, OFFICE_TILESET_NAME } from './constants';
import type { Facing } from './layouts/office-606';
import { findTileLayers, getProperty, tileGid, type TiledMap, type TiledTileset } from './tiled';
// world.ts imports this module to fill `OfficeWorld.spots`: read its values inside functions only.
import { FACING_DELTA, FACINGS, rectContains, type OfficeWorld, type OfficeWorldBase, type Point } from './world';

/**
 * Where the realtime director may place an avatar or a pet, derived from the existing tiles and zones
 * (no extra object layer, so editing the map in Tiled keeps working). Pure and spatial only: who goes
 * where is decided by the director (`allocateSpots` only resolves who gets which tile).
 */

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
   * Overflow for people without a desk: every free-standing tile (not a seat, not a chair) in BFS
   * order from the guest spots (neighbours up, right, down, left), facing up. The BFS never steps
   * onto a door (a walkable `walls` tile), so it stays inside the room and the overview.
   */
  readonly overflowTiles: readonly Spot[];
  /** Walkable W, E, N, S neighbours of the desk's seat that are not a seat or a chair, facing the seat. */
  visitorTiles(deskId: string): readonly Spot[];
  /**
   * Where the owner's pet rests while the owner is hidden: the desk-surface tile the seat faces, with
   * the seat's facing (pets fly, so the blocked tile is fine and the seat stays free). An unknown desk
   * id gets the first guest spot.
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
  /** The tile the person stands on now (null when not placed yet). */
  current: Spot | null;
}

/** `fallback` = the request could not be met (overflow): the own desk, or an overflow tile. */
export type AllocatedSpot = Spot & { fallback: boolean };

const CHAIR_TILES: ReadonlySet<string> = new Set<TileName>([
  'chair_up',
  'chair_down',
  'chair_left',
  'chair_right',
  'meeting_chair',
]);

/** `names[gid]` = the tile's `name` property, falling back to the catalog for the office tileset. */
function gidNames(tilesets: readonly TiledTileset[]): (string | undefined)[] {
  const names: (string | undefined)[] = [];
  for (const ts of tilesets) {
    const tiles = new Map((ts.tiles ?? []).map((t) => [t.id, t]));
    for (let id = 0; id < ts.tilecount; id++) {
      const name = getProperty(tiles.get(id), 'name');
      names[ts.firstgid + id] =
        typeof name === 'string' ? name : ts.name === OFFICE_TILESET_NAME ? TILE_CATALOG[id]?.name : undefined;
    }
  }
  return names;
}

/** Row-major mask of the cells holding a tile on layer `layer` whose name passes `test`. */
function tileMask(map: TiledMap, layer: string, test: (name: string | undefined) => boolean): Uint8Array {
  const names = gidNames(map.tilesets);
  const mask = new Uint8Array(map.width * map.height);
  for (const l of findTileLayers(map, layer)) {
    l.data.forEach((raw, i) => {
      const gid = tileGid(raw);
      if (gid !== 0 && test(names[gid])) mask[i] = 1;
    });
  }
  return mask;
}

function zoneTiles(world: OfficeWorldBase, zoneId: ZoneId): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (world.zones.some((z) => z.zoneId === zoneId && rectContains(z.tileRect, x, y))) out.push({ x, y });
    }
  }
  return out;
}

const facingFrom = (from: Point, to: Point): Facing =>
  FACINGS.find((f) => from.x + FACING_DELTA[f].x === to.x && from.y + FACING_DELTA[f].y === to.y) ?? 'down';

/** Derives every spot list of §2.3 from the tile layers, the zones, the desks and the spawn area. */
export function buildSpots(map: TiledMap, world: OfficeWorldBase): OfficeSpots {
  const { width, height } = world;
  const at = (mask: Uint8Array, x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  const chairs = tileMask(map, MAP_LAYERS.furniture, (n) => n !== undefined && CHAIR_TILES.has(n));
  const tables = tileMask(map, MAP_LAYERS.furniture, (n) => n === 'meeting_table');
  const walls = tileMask(map, MAP_LAYERS.walls, () => true);
  const seats = new Set(world.desks.map((d) => `${d.seatX},${d.seatY}`));
  const sitsOn = (x: number, y: number): boolean => seats.has(`${x},${y}`) || at(chairs, x, y);

  const meetingSeats: Spot[] = [];
  for (const p of zoneTiles(world, 'meeting')) {
    if (!at(chairs, p.x, p.y) || !(map.width === width && chairsAreMeeting(map, p))) continue;
    const facing = FACINGS.find((f) => at(tables, p.x + FACING_DELTA[f].x, p.y + FACING_DELTA[f].y));
    if (facing) meetingSeats.push({ ...p, facing });
  }

  const breakSpots = zoneTiles(world, 'pantry')
    .filter((p) => world.isWalkable(p.x, p.y))
    .map((p): Spot => ({ ...p, facing: 'down' }));

  const guestSpots: Spot[] = [];
  const sr = world.spawn.tileRect;
  for (let y = sr.y; y < sr.y + sr.h; y++) {
    for (let x = sr.x; x < sr.x + sr.w; x++) if (world.isWalkable(x, y)) guestSpots.push({ x, y, facing: 'up' });
  }

  // BFS from the guest spots over walkable tiles that are not doors.
  const overflowTiles: Spot[] = [];
  const seen = new Uint8Array(width * height);
  const queue: Point[] = [];
  for (const g of guestSpots) {
    seen[g.y * width + g.x] = 1;
    queue.push(g);
  }
  for (let q = 0; q < queue.length; q++) {
    const p = queue[q]!;
    if (!sitsOn(p.x, p.y)) overflowTiles.push({ x: p.x, y: p.y, facing: 'up' });
    for (const f of ['up', 'right', 'down', 'left'] as const) {
      const n = { x: p.x + FACING_DELTA[f].x, y: p.y + FACING_DELTA[f].y };
      if (!world.isWalkable(n.x, n.y) || at(walls, n.x, n.y) || seen[n.y * width + n.x]) continue;
      seen[n.y * width + n.x] = 1;
      queue.push(n);
    }
  }

  const visitors = new Map<string, readonly Spot[]>();
  const perches = new Map<string, Spot>();
  for (const d of world.desks) {
    const seat = { x: d.seatX, y: d.seatY };
    const around: Point[] = (['left', 'right', 'up', 'down'] as const).map((f) => ({
      x: seat.x + FACING_DELTA[f].x,
      y: seat.y + FACING_DELTA[f].y,
    }));
    visitors.set(
      d.deskId,
      around
        .filter((p) => world.isWalkable(p.x, p.y) && !sitsOn(p.x, p.y))
        .map((p) => ({ ...p, facing: facingFrom(p, seat) })),
    );
    perches.set(d.deskId, {
      x: seat.x + FACING_DELTA[d.facing].x,
      y: seat.y + FACING_DELTA[d.facing].y,
      facing: d.facing,
    });
  }
  const noDeskPerch: Spot = guestSpots[0] ?? { x: sr.x, y: sr.y, facing: 'up' };

  return {
    meetingSeats,
    breakSpots,
    guestSpots,
    overflowTiles,
    visitorTiles: (deskId) => visitors.get(deskId) ?? [],
    perch: (deskId) => perches.get(deskId) ?? noDeskPerch,
  };
}
