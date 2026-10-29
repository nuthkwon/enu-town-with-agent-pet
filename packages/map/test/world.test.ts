import { DESK_IDS, ZONE_LABEL_KO } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  buildWorld,
  FACING_DELTA,
  findObjectLayer,
  findTileLayers,
  pixelRectToTiles,
  rectContains,
  WorldError,
  type DeskInfo,
  type TiledMap,
} from '../src/index';
import { freshMap, gidOf, setTile, tileAt, world } from './fixtures';

const desk = (id: string): DeskInfo => {
  const d = world.deskById(id);
  if (!d) throw new Error(`desk ${id} missing`);
  return d;
};

describe('buildWorld: grid', () => {
  it('has the map dimensions', () => {
    expect([world.width, world.height, world.tileSize]).toEqual([22, 23, 32]);
    expect(world.collision).toBeInstanceOf(Uint8Array);
    expect(world.collision).toHaveLength(22 * 23);
    expect(world.inBounds(21, 22)).toBe(true);
    expect(world.inBounds(22, 0)).toBe(false);
    expect(world.isWalkable(-1, 5)).toBe(false);
    expect(world.isWalkable(10, 23)).toBe(false);
  });

  it('blocks walls, windows and the balcony railing but not the doors', () => {
    for (const [x, y] of [
      [0, 10],
      [21, 10],
      [5, 3],
      [0, 0],
      [7, 0],
      [0, 1],
      [21, 2],
      [3, 22],
    ] as const) {
      expect(world.isWalkable(x, y), `(${x},${y})`).toBe(false);
    }
    expect(world.isWalkable(18, 3)).toBe(true); // balcony glass door
    expect(world.isWalkable(19, 3)).toBe(true);
    expect(world.isWalkable(10, 22)).toBe(true); // entrance
    expect(world.isWalkable(5, 1)).toBe(true); // balcony deck
    expect(world.isWalkable(10, 10)).toBe(true); // aisle runner
  });

  it('blocks every desk surface, partitions and furniture; chairs stay walkable', () => {
    for (const d of world.desks) {
      const r = d.tileRect;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++)
          expect(world.isWalkable(x, y), `${d.deskId} (${x},${y})`).toBe(false);
      }
      expect(world.isWalkable(d.seatX, d.seatY), `${d.deskId} seat`).toBe(true);
    }
    // CEO partition: vertical x14 y5..7, horizontal y7 x14..20
    for (let y = 5; y <= 7; y++) expect(world.isWalkable(14, y)).toBe(false);
    for (let x = 14; x <= 20; x++) expect(world.isWalkable(x, 7)).toBe(false);
    expect(world.isWalkable(14, 4)).toBe(true); // walkway past the partition
    expect(world.isWalkable(1, 4)).toBe(false); // plant
    expect(world.isWalkable(20, 6)).toBe(false); // cabinet
    expect(world.isWalkable(3, 19)).toBe(false); // meeting table
    expect(world.isWalkable(3, 18)).toBe(true); // meeting chair
    expect(world.isWalkable(1, 21)).toBe(false); // whiteboard
    expect(world.isWalkable(20, 14)).toBe(false); // fridge
  });

  it('blocks the whole server room (walls, closed door, racks and the non-walkable zone)', () => {
    expect(world.isWalkable(13, 19)).toBe(false); // server door
    for (let y = 18; y <= 21; y++) {
      for (let x = 14; x <= 20; x++) expect(world.isWalkable(x, y), `(${x},${y})`).toBe(false);
    }
  });

  it('uses the tileset properties as the source of truth and masks flip bits', () => {
    const map = freshMap();
    const plant = map.tilesets[0]!.tiles!.find((t) => t.id === gidOf('plant') - 1)!;
    plant.properties = plant.properties!.map((p) => (p.name === 'collides' ? { ...p, value: false } : p));
    expect(buildWorld(map).isWalkable(1, 4)).toBe(true);

    // no `collides` property -> falls back to the catalog entry named by `name`
    const cabinet = map.tilesets[0]!.tiles!.find((t) => t.id === gidOf('cabinet') - 1)!;
    cabinet.properties = cabinet.properties!.filter((p) => p.name !== 'collides');
    expect(buildWorld(map).isWalkable(20, 6)).toBe(false);

    // a flipped wall still collides, an empty cell on the walls layer does not
    const flipped = freshMap();
    setTile(flipped, 'furniture', 10, 10, null);
    findTileLayers(flipped, 'walls')[0]!.data[10 * 22 + 10] = 0x80000000 + gidOf('wall');
    expect(buildWorld(flipped).isWalkable(10, 10)).toBe(false);

    // furniture-top (monitors) never blocks
    const top = freshMap();
    setTile(top, 'furniture-top', 10, 10, 'wall');
    expect(buildWorld(top).isWalkable(10, 10)).toBe(true);
  });
});

