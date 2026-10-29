import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OFFICE_MAP_ID, TILE_CATALOG, ZONE_LABEL_KO, type TileName } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { OFFICE_606_META_PATH, OFFICE_606_TMJ_PATH } from '../scripts/paths';
import {
  buildWorld,
  checkLayout,
  findObjectLayer,
  generateOfficeTmj,
  getProperty,
  OFFICE_606_DESKS,
  OFFICE_606_LAYOUT,
  rawTmjIssues,
  validateOfficeMap,
  type TiledMap,
} from '../src/index';
import { freshMap, readShippedMapJson, setTile, shippedMap, tileAt, world } from './fixtures';

const nameAt = (map: TiledMap, layer: string, x: number, y: number): TileName | null => {
  const gid = tileAt(map, layer, x, y);
  return gid === 0 ? null : (TILE_CATALOG[gid - 1]?.name ?? null);
};

describe('office-606 layout', () => {
  it('ASCII plan and desk / zone / spawn specs agree', () => {
    expect(checkLayout(OFFICE_606_LAYOUT)).toEqual([]);
  });

  it('reports inconsistencies', () => {
    const moved = OFFICE_606_DESKS.map((d) => (d.deskId === 'L1a' ? { ...d, deskY: 7 } : d));
    const problems = checkLayout({ ...OFFICE_606_LAYOUT, desks: moved });
    expect(problems).toContain('L2a: desk tile (2,7) already belongs to L1a');
    expect(problems).toContain('L1a: seat (3,5) facing down does not point at its own desk');
    expect(problems).toContain('desk tile (2,6) belongs to no desk spec');
    expect(() => generateOfficeTmj({ ...OFFICE_606_LAYOUT, desks: moved })).toThrow(/layout is inconsistent/);

    const badRow = [...OFFICE_606_LAYOUT.ascii];
    badRow[4] = `${badRow[4]!.slice(0, 5)}?${badRow[4]!.slice(6)}`;
    expect(checkLayout({ ...OFFICE_606_LAYOUT, ascii: badRow })).toEqual(["unknown character '?' at (5,4)"]);
  });
});

