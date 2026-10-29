import { DESK_IDS, TILE_CATALOG, ZONE_IDS, ZONE_LABEL_KO, type DeskId, type ZoneId } from '@enu/shared';
import { COLLISION_LAYER_NAMES, MAP_LAYERS, OFFICE_TILESET_NAME } from './constants';
import type { Facing } from './layouts/office-606';
import { buildSpots, type OfficeSpots } from './spots';
import {
  findObjectLayer,
  findTileLayers,
  getProperty,
  tileGid,
  type TiledMap,
  type TiledObject,
  type TiledTileset,
  type TiledTilesetTile,
} from './tiled';

export type DeskKind = 'desk' | 'ceo';

export interface Point {
  x: number;
  y: number;
}

/** Rectangle in tiles (x/y inclusive start, w/h size). */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectangle in pixels, exactly as stored in the Tiled object. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapArea {
  tileRect: TileRect;
  pixelRect: PixelRect;
}

export interface DeskInfo extends MapArea {
  deskId: DeskId;
  kind: DeskKind;
  /** Direction the seated owner faces (toward their own desk surface). */
  facing: Facing;
  /** Seat (chair) tile. */
  seatX: number;
  seatY: number;
}

export interface ZoneInfo extends MapArea {
  zoneId: ZoneId;
  label: string;
  walkable: boolean;
}

export interface OfficeWorld {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /** Row-major (`y * width + x`): 1 = blocked, 0 = walkable. */
  readonly collision: Uint8Array;
  readonly desks: readonly DeskInfo[];
  readonly zones: readonly ZoneInfo[];
  readonly spawn: MapArea;
  /** Where the director places avatars and pets (meeting seats, break / guest spots, visitor tiles, perches). */
  readonly spots: OfficeSpots;
  /** Tile coordinates; fractional values are floored (also for the lookups below). */
  inBounds(x: number, y: number): boolean;
  isWalkable(x: number, y: number): boolean;
  zoneAt(x: number, y: number): ZoneInfo | null;
  /** Desk whose surface or seat covers the tile. */
  deskAtTile(x: number, y: number): DeskInfo | null;
  deskById(deskId: string): DeskInfo | null;
  seatOf(deskId: string): Point | null;
}

/** `OfficeWorld` before its spots are derived (what `buildSpots` reads). */
export type OfficeWorldBase = Omit<OfficeWorld, 'spots'>;

export const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

/** Unit step for each facing (y grows downward). */
export const FACING_DELTA: Readonly<Record<Facing, Readonly<Point>>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function isDeskId(v: unknown): v is DeskId {
  return typeof v === 'string' && (DESK_IDS as readonly string[]).includes(v);
}

export function isZoneId(v: unknown): v is ZoneId {
  return typeof v === 'string' && (ZONE_IDS as readonly string[]).includes(v);
}

export function isFacing(v: unknown): v is Facing {
  return typeof v === 'string' && (FACINGS as readonly string[]).includes(v);
}

/** Thrown by `buildWorld` when object layers carry invalid or inconsistent data. */
export class WorldError extends Error {
  constructor(message: string) {
    super(`buildWorld: ${message}`);
    this.name = 'WorldError';
  }
}

const EPS = 1e-6;

