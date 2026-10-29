import {
  TILE_CATALOG,
  TILE_INDEX,
  TILE_SIZE,
  TILESET_COLUMNS,
  ZONE_LABEL_KO,
  type TileName,
  type ZoneId,
} from '@enu/shared';
import {
  MAP_LAYERS,
  OFFICE_TILESET_IMAGE,
  OFFICE_TILESET_NAME,
  TILED_EDITOR_VERSION,
  TILED_FORMAT_VERSION,
} from './constants';
import {
  OFFICE_606_ASCII,
  OFFICE_606_DESKS,
  OFFICE_606_HEIGHT,
  OFFICE_606_SPAWN,
  OFFICE_606_WIDTH,
  OFFICE_606_ZONES,
  type DeskSpec,
  type Facing,
  type ZoneSpec,
} from './layouts/office-606';
import type { TiledMap, TiledObject, TiledObjectLayer, TiledTileLayer, TiledTileset } from './tiled';
import { FACING_DELTA } from './world';

/** Everything the generator needs to turn an ASCII floor plan into a Tiled map. */
export interface OfficeLayout {
  ascii: readonly string[];
  width: number;
  height: number;
  desks: readonly DeskSpec[];
  zones: readonly ZoneSpec[];
  spawn: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export const OFFICE_606_LAYOUT: OfficeLayout = {
  ascii: OFFICE_606_ASCII,
  width: OFFICE_606_WIDTH,
  height: OFFICE_606_HEIGHT,
  desks: OFFICE_606_DESKS,
  zones: OFFICE_606_ZONES,
  spawn: OFFICE_606_SPAWN,
};

/**
 * Monitor sprite per seat facing, from the camera's point of view (top-down, looking north):
 * a person facing up sits south of the desk, so the screen faces them *and* the camera.
 */
export const MONITOR_TILE_BY_FACING: Readonly<Record<Facing, TileName>> = {
  up: 'monitor_front',
  down: 'monitor_back',
  left: 'monitor_side',
  right: 'monitor_side',
};

const CHAIR_CHAR: Readonly<Record<Facing, string>> = { up: '^', down: 'v', left: '<', right: '>' };
const CHAIR_TILE: Readonly<Record<Facing, TileName>> = {
  up: 'chair_up',
  down: 'chair_down',
  left: 'chair_left',
  right: 'chair_right',
};
const CHAIR_CHARS = new Set(Object.values(CHAIR_CHAR));

const WALL_TILE: Readonly<Record<string, TileName>> = {
  '#': 'wall',
  W: 'window',
  D: 'door_glass',
  E: 'door_entrance',
  R: 'railing',
  x: 'server_door',
};

/** Furniture that maps 1:1 from a character (desks, chairs and partitions need context). */
const FURNITURE_TILE: Readonly<Record<string, TileName>> = {
  T: 'meeting_table',
  h: 'meeting_chair',
  F: 'fridge',
  M: 'microwave',
  K: 'counter',
  S: 'server_rack',
  C: 'cabinet',
  L: 'plant',
  B: 'whiteboard',
};

const FLOOR_BY_CHAR: Readonly<Record<string, TileName>> = {
  R: 'floor_wood',
  ',': 'floor_wood',
  ':': 'floor_runner',
  E: 'floor_runner',
  '.': 'floor_carpet',
  m: 'floor_meeting',
  T: 'floor_meeting',
  h: 'floor_meeting',
  p: 'floor_tile',
  F: 'floor_tile',
  M: 'floor_tile',
  K: 'floor_tile',
  s: 'floor_server',
  S: 'floor_server',
  x: 'floor_server',
};

/** Floor under context-dependent characters (walls, plants, cabinets, ...) inside a zone. */
const FLOOR_BY_ZONE: Readonly<Partial<Record<ZoneId, TileName>>> = {
  balcony: 'floor_wood',
  pantry: 'floor_tile',
  meeting: 'floor_meeting',
  server: 'floor_server',
};

const LEGEND = new Set([
  ...Object.keys(WALL_TILE),
  ...Object.keys(FURNITURE_TILE),
  ...Object.keys(FLOOR_BY_CHAR),
  ...CHAIR_CHARS,
  'd',
  'P',
]);

const gidOf = (name: TileName): number => TILE_INDEX[name] + 1;

function charAt(layout: OfficeLayout, x: number, y: number): string {
  return layout.ascii[y]?.[x] ?? '';
}

function zoneAt(layout: OfficeLayout, x: number, y: number): ZoneSpec | undefined {
  return layout.zones.find((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
}

function inBounds(layout: OfficeLayout, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < layout.width && y < layout.height;
}

/**
 * Consistency problems between the ASCII plan and the desk / zone / spawn specs (empty = OK):
 * desk rectangles must be exactly the `d` cells, every chair belongs to a seat that faces its own desk.
 */
export function checkLayout(layout: OfficeLayout): string[] {
  const errors: string[] = [];
  if (layout.ascii.length !== layout.height) {
    errors.push(`ascii has ${layout.ascii.length} rows, expected ${layout.height}`);
  }
  layout.ascii.forEach((row, y) => {
    if (row.length !== layout.width)
      errors.push(`ascii row ${y} has ${row.length} columns, expected ${layout.width}`);
    [...row].forEach((ch, x) => {
      if (!LEGEND.has(ch)) errors.push(`unknown character '${ch}' at (${x},${y})`);
    });
  });

  const deskOwner = new Map<string, string>();
  const seats = new Map<string, string>();
  for (const d of layout.desks) {
    if (d.deskW < 1 || d.deskH < 1) errors.push(`${d.deskId}: empty desk rectangle`);
    for (let y = d.deskY; y < d.deskY + d.deskH; y++) {
      for (let x = d.deskX; x < d.deskX + d.deskW; x++) {
        const key = `${x},${y}`;
        if (charAt(layout, x, y) !== 'd')
          errors.push(`${d.deskId}: desk tile (${key}) is '${charAt(layout, x, y)}', not 'd'`);
        const owner = deskOwner.get(key);
        if (owner) errors.push(`${d.deskId}: desk tile (${key}) already belongs to ${owner}`);
        deskOwner.set(key, d.deskId);
      }
    }
    const seatChar = charAt(layout, d.seatX, d.seatY);
    if (seatChar !== CHAIR_CHAR[d.facing]) {
      errors.push(
        `${d.deskId}: seat (${d.seatX},${d.seatY}) is '${seatChar}', expected '${CHAIR_CHAR[d.facing]}' for facing ${d.facing}`,
      );
    }
    const seatKey = `${d.seatX},${d.seatY}`;
    const seatOwner = seats.get(seatKey);
    if (seatOwner) errors.push(`${d.deskId}: seat (${seatKey}) already belongs to ${seatOwner}`);
    seats.set(seatKey, d.deskId);
    const tx = d.seatX + FACING_DELTA[d.facing].x;
    const ty = d.seatY + FACING_DELTA[d.facing].y;
    if (!(tx >= d.deskX && tx < d.deskX + d.deskW && ty >= d.deskY && ty < d.deskY + d.deskH)) {
      errors.push(`${d.deskId}: seat (${seatKey}) facing ${d.facing} does not point at its own desk`);
    }
  }
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      const ch = charAt(layout, x, y);
      if (ch === 'd' && !deskOwner.has(`${x},${y}`))
        errors.push(`desk tile (${x},${y}) belongs to no desk spec`);
      if (CHAIR_CHARS.has(ch) && !seats.has(`${x},${y}`))
        errors.push(`chair (${x},${y}) belongs to no desk spec`);
    }
  }

  for (const z of layout.zones) {
    if (
      z.w < 1 ||
      z.h < 1 ||
      !inBounds(layout, z.x, z.y) ||
      !inBounds(layout, z.x + z.w - 1, z.y + z.h - 1)
    ) {
      errors.push(`zone ${z.zoneId} (${z.x},${z.y} ${z.w}x${z.h}) is empty or out of bounds`);
    }
  }
  const s = layout.spawn;
  if (s.w < 1 || s.h < 1 || !inBounds(layout, s.x, s.y) || !inBounds(layout, s.x + s.w - 1, s.y + s.h - 1)) {
    errors.push(`spawn (${s.x},${s.y} ${s.w}x${s.h}) is empty or out of bounds`);
  }
  return errors;
}

function floorTile(layout: OfficeLayout, ch: string, x: number, y: number): TileName {
  const byChar = FLOOR_BY_CHAR[ch];
  if (byChar) return byChar;
  const zone = zoneAt(layout, x, y);
  return (zone && FLOOR_BY_ZONE[zone.zoneId]) ?? 'floor_carpet';
}

function partitionTile(layout: OfficeLayout, x: number, y: number): TileName {
  const isP = (px: number, py: number): boolean => charAt(layout, px, py) === 'P';
  const vertical = isP(x, y - 1) || isP(x, y + 1);
  const horizontal = isP(x - 1, y) || isP(x + 1, y);
  if (vertical && horizontal) return 'partition_corner';
  return horizontal ? 'partition_h' : 'partition_v';
}

function deskTile(d: DeskSpec, dx: number): TileName {
  if (d.kind === 'ceo' || d.deskH !== 1 || d.deskW < 2) return 'desk_block';
  if (dx === 0) return 'desk_left';
  return dx === d.deskW - 1 ? 'desk_right' : 'desk_mid';
}

function tileLayer(id: number, name: string, layout: OfficeLayout, data: number[]): TiledTileLayer {
  return {
    data,
    height: layout.height,
    id,
    name,
    opacity: 1,
    type: 'tilelayer',
    visible: true,
    width: layout.width,
    x: 0,
    y: 0,
  };
}

function objectLayer(id: number, name: string, objects: TiledObject[]): TiledObjectLayer {
  return {
    draworder: 'topdown',
    id,
    name,
    objects,
    opacity: 1,
    type: 'objectgroup',
    visible: true,
    x: 0,
    y: 0,
  };
}

/** The embedded `office-tiles` tileset (gid = catalog index + 1) with `collides` / `name` per tile. */
export function buildOfficeTileset(tileSize: number = TILE_SIZE): TiledTileset {
  const rows = Math.ceil(TILE_CATALOG.length / TILESET_COLUMNS);
  return {
    columns: TILESET_COLUMNS,
    firstgid: 1,
    image: OFFICE_TILESET_IMAGE,
    imageheight: rows * tileSize,
    imagewidth: TILESET_COLUMNS * tileSize,
    margin: 0,
    name: OFFICE_TILESET_NAME,
    spacing: 0,
    tilecount: TILE_CATALOG.length,
    tileheight: tileSize,
    tiles: TILE_CATALOG.map((t, id) => ({
      id,
      properties: [
        { name: 'collides', type: 'bool', value: t.collides },
        { name: 'name', type: 'string', value: t.name },
      ],
    })),
    tilewidth: tileSize,
  };
}

/**
 * Converts an ASCII office layout into a Tiled 1.10 map: tile layers `floor`, `walls`, `furniture`,
 * `furniture-top` and object layers `desks`, `zones`, `spawn` (pixel coordinates). Deterministic.
 * Throws when `checkLayout` finds inconsistencies.
 */
export function generateOfficeTmj(
  layout: OfficeLayout = OFFICE_606_LAYOUT,
  tileSize: number = TILE_SIZE,
): TiledMap {
  const problems = checkLayout(layout);
  if (problems.length > 0) throw new Error(`office layout is inconsistent:\n  - ${problems.join('\n  - ')}`);

  const { width, height } = layout;
  const size = width * height;
  const floor = new Array<number>(size).fill(0);
  const walls = new Array<number>(size).fill(0);
  const furniture = new Array<number>(size).fill(0);
  const top = new Array<number>(size).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const ch = charAt(layout, x, y);
      floor[i] = gidOf(floorTile(layout, ch, x, y));
      const wall = WALL_TILE[ch];
      if (wall) walls[i] = gidOf(wall);
      const item = FURNITURE_TILE[ch];
      if (item) furniture[i] = gidOf(item);
      if (ch === 'P') furniture[i] = gidOf(partitionTile(layout, x, y));
    }
  }

  for (const d of layout.desks) {
    for (let dy = 0; dy < d.deskH; dy++) {
      for (let dx = 0; dx < d.deskW; dx++)
        furniture[(d.deskY + dy) * width + d.deskX + dx] = gidOf(deskTile(d, dx));
    }
    furniture[d.seatY * width + d.seatX] = gidOf(CHAIR_TILE[d.facing]);
    const mx = d.seatX + FACING_DELTA[d.facing].x;
    const my = d.seatY + FACING_DELTA[d.facing].y;
    top[my * width + mx] = gidOf(MONITOR_TILE_BY_FACING[d.facing]);
  }

  let objectId = 1;
  const deskObjects: TiledObject[] = layout.desks.map((d) => ({
    height: d.deskH * tileSize,
    id: objectId++,
    name: d.deskId,
    properties: [
      { name: 'deskId', type: 'string', value: d.deskId },
      { name: 'facing', type: 'string', value: d.facing },
      { name: 'kind', type: 'string', value: d.kind },
      { name: 'seatX', type: 'int', value: d.seatX },
      { name: 'seatY', type: 'int', value: d.seatY },
    ],
    rotation: 0,
    type: 'desk',
    visible: true,
    width: d.deskW * tileSize,
    x: d.deskX * tileSize,
    y: d.deskY * tileSize,
  }));
  const zoneObjects: TiledObject[] = layout.zones.map((z) => ({
    height: z.h * tileSize,
    id: objectId++,
    name: z.zoneId,
    properties: [
      { name: 'label', type: 'string', value: ZONE_LABEL_KO[z.zoneId] },
      { name: 'walkable', type: 'bool', value: z.walkable },
      { name: 'zoneId', type: 'string', value: z.zoneId },
    ],
    rotation: 0,
    type: 'zone',
    visible: true,
    width: z.w * tileSize,
    x: z.x * tileSize,
    y: z.y * tileSize,
  }));
  const s = layout.spawn;
  const spawnObjects: TiledObject[] = [
    {
      height: s.h * tileSize,
      id: objectId++,
      name: 'spawn',
      rotation: 0,
      type: 'spawn',
      visible: true,
      width: s.w * tileSize,
      x: s.x * tileSize,
      y: s.y * tileSize,
    },
  ];

  const layers = [
    tileLayer(1, MAP_LAYERS.floor, layout, floor),
    tileLayer(2, MAP_LAYERS.walls, layout, walls),
    tileLayer(3, MAP_LAYERS.furniture, layout, furniture),
    tileLayer(4, MAP_LAYERS.furnitureTop, layout, top),
    objectLayer(5, MAP_LAYERS.desks, deskObjects),
    objectLayer(6, MAP_LAYERS.zones, zoneObjects),
    objectLayer(7, MAP_LAYERS.spawn, spawnObjects),
  ];

  return {
    compressionlevel: -1,
    height,
    infinite: false,
    layers,
    nextlayerid: layers.length + 1,
    nextobjectid: objectId,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: TILED_EDITOR_VERSION,
    tileheight: tileSize,
    tilesets: [buildOfficeTileset(tileSize)],
    tilewidth: tileSize,
    type: 'map',
    version: TILED_FORMAT_VERSION,
    width,
  };
}

/**
 * Stable JSON text for a map: 1-space indentation like Tiled, tile layer data one map row per line,
 * trailing newline. Same input -> byte-identical output (key order follows object construction).
 */
export function serializeTmj(map: TiledMap): string {
  const blocks: string[] = [];
  const json = JSON.stringify(
    map,
    function (this: unknown, key: string, value: unknown) {
      if (key === 'data' && Array.isArray(value) && typeof this === 'object' && this !== null) {
        const width = (this as { width?: unknown }).width;
        const w = typeof width === 'number' && width > 0 ? width : value.length;
        const rows: string[] = [];
        for (let i = 0; i < value.length; i += w) rows.push(value.slice(i, i + w).join(','));
        blocks.push(rows.join(',\n'));
        return `__tmj_data_${blocks.length - 1}__`;
      }
      return value;
    },
    1,
  );
  const text = json.replace(/^(\s*)"data": "__tmj_data_(\d+)__"/gm, (_m, indent: string, n: string) => {
    const rows = (blocks[Number(n)] ?? '')
      .split('\n')
      .map((r) => `${indent} ${r}`)
      .join('\n');
    return `${indent}"data": [\n${rows}\n${indent}]`;
  });
  return `${text}\n`;
}