describe('generateOfficeTmj', () => {
  const map = generateOfficeTmj();

  it('writes an orthogonal 22x23 Tiled 1.10 map with one embedded tileset', () => {
    expect(map).toMatchObject({
      type: 'map',
      version: '1.10',
      orientation: 'orthogonal',
      renderorder: 'right-down',
      infinite: false,
      width: 22,
      height: 23,
      tilewidth: 32,
      tileheight: 32,
      nextlayerid: 8,
      nextobjectid: 14 + 5 + 1 + 1,
    });
    const ts = map.tilesets[0]!;
    expect(map.tilesets).toHaveLength(1);
    expect(ts.tiles).toHaveLength(TILE_CATALOG.length);
    TILE_CATALOG.forEach((entry, id) => {
      expect(ts.tiles![id]).toEqual({
        id,
        properties: [
          { name: 'collides', type: 'bool', value: entry.collides },
          { name: 'name', type: 'string', value: entry.name },
        ],
      });
    });
  });

  it('lays a floor under every cell, by area', () => {
    for (let y = 0; y < 23; y++)
      for (let x = 0; x < 22; x++) expect(tileAt(map, 'floor', x, y)).toBeGreaterThan(0);
    expect(nameAt(map, 'floor', 5, 0)).toBe('floor_wood'); // under the railing
    expect(nameAt(map, 'floor', 5, 1)).toBe('floor_wood');
    expect(nameAt(map, 'floor', 10, 10)).toBe('floor_runner');
    expect(nameAt(map, 'floor', 3, 5)).toBe('floor_carpet');
    expect(nameAt(map, 'floor', 15, 15)).toBe('floor_tile');
    expect(nameAt(map, 'floor', 13, 14)).toBe('floor_tile'); // plant inside the pantry
    expect(nameAt(map, 'floor', 3, 19)).toBe('floor_meeting');
    expect(nameAt(map, 'floor', 1, 21)).toBe('floor_meeting'); // whiteboard
    expect(nameAt(map, 'floor', 16, 19)).toBe('floor_server');
  });

  it('places walls, doors and furniture', () => {
    expect(nameAt(map, 'walls', 0, 0)).toBe('railing');
    expect(nameAt(map, 'walls', 5, 3)).toBe('window');
    expect(nameAt(map, 'walls', 18, 3)).toBe('door_glass');
    expect(nameAt(map, 'walls', 10, 22)).toBe('door_entrance');
    expect(nameAt(map, 'walls', 13, 19)).toBe('server_door');
    expect(nameAt(map, 'walls', 0, 10)).toBe('wall');
    expect(nameAt(map, 'walls', 10, 10)).toBeNull();

    // L1a / L1b: mirrored ㄱ-shaped desks, the returns rise beside the chairs at the outer ends
    expect([2, 3, 4, 5, 6, 7].map((x) => nameAt(map, 'furniture', x, 6))).toEqual([
      'desk_j_ne',
      'desk_j_ew',
      'desk_j_w',
      'desk_j_e',
      'desk_j_ew',
      'desk_j_nw',
    ]);
    expect([2, 7].map((x) => nameAt(map, 'furniture', x, 5))).toEqual(['desk_j_s', 'desk_j_s']);
    // L2a: the return hangs below the bar, so the middle piece's front face meets it
    expect([2, 3, 4].map((x) => nameAt(map, 'furniture', x, 7))).toEqual([
      'desk_j_es',
      'desk_j_ew_sw',
      'desk_j_w',
    ]);
    expect(nameAt(map, 'furniture', 2, 8)).toBe('desk_j_n');
    // R1: executive desk in front of the CEO with a return on his right
    expect(nameAt(map, 'furniture', 16, 5)).toBe('exec_j_es');
    expect(nameAt(map, 'furniture', 16, 6)).toBe('exec_j_n');
    expect(nameAt(map, 'furniture', 17, 5)).toBe('exec_j_w_sw');
    expect(nameAt(map, 'furniture', 15, 5)).toBeNull();
    expect(nameAt(map, 'furniture', 3, 5)).toBe('chair_down');
    expect(nameAt(map, 'furniture', 3, 8)).toBe('chair_up');
    expect(nameAt(map, 'furniture', 17, 6)).toBe('chair_left');
    expect(nameAt(map, 'furniture', 14, 5)).toBe('partition_v');
    expect(nameAt(map, 'furniture', 14, 6)).toBe('partition_v');
    expect(nameAt(map, 'furniture', 14, 7)).toBe('partition_corner');
    expect(nameAt(map, 'furniture', 15, 7)).toBe('partition_h');
    expect(nameAt(map, 'furniture', 20, 7)).toBe('partition_h');
    expect(nameAt(map, 'furniture', 3, 19)).toBe('meeting_table');
    expect(nameAt(map, 'furniture', 3, 18)).toBe('meeting_chair');
    expect(nameAt(map, 'furniture', 20, 14)).toBe('fridge');
    // the microwave sits on the counter along the wall; the fridge door (facing down) stays clear
    expect([17, 18, 19, 20].map((x) => nameAt(map, 'furniture', x, 16))).toEqual([
      'counter',
      'microwave',
      'counter',
      'counter',
    ]);
    expect(nameAt(map, 'furniture', 20, 14)).toBe('fridge');
    expect(nameAt(map, 'furniture', 20, 15)).toBeNull();
    expect(nameAt(map, 'furniture', 15, 18)).toBe('server_rack');
    expect(nameAt(map, 'furniture', 14, 12)).toBe('cabinet');
    expect(nameAt(map, 'furniture', 1, 4)).toBe('plant');
    expect(nameAt(map, 'furniture', 1, 21)).toBe('whiteboard');
  });

  it('puts one monitor on the desk tile each seat faces', () => {
    const monitors: string[] = [];
    for (let y = 0; y < 23; y++) {
      for (let x = 0; x < 22; x++) {
        const n = nameAt(map, 'furniture-top', x, y);
        if (n) monitors.push(`${x},${y}:${n}`);
      }
    }
    expect(monitors).toHaveLength(14);
    expect(nameAt(map, 'furniture-top', 3, 7)).toBe('monitor_front'); // L2a faces up: screen toward the camera
    expect(nameAt(map, 'furniture-top', 3, 6)).toBe('monitor_back'); // L1a faces down
    expect(nameAt(map, 'furniture-top', 16, 6)).toBe('monitor_side'); // R1 faces left
    expect(nameAt(map, 'furniture-top', 18, 12)).toBe('monitor_back'); // R3b
    expect(nameAt(map, 'furniture-top', 15, 8)).toBe('monitor_front'); // R2a
  });

  it('writes desk, zone and spawn objects in pixels', () => {
    const desks = findObjectLayer(map, 'desks')!.objects;
    expect(desks).toHaveLength(14);
    const r1 = desks.find((o) => o.name === 'R1')!;
    expect(r1).toMatchObject({ type: 'desk', x: 16 * 32, y: 5 * 32, width: 32, height: 64 });
    expect(r1.properties).toEqual([
      { name: 'deskId', type: 'string', value: 'R1' },
      { name: 'facing', type: 'string', value: 'left' },
      { name: 'kind', type: 'string', value: 'ceo' },
      { name: 'seatX', type: 'int', value: 17 },
      { name: 'seatY', type: 'int', value: 6 },
    ]);
    const zones = findObjectLayer(map, 'zones')!.objects;
    const server = zones.find((o) => o.name === 'server')!;
    expect(server).toMatchObject({ type: 'zone', x: 14 * 32, y: 18 * 32, width: 7 * 32, height: 4 * 32 });
    expect(getProperty(server, 'label')).toBe(ZONE_LABEL_KO.server);
    expect(getProperty(server, 'walkable')).toBe(false);
    expect(findObjectLayer(map, 'spawn')!.objects).toEqual([
      {
        height: 32,
        id: 20,
        name: 'spawn',
        rotation: 0,
        type: 'spawn',
        visible: true,
        width: 64,
        x: 320,
        y: 672,
      },
    ]);
  });

  it('passes the map checks', () => {
    expect(validateOfficeMap(map, buildWorld(map))).toEqual({ errors: [], warnings: [] });
  });
});