describe('buildWorld: zones, desks and spawn', () => {
  it('reads zones with labels and walkability', () => {
    expect(world.zones.map((z) => z.zoneId).sort()).toEqual([
      'balcony',
      'ceo',
      'meeting',
      'pantry',
      'server',
    ]);
    expect(world.zoneAt(3, 19)).toMatchObject({
      zoneId: 'meeting',
      label: ZONE_LABEL_KO.meeting,
      walkable: true,
    });
    expect(world.zoneAt(17, 6)?.zoneId).toBe('ceo');
    expect(world.zoneAt(5, 2)?.zoneId).toBe('balcony');
    expect(world.zoneAt(15, 15)?.zoneId).toBe('pantry');
    expect(world.zoneAt(16, 20)).toMatchObject({ zoneId: 'server', walkable: false });
    expect(world.zoneAt(10, 10)).toBeNull();
    expect(world.zoneAt(3.7, 19.2)?.zoneId).toBe('meeting');
    expect(world.zoneAt(-1, 0)).toBeNull();
    expect(world.zones.find((z) => z.zoneId === 'meeting')?.tileRect).toEqual({ x: 1, y: 18, w: 8, h: 4 });
  });

  it('reads the 14 desks with seats in tiles and desk rects in pixels', () => {
    expect(world.desks.map((d) => d.deskId)).toEqual([...DESK_IDS]);
    expect(desk('L1a')).toEqual({
      deskId: 'L1a',
      kind: 'desk',
      facing: 'down',
      seatX: 3,
      seatY: 5,
      tileRect: { x: 2, y: 6, w: 3, h: 1 },
      pixelRect: { x: 64, y: 192, width: 96, height: 32 },
    });
    expect(desk('R1')).toMatchObject({ kind: 'ceo', tileRect: { x: 15, y: 5, w: 2, h: 2 } });
    expect(world.seatOf('R1')).toEqual({ x: 17, y: 6 });
    expect(world.seatOf('nope')).toBeNull();
    expect(world.deskById('nope')).toBeNull();
  });

  it('finds desks by surface or seat tile', () => {
    expect(world.deskAtTile(2, 6)?.deskId).toBe('L1a');
    expect(world.deskAtTile(4, 6)?.deskId).toBe('L1a');
    expect(world.deskAtTile(3, 5)?.deskId).toBe('L1a'); // seat
    expect(world.deskAtTile(5, 6)?.deskId).toBe('L1b');
    expect(world.deskAtTile(16, 6)?.deskId).toBe('R1');
    expect(world.deskAtTile(17, 6)?.deskId).toBe('R1');
    expect(world.deskAtTile(18, 12)?.deskId).toBe('R3b');
    expect(world.deskAtTile(10, 10)).toBeNull();
    expect(world.deskAtTile(99, 99)).toBeNull();
  });

  it('every seat faces its own desk surface', () => {
    for (const d of world.desks) {
      const front = { x: d.seatX + FACING_DELTA[d.facing].x, y: d.seatY + FACING_DELTA[d.facing].y };
      expect(rectContains(d.tileRect, front.x, front.y), d.deskId).toBe(true);
    }
  });

  it('back-to-back pairs face opposite ways across a one-tile gap', () => {
    for (const [upper, lower] of [
      ['L2a', 'L3a'],
      ['L4a', 'L5a'],
      ['R2b', 'R3b'],
    ] as const) {
      const a = desk(upper);
      const b = desk(lower);
      expect([a.facing, b.facing], `${upper}/${lower}`).toEqual(['up', 'down']);
      expect(a.seatX).toBe(b.seatX);
      expect(b.seatY - a.seatY).toBe(2);
      expect(world.isWalkable(a.seatX, a.seatY + 1), `gap between ${upper}/${lower}`).toBe(true);
      expect(world.deskAtTile(a.seatX, a.seatY + 1)).toBeNull();
    }
  });

  it('R1 (CEO) faces left toward L1b', () => {
    const r1 = desk('R1');
    expect(r1.facing).toBe('left');
    expect(desk('L1b').seatX).toBeLessThan(r1.seatX);
  });

  it('reads the spawn rect', () => {
    expect(world.spawn).toEqual({
      tileRect: { x: 10, y: 21, w: 2, h: 1 },
      pixelRect: { x: 320, y: 672, width: 64, height: 32 },
    });
  });

  it('converts pixel rects to covering tile rects', () => {
    expect(pixelRectToTiles({ x: 64, y: 192, width: 96, height: 32 }, 32)).toEqual({
      x: 2,
      y: 6,
      w: 3,
      h: 1,
    });
    expect(pixelRectToTiles({ x: 70, y: 200, width: 0, height: 0 }, 32)).toEqual({ x: 2, y: 6, w: 1, h: 1 });
    expect(pixelRectToTiles({ x: 60, y: 190, width: 40, height: 10 }, 32)).toEqual({
      x: 1,
      y: 5,
      w: 3,
      h: 2,
    });
  });
});

