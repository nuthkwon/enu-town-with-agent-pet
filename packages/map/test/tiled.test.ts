import { TILE_CATALOG } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  findObjectLayer,
  findTileLayers,
  generateOfficeTmj,
  getProperty,
  parseTmj,
  serializeTmj,
  tileGid,
  tilesetForGid,
  TmjError,
  walkLayers,
} from '../src/index';
import { readShippedMapJson, shippedMap } from './fixtures';

type Json = Record<string, unknown>;

function rawMap(): Json {
  return JSON.parse(serializeTmj(generateOfficeTmj())) as Json;
}

function layer(raw: Json, i: number): Json {
  return (raw.layers as Json[])[i]!;
}

function expectTmjError(raw: unknown, pattern: RegExp, path?: string): void {
  try {
    parseTmj(raw);
  } catch (err) {
    expect(err).toBeInstanceOf(TmjError);
    expect((err as Error).message).toMatch(pattern);
    if (path) expect((err as TmjError).path).toBe(path);
    return;
  }
  throw new Error('expected parseTmj to throw');
}

describe('parseTmj', () => {
  it('parses the shipped office-606 map', () => {
    expect(shippedMap.orientation).toBe('orthogonal');
    expect(shippedMap.infinite).toBe(false);
    expect(shippedMap.renderorder).toBe('right-down');
    expect([shippedMap.width, shippedMap.height, shippedMap.tilewidth, shippedMap.tileheight]).toEqual([
      22, 23, 32, 32,
    ]);
    expect([...walkLayers(shippedMap.layers)].map((l) => `${l.type}:${l.name}`)).toEqual([
      'tilelayer:floor',
      'tilelayer:walls',
      'tilelayer:furniture',
      'tilelayer:furniture-top',
      'objectgroup:desks',
      'objectgroup:zones',
      'objectgroup:spawn',
    ]);
    expect(shippedMap.tilesets).toHaveLength(1);
    const ts = shippedMap.tilesets[0]!;
    expect(ts).toMatchObject({
      name: 'office-tiles',
      image: 'office-tiles.png',
      firstgid: 1,
      columns: 8,
      tilecount: TILE_CATALOG.length,
      imagewidth: 8 * 32,
      imageheight: Math.ceil(TILE_CATALOG.length / 8) * 32,
    });
    expect(getProperty(ts.tiles?.[7], 'name')).toBe('wall');
    expect(getProperty(ts.tiles?.[7], 'collides')).toBe(true);
    expect(tilesetForGid(shippedMap, 8)?.name).toBe('office-tiles');
    expect(tilesetForGid(shippedMap, 0)).toBeUndefined();
  });

  it('normalizes the generator output without losing anything', () => {
    const map = generateOfficeTmj();
    expect(parseTmj(JSON.parse(serializeTmj(map)))).toEqual(map);
  });

  it('drops unknown fields but keeps the data', () => {
    const raw = readShippedMapJson() as Json;
    raw.editorsettings = { export: { format: 'json' } };
    const map = parseTmj(raw);
    expect(map).not.toHaveProperty('editorsettings');
    expect(map.layers).toEqual(shippedMap.layers);
  });

  it('accepts flipped gids and masks the flip bits', () => {
    expect(tileGid(0x80000000 + 8)).toBe(8);
    expect(tileGid(0xe0000000 + 8)).toBe(8);
    const raw = rawMap();
    (layer(raw, 1).data as number[])[0] = 0x40000000 + 8;
    const map = parseTmj(raw);
    expect(findTileLayers(map, 'walls')[0]!.data[0]).toBe(0x40000000 + 8);
  });

  it('accepts Tiled 1.9 `class` on objects and group layers', () => {
    const raw = rawMap();
    const desks = layer(raw, 4);
    const obj = (desks.objects as Json[])[0]!;
    obj.class = obj.type;
    delete obj.type;
    raw.layers = [{ type: 'group', id: 9, name: 'g', layers: raw.layers }];
    const map = parseTmj(raw);
    expect(findObjectLayer(map, 'desks')?.objects[0]?.type).toBe('desk');
    expect(findTileLayers(map, 'floor')).toHaveLength(1);
  });

  it('rejects unsupported or malformed maps with descriptive errors', () => {
    expectTmjError(null, /expected an object/, 'map');
    expectTmjError({ ...rawMap(), orientation: 'isometric' }, /only orthogonal maps/, 'map.orientation');
    expectTmjError({ ...rawMap(), infinite: true }, /infinite maps are not supported/, 'map.infinite');
    expectTmjError({ ...rawMap(), type: 'tileset' }, /expected 'map'/);
    expectTmjError({ ...rawMap(), width: 0 }, /must be >= 1/, 'map.width');

    const external = rawMap();
    external.tilesets = [{ firstgid: 1, source: 'office-tiles.tsx' }];
    expectTmjError(external, /external tileset "office-tiles.tsx".*Embed Tileset/, 'map.tilesets[0].source');

    const collection = rawMap();
    delete (collection.tilesets as Json[])[0]!.image;
    expectTmjError(collection, /image-collection tilesets are not supported/);

    const compressed = rawMap();
    Object.assign(layer(compressed, 0), { compression: 'zlib', encoding: 'base64', data: 'eJw=' });
    expectTmjError(compressed, /compressed.*CSV/, 'map.layers[0].compression');

    const base64 = rawMap();
    Object.assign(layer(base64, 0), { encoding: 'base64', data: 'AAAA' });
    expectTmjError(base64, /base64.*CSV/, 'map.layers[0].encoding');

    const short = rawMap();
    (layer(short, 2).data as number[]).pop();
    expectTmjError(short, /has 505 cells, expected 506/, 'map.layers[2].data');

    const unknownGid = rawMap();
    (layer(unknownGid, 1).data as number[])[23] = 999;
    expectTmjError(
      unknownGid,
      /\(x=1, y=1\) uses gid 999, which belongs to no tileset/,
      'map.layers[1].data[23]',
    );

    const negative = rawMap();
    (layer(negative, 1).data as number[])[0] = -1;
    expectTmjError(negative, /unsigned 32-bit integer/);

    const badProp = rawMap();
    const deskProps = ((layer(badProp, 4).objects as Json[])[0]!.properties as Json[])[3]!;
    deskProps.value = 'three';
    expectTmjError(badProp, /property 'seatX' of type 'int' expects an integer/);

    const badLayer = rawMap();
    layer(badLayer, 3).type = 'mystery';
    expectTmjError(badLayer, /unsupported layer type "mystery"/, 'map.layers[3].type');

    const overlap = rawMap();
    (overlap.tilesets as Json[]).push({ ...(overlap.tilesets as Json[])[0]!, name: 'dup', firstgid: 10 });
    expectTmjError(overlap, /overlaps 'office-tiles'/);

    const wrongSize = rawMap();
    layer(wrongSize, 0).width = 21;
    expectTmjError(wrongSize, /is 21x23 but the map is 22x23/);
  });
});

describe('serializeTmj', () => {
  it('is deterministic, round-trips and prints one map row per line', () => {
    const a = serializeTmj(generateOfficeTmj());
    const b = serializeTmj(generateOfficeTmj());
    expect(a).toBe(b);
    expect(a.endsWith('}\n')).toBe(true);
    expect(JSON.parse(a)).toEqual(generateOfficeTmj());
    const firstDataLine = a.split('\n').find((l) => /^\s+\d/.test(l));
    expect(firstDataLine?.trim().split(',').filter(Boolean)).toHaveLength(22);
  });
});