describe('validateOfficeMap', () => {
  const check = (mutate: (m: TiledMap) => void): string[] => {
    const m = freshMap();
    mutate(m);
    return validateOfficeMap(m, buildWorld(m)).errors;
  };

  it('catches a missing desk', () => {
    const errors = check((m) => {
      const layer = findObjectLayer(m, 'desks')!;
      layer.objects = layer.objects.filter((o) => o.name !== 'R3b');
    });
    expect(errors).toContain("desk 'R3b' is missing from the 'desks' layer");
  });

  it('catches a seat cut off from the spawn (the y4 walkway is the only way to R1)', () => {
    const errors = check((m) => setTile(m, 'furniture', 14, 4, 'plant'));
    expect(errors).toEqual(['R1: seat (17,6) is not reachable from the spawn']);
  });

  it('catches a walkable desk surface, a seat facing away and an open server room', () => {
    expect(check((m) => setTile(m, 'furniture', 2, 6, null))).toEqual([
      'L1a: desk surface tile (2,6) does not collide',
    ]);
    expect(
      check((m) => {
        const o = findObjectLayer(m, 'desks')!.objects.find((d) => d.name === 'R1')!;
        o.properties = o.properties!.map((p) => (p.name === 'facing' ? { ...p, value: 'right' } : p));
      }),
    ).toEqual(['R1: seat (17,6) faces right toward (18,6), which is not its desk']);
    const open = check((m) => {
      setTile(m, 'walls', 13, 19, null);
      const z = findObjectLayer(m, 'zones')!.objects.find((o) => o.name === 'server')!;
      z.properties = z.properties!.map((p) => (p.name === 'walkable' ? { ...p, value: true } : p));
    });
    expect(open).toContain('server room tile (14,19) is reachable from the spawn');
  });

  it('catches a tileset that no longer matches the sprite catalog', () => {
    const errors = check((m) => {
      const tile = m.tilesets[0]!.tiles![7]!;
      tile.properties = tile.properties!.map((p) => (p.name === 'name' ? { ...p, value: 'brick' } : p));
    });
    expect(errors).toEqual(['tileset tile 7 is named "brick", catalog says \'wall\'']);
  });

  it('lists raw format problems', () => {
    expect(rawTmjIssues(readShippedMapJson())).toEqual([]);
    const raw = readShippedMapJson() as { tilesets: object[]; layers: Record<string, unknown>[] };
    raw.tilesets = [{ firstgid: 1, source: 'office-tiles.tsx' }];
    raw.layers[0]!.compression = 'zstd';
    expect(rawTmjIssues(raw)).toEqual([
      'tileset #0 is external (office-tiles.tsx); embed it (Map > Embed Tileset)',
      "layer 'floor' is compressed (zstd); use CSV tile layer format",
    ]);
    expect(rawTmjIssues([])).toEqual(['the .tmj root is not a JSON object']);
  });
});

describe('shipped files (apps/web/public/assets/maps/office-606)', () => {
  it('the .tmj passes map:check', () => {
    expect(validateOfficeMap(shippedMap, world).errors).toEqual([]);
  });

  it('meta.json matches the .tmj bytes (run `pnpm map:check` after editing the map)', () => {
    const meta = JSON.parse(readFileSync(OFFICE_606_META_PATH, 'utf8')) as Record<string, unknown>;
    const sha256 = createHash('sha256').update(readFileSync(OFFICE_606_TMJ_PATH)).digest('hex');
    expect(meta).toEqual({ mapId: OFFICE_MAP_ID, sha256, width: world.width, height: world.height });
  });
});