describe('buildWorld: invalid object layers', () => {
  const mutate = (fn: (map: TiledMap) => void): (() => unknown) => {
    const map = freshMap();
    fn(map);
    return () => buildWorld(map);
  };

  it('rejects unknown and duplicate desk ids, bad facings and out-of-map seats', () => {
    expect(
      mutate((m) => {
        const o = findObjectLayer(m, 'desks')!.objects[0]!;
        o.properties = o.properties!.map((p) => (p.name === 'deskId' ? { ...p, value: 'Z9' } : p));
      }),
    ).toThrow(/unknown deskId "Z9"/);
    expect(
      mutate((m) => {
        const objects = findObjectLayer(m, 'desks')!.objects;
        objects.push({ ...objects[0]!, id: 99 });
      }),
    ).toThrow(/duplicates deskId 'L1a'/);
    expect(
      mutate((m) => {
        const o = findObjectLayer(m, 'desks')!.objects[0]!;
        o.properties = o.properties!.map((p) => (p.name === 'facing' ? { ...p, value: 'north' } : p));
      }),
    ).toThrow(WorldError);
    expect(
      mutate((m) => {
        const o = findObjectLayer(m, 'desks')!.objects[0]!;
        o.properties = o.properties!.map((p) => (p.name === 'seatX' ? { ...p, value: 40 } : p));
      }),
    ).toThrow(/outside the map/);
  });

  it('rejects unknown zones, out-of-bounds rects, rotation and a missing spawn', () => {
    expect(
      mutate((m) => {
        const o = findObjectLayer(m, 'zones')!.objects[0]!;
        o.properties = o.properties!.map((p) => (p.name === 'zoneId' ? { ...p, value: 'roof' } : p));
      }),
    ).toThrow(/unknown zoneId "roof"/);
    expect(
      mutate((m) => {
        findObjectLayer(m, 'zones')!.objects[0]!.width = 9999;
      }),
    ).toThrow(/outside the 22x23 map/);
    expect(
      mutate((m) => {
        findObjectLayer(m, 'zones')!.objects[0]!.rotation = 45;
      }),
    ).toThrow(/rotation is not supported/);
    expect(
      mutate((m) => {
        findObjectLayer(m, 'spawn')!.objects = [];
      }),
    ).toThrow(/'spawn' with at least one object is required/);
  });

  it('keeps the generator tile choices readable from the map', () => {
    const map = freshMap();
    expect(tileAt(map, 'furniture', 14, 7)).toBe(gidOf('partition_corner'));
    expect(buildWorld(map).desks).toHaveLength(14);
  });
});