/** Pixel rectangle -> covering tile rectangle (at least 1x1, so point objects work too). */
export function pixelRectToTiles(r: PixelRect, tileSize: number): TileRect {
  const x0 = Math.floor(r.x / tileSize + EPS);
  const y0 = Math.floor(r.y / tileSize + EPS);
  const x1 = Math.max(x0 + 1, Math.ceil((r.x + r.width) / tileSize - EPS));
  const y1 = Math.max(y0 + 1, Math.ceil((r.y + r.height) / tileSize - EPS));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectContains(r: TileRect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

// ---------------------------------------------------------------------------------------------
// collision

const CATALOG_COLLIDES = new Map<string, boolean>(TILE_CATALOG.map((t) => [t.name, t.collides]));

function tileCollides(ts: TiledTileset, id: number, tile: TiledTilesetTile | undefined): boolean {
  const collides = getProperty(tile, 'collides');
  if (typeof collides === 'boolean') return collides; // the tileset is the source of truth
  const name = getProperty(tile, 'name');
  if (typeof name === 'string') {
    const fromCatalog = CATALOG_COLLIDES.get(name);
    if (fromCatalog !== undefined) return fromCatalog;
  }
  if (ts.name === OFFICE_TILESET_NAME) return TILE_CATALOG[id]?.collides ?? false;
  return false;
}

/** `table[gid] === 1` when that (masked) gid blocks movement. */
export function buildGidCollisionTable(tilesets: readonly TiledTileset[]): Uint8Array {
  let maxGid = 0;
  for (const ts of tilesets) maxGid = Math.max(maxGid, ts.firstgid + ts.tilecount - 1);
  const table = new Uint8Array(maxGid + 1);
  for (const ts of tilesets) {
    const tiles = new Map<number, TiledTilesetTile>((ts.tiles ?? []).map((t) => [t.id, t]));
    for (let id = 0; id < ts.tilecount; id++) {
      table[ts.firstgid + id] = tileCollides(ts, id, tiles.get(id)) ? 1 : 0;
    }
  }
  return table;
}

// ---------------------------------------------------------------------------------------------
// object layers

function describeObject(layer: string, o: TiledObject): string {
  return `'${layer}' object #${o.id}${o.name ? ` ('${o.name}')` : ''}`;
}

function objectPixelRect(layer: string, o: TiledObject): PixelRect {
  if (o.rotation !== 0)
    throw new WorldError(`${describeObject(layer, o)} is rotated; rotation is not supported`);
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

function checkInBounds(layer: string, o: TiledObject, r: TileRect, width: number, height: number): void {
  if (r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) {
    throw new WorldError(
      `${describeObject(layer, o)} covers tiles x=${r.x}..${r.x + r.w - 1}, y=${r.y}..${r.y + r.h - 1} outside the ${width}x${height} map`,
    );
  }
}

function intProp(layer: string, o: TiledObject, name: string): number {
  const v = getProperty(o, name);
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new WorldError(
      `${describeObject(layer, o)} needs an integer property '${name}', got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

function readDesks(map: TiledMap, tileSize: number): DeskInfo[] {
  const layerName = MAP_LAYERS.desks;
  const layer = findObjectLayer(map, layerName);
  if (!layer) return [];
  const seen = new Set<string>();
  return layer.objects.map((o) => {
    const rawId = getProperty(o, 'deskId') ?? o.name;
    if (!isDeskId(rawId)) {
      throw new WorldError(`${describeObject(layerName, o)} has unknown deskId ${JSON.stringify(rawId)}`);
    }
    if (seen.has(rawId)) throw new WorldError(`${describeObject(layerName, o)} duplicates deskId '${rawId}'`);
    seen.add(rawId);
    const kind = getProperty(o, 'kind') ?? 'desk';
    if (kind !== 'desk' && kind !== 'ceo') {
      throw new WorldError(
        `${describeObject(layerName, o)} has invalid kind ${JSON.stringify(kind)} (desk | ceo)`,
      );
    }
    const facing = getProperty(o, 'facing');
    if (!isFacing(facing)) {
      throw new WorldError(`${describeObject(layerName, o)} has invalid facing ${JSON.stringify(facing)}`);
    }
    const seatX = intProp(layerName, o, 'seatX');
    const seatY = intProp(layerName, o, 'seatY');
    if (seatX < 0 || seatY < 0 || seatX >= map.width || seatY >= map.height) {
      throw new WorldError(`${describeObject(layerName, o)} seat (${seatX},${seatY}) is outside the map`);
    }
    const pixelRect = objectPixelRect(layerName, o);
    const tileRect = pixelRectToTiles(pixelRect, tileSize);
    checkInBounds(layerName, o, tileRect, map.width, map.height);
    return { deskId: rawId, kind, facing, seatX, seatY, tileRect, pixelRect };
  });
}

function readZones(map: TiledMap, tileSize: number): ZoneInfo[] {
  const layerName = MAP_LAYERS.zones;
  const layer = findObjectLayer(map, layerName);
  if (!layer) return [];
  return layer.objects.map((o) => {
    const rawId = getProperty(o, 'zoneId') ?? o.name;
    if (!isZoneId(rawId)) {
      throw new WorldError(`${describeObject(layerName, o)} has unknown zoneId ${JSON.stringify(rawId)}`);
    }
    const label = getProperty(o, 'label');
    const walkable = getProperty(o, 'walkable');
    if (walkable !== undefined && typeof walkable !== 'boolean') {
      throw new WorldError(`${describeObject(layerName, o)} property 'walkable' must be a bool`);
    }
    const pixelRect = objectPixelRect(layerName, o);
    const tileRect = pixelRectToTiles(pixelRect, tileSize);
    checkInBounds(layerName, o, tileRect, map.width, map.height);
    return {
      zoneId: rawId,
      label: typeof label === 'string' && label !== '' ? label : ZONE_LABEL_KO[rawId],
      walkable: walkable ?? true,
      tileRect,
      pixelRect,
    };
  });
}

function readSpawn(map: TiledMap, tileSize: number): MapArea {
  const layerName = MAP_LAYERS.spawn;
  const layer = findObjectLayer(map, layerName);
  const o = layer?.objects[0];
  if (!o) throw new WorldError(`object layer '${layerName}' with at least one object is required`);
  const pixelRect = objectPixelRect(layerName, o);
  const tileRect = pixelRectToTiles(pixelRect, tileSize);
  checkInBounds(layerName, o, tileRect, map.width, map.height);
  return { tileRect, pixelRect };
}

// ---------------------------------------------------------------------------------------------
// world

/**
 * Builds the walkability grid, the desk / zone / spawn indexes and the director spots (`buildSpots`)
 * from a parsed map. A tile is blocked when any `floor`, `walls` or `furniture` tile on it collides
 * (tileset property `collides`, falling back to `TILE_CATALOG`), or when it lies in a zone with
 * `walkable=false`.
 */
export function buildWorld(map: TiledMap): OfficeWorld {
  const { width, height } = map;
  if (map.tilewidth !== map.tileheight) {
    throw new WorldError(`non-square tiles (${map.tilewidth}x${map.tileheight}) are not supported`);
  }
  const tileSize = map.tilewidth;
  const size = width * height;

  const gidCollides = buildGidCollisionTable(map.tilesets);
  const collision = new Uint8Array(size);
  for (const layer of findTileLayers(map)) {
    if (!COLLISION_LAYER_NAMES.includes(layer.name)) continue;
    for (let i = 0; i < size; i++) {
      const gid = tileGid(layer.data[i] ?? 0);
      if (gid !== 0 && gidCollides[gid] === 1) collision[i] = 1;
    }
  }

  const zones = readZones(map, tileSize);
  const zoneIndex = new Int16Array(size).fill(-1);
  zones.forEach((z, zi) => {
    const r = z.tileRect;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * width + x;
        if (zoneIndex[i] === -1) zoneIndex[i] = zi; // first zone wins on overlap
        if (!z.walkable) collision[i] = 1;
      }
    }
  });

  const desks = readDesks(map, tileSize);
  const deskIndex = new Int16Array(size).fill(-1);
  const byId = new Map<string, DeskInfo>();
  desks.forEach((d, di) => {
    byId.set(d.deskId, d);
    const r = d.tileRect;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) deskIndex[y * width + x] = di;
  });
  desks.forEach((d, di) => {
    deskIndex[d.seatY * width + d.seatX] = di;
  });

  const spawn = readSpawn(map, tileSize);

  const cell = (x: number, y: number): number => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return tx >= 0 && ty >= 0 && tx < width && ty < height ? ty * width + tx : -1;
  };

  const base: OfficeWorldBase = {
    width,
    height,
    tileSize,
    collision,
    desks,
    zones,
    spawn,
    inBounds: (x, y) => cell(x, y) !== -1,
    isWalkable(x, y) {
      const i = cell(x, y);
      return i !== -1 && collision[i] === 0;
    },
    zoneAt(x, y) {
      const i = cell(x, y);
      return i === -1 ? null : (zones[zoneIndex[i] ?? -1] ?? null);
    },
    deskAtTile(x, y) {
      const i = cell(x, y);
      return i === -1 ? null : (desks[deskIndex[i] ?? -1] ?? null);
    },
    deskById: (deskId) => byId.get(deskId) ?? null,
    seatOf(deskId) {
      const d = byId.get(deskId);
      return d ? { x: d.seatX, y: d.seatY } : null;
    },
  };
  return { ...base, spots: buildSpots(map, base) };
}
