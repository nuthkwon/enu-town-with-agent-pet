import { DESK_IDS, TILE_CATALOG, TILE_SIZE, TILESET_COLUMNS, ZONE_IDS } from '@enu/shared';
import { OFFICE_TILESET_NAME } from './constants';
import { reachableMask } from './path';
import { getProperty, type TiledMap } from './tiled';
import { FACING_DELTA, rectContains, type OfficeWorld, type Point } from './world';

export interface MapCheckReport {
  errors: string[];
  warnings: string[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Format-level problems in the raw `.tmj` JSON, all at once (parseTmj stops at the first):
 * external tilesets, compressed / base64 layers, infinite maps.
 */
export function rawTmjIssues(raw: unknown): string[] {
  const issues: string[] = [];
  if (!isRec(raw)) return ['the .tmj root is not a JSON object'];
  if (raw.infinite === true) issues.push('map is infinite; uncheck "Infinite" in Map Properties');
  const tilesets = Array.isArray(raw.tilesets) ? raw.tilesets : [];
  if (tilesets.length === 0) issues.push('map has no tilesets');
  tilesets.forEach((ts, i) => {
    if (isRec(ts) && ts.source !== undefined) {
      issues.push(`tileset #${i} is external (${String(ts.source)}); embed it (Map > Embed Tileset)`);
    }
  });
  const visit = (layers: unknown, prefix: string): void => {
    if (!Array.isArray(layers)) return;
    layers.forEach((l, i) => {
      if (!isRec(l)) return;
      const name = `${prefix}${typeof l.name === 'string' ? l.name : `#${i}`}`;
      if (l.compression !== undefined && l.compression !== '') {
        issues.push(`layer '${name}' is compressed (${String(l.compression)}); use CSV tile layer format`);
      }
      if (l.encoding !== undefined && l.encoding !== 'csv') {
        issues.push(`layer '${name}' uses ${String(l.encoding)} encoding; use CSV tile layer format`);
      }
      if (l.type === 'group') visit(l.layers, `${name}/`);
    });
  };
  visit(raw.layers, '');
  return issues;
}

const fmt = (p: Point): string => `(${p.x},${p.y})`;

/**
 * Semantic checks for the 606호 map (what `pnpm map:check` enforces): tileset matches the sprite
 * catalog, exactly the 14 desks, seats walkable + reachable from spawn and facing their own desk,
 * desk surfaces blocked, server room unreachable, zones / spawn in bounds, and the director spots
 * (meeting seats, break spots, a visitor tile per desk) usable.
 */
export function validateOfficeMap(map: TiledMap, world: OfficeWorld): MapCheckReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  // tileset <-> sprite catalog contract
  if (world.tileSize !== TILE_SIZE)
    errors.push(`tile size is ${world.tileSize}px, the client expects ${TILE_SIZE}px`);
  const ts = map.tilesets.find((t) => t.name === OFFICE_TILESET_NAME);
  if (!ts) {
    errors.push(`embedded tileset '${OFFICE_TILESET_NAME}' is missing`);
  } else {
    if (ts.columns !== TILESET_COLUMNS)
      errors.push(`tileset columns ${ts.columns}, expected ${TILESET_COLUMNS}`);
    if (ts.tilecount < TILE_CATALOG.length) {
      errors.push(`tileset has ${ts.tilecount} tiles, the catalog has ${TILE_CATALOG.length}`);
    }
    const expectedW = TILESET_COLUMNS * ts.tilewidth;
    const expectedH = Math.ceil(TILE_CATALOG.length / TILESET_COLUMNS) * ts.tileheight;
    if (ts.imagewidth !== expectedW || ts.imageheight < expectedH) {
      errors.push(`tileset image is ${ts.imagewidth}x${ts.imageheight}, expected ${expectedW}x${expectedH}`);
    }
    const tiles = new Map((ts.tiles ?? []).map((t) => [t.id, t]));
    TILE_CATALOG.forEach((entry, id) => {
      const tile = tiles.get(id);
      const name = getProperty(tile, 'name');
      if (name !== entry.name) {
        errors.push(`tileset tile ${id} is named ${JSON.stringify(name)}, catalog says '${entry.name}'`);
      }
      const collides = getProperty(tile, 'collides');
      if (collides !== undefined && collides !== entry.collides) {
        warnings.push(
          `tileset tile ${id} ('${entry.name}') collides=${String(collides)} overrides catalog ${entry.collides}`,
        );
      }
    });
  }

  // desks
  const ids = world.desks.map((d) => d.deskId);
  for (const id of DESK_IDS)
    if (!ids.includes(id)) errors.push(`desk '${id}' is missing from the 'desks' layer`);
  if (world.desks.length !== DESK_IDS.length) {
    errors.push(`expected exactly ${DESK_IDS.length} desks, found ${world.desks.length}`);
  }

  // spawn
  const spawnTiles: Point[] = [];
  const sr = world.spawn.tileRect;
  for (let y = sr.y; y < sr.y + sr.h; y++) {
    for (let x = sr.x; x < sr.x + sr.w; x++) if (world.isWalkable(x, y)) spawnTiles.push({ x, y });
  }
  if (spawnTiles.length === 0) errors.push(`spawn area ${fmt(sr)} has no walkable tile`);
  const reach = reachableMask(world, spawnTiles);
  const reachable = (x: number, y: number): boolean => reach[y * world.width + x] === 1;

  const seatOwners = new Map<string, string>();
  for (const d of world.desks) {
    const seat = { x: d.seatX, y: d.seatY };
    const owner = seatOwners.get(fmt(seat));
    if (owner) errors.push(`${d.deskId}: seat ${fmt(seat)} is shared with ${owner}`);
    seatOwners.set(fmt(seat), d.deskId);
    if (!world.isWalkable(seat.x, seat.y)) errors.push(`${d.deskId}: seat ${fmt(seat)} is not walkable`);
    else if (spawnTiles.length > 0 && !reachable(seat.x, seat.y)) {
      errors.push(`${d.deskId}: seat ${fmt(seat)} is not reachable from the spawn`);
    }
    if (rectContains(d.tileRect, seat.x, seat.y))
      errors.push(`${d.deskId}: seat ${fmt(seat)} is on the desk surface`);
    const front = { x: seat.x + FACING_DELTA[d.facing].x, y: seat.y + FACING_DELTA[d.facing].y };
    if (!rectContains(d.tileRect, front.x, front.y)) {
      errors.push(
        `${d.deskId}: seat ${fmt(seat)} faces ${d.facing} toward ${fmt(front)}, which is not its desk`,
      );
    }
    const r = d.tileRect;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (world.isWalkable(x, y))
          errors.push(`${d.deskId}: desk surface tile (${x},${y}) does not collide`);
      }
    }
  }

  // director spots. Seats are reachable from the spawn (above), so a spot reachable from the spawn is
  // reachable from every seat; visitor tiles are walkable neighbours of a seat, and the pet perch is the
  // tile the seat faces (checked above), so neither needs its own reachability check.
  const { spots } = world;
  if (spots.meetingSeats.length === 0) {
    errors.push(`no meeting seats ('meeting_chair' tiles next to a 'meeting_table' in the 'meeting' zone)`);
  }
  if (spots.breakSpots.length === 0) errors.push(`no break spots (walkable tiles in the 'pantry' zone)`);
  for (const [what, list] of [
    ['meeting seat', spots.meetingSeats],
    ['break spot', spots.breakSpots],
  ] as const) {
    for (const s of list) {
      if (!world.isWalkable(s.x, s.y)) errors.push(`${what} ${fmt(s)} is not walkable`);
      else if (spawnTiles.length > 0 && !reachable(s.x, s.y))
        errors.push(`${what} ${fmt(s)} is not reachable from the spawn`);
    }
  }
  for (const d of world.desks) {
    if (spots.visitorTiles(d.deskId).length === 0) {
      errors.push(
        `${d.deskId}: no visitor tile next to seat (${d.seatX},${d.seatY}) (a walkable tile left, right, above or below it that is not a seat or chair)`,
      );
    }
  }

  // zones
  for (const id of ZONE_IDS) {
    if (!world.zones.some((z) => z.zoneId === id))
      errors.push(`zone '${id}' is missing from the 'zones' layer`);
  }
  for (const z of world.zones) {
    const r = z.tileRect;
    if (r.x < 0 || r.y < 0 || r.x + r.w > world.width || r.y + r.h > world.height || r.w < 1 || r.h < 1) {
      errors.push(`zone '${z.zoneId}' ${fmt(r)} ${r.w}x${r.h} is out of bounds`);
    }
    if (z.zoneId === 'server') {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (reachable(x, y)) errors.push(`server room tile (${x},${y}) is reachable from the spawn`);
        }
      }
    }
  }

  // walkable pockets nobody can get to (usually a stray wall in Tiled)
  const pockets: string[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++)
      if (world.isWalkable(x, y) && !reachable(x, y)) pockets.push(`(${x},${y})`);
  }
  if (pockets.length > 0 && spawnTiles.length > 0) {
    warnings.push(
      `${pockets.length} walkable tile(s) unreachable from the spawn: ${pockets.slice(0, 10).join(' ')}`,
    );
  }

  return { errors, warnings };
}
