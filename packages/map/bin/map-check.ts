/**
 * `pnpm map:check` — validates the 606호 Tiled map and writes `office-606.meta.json` next to it.
 * Exits non-zero (and writes nothing) when the map breaks a gameplay invariant.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { OFFICE_MAP_ID } from '@enu/shared';
import {
  buildWorld,
  parseTmj,
  rawTmjIssues,
  validateOfficeMap,
  type OfficeWorld,
  type TiledMap,
} from '../src/index';
import { OFFICE_606_META_PATH, OFFICE_606_TILESET_PNG_PATH, OFFICE_606_TMJ_PATH } from '../scripts/paths';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(lines: readonly string[]): number {
  console.error(`map:check FAILED (${relative(process.cwd(), OFFICE_606_TMJ_PATH)})`);
  for (const l of lines) console.error(`  - ${l}`);
  return 1;
}

function pngSize(path: string): { width: number; height: number } | null {
  const head = readFileSync(path).subarray(0, 24);
  if (head.length < 24 || !head.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function main(): number {
  if (!existsSync(OFFICE_606_TMJ_PATH)) return fail(['map file not found; run `pnpm map:gen` first']);
  const bytes = readFileSync(OFFICE_606_TMJ_PATH);

  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    return fail([`not valid JSON: ${(err as Error).message}`]);
  }
  const formatIssues = rawTmjIssues(raw);
  if (formatIssues.length > 0) return fail(formatIssues);

  let map: TiledMap;
  let world: OfficeWorld;
  try {
    map = parseTmj(raw);
    world = buildWorld(map);
  } catch (err) {
    return fail([(err as Error).message]);
  }

  const { errors, warnings } = validateOfficeMap(map, world);

  const tileset = map.tilesets[0];
  if (!existsSync(OFFICE_606_TILESET_PNG_PATH)) {
    warnings.push('office-tiles.png not found next to the map yet (run `pnpm sprites:build`)');
  } else if (tileset) {
    const size = pngSize(OFFICE_606_TILESET_PNG_PATH);
    if (!size) errors.push('office-tiles.png is not a PNG file');
    else if (size.width !== tileset.imagewidth || size.height !== tileset.imageheight) {
      errors.push(
        `office-tiles.png is ${size.width}x${size.height}, the tileset expects ${tileset.imagewidth}x${tileset.imageheight}`,
      );
    }
  }

  for (const w of warnings) console.warn(`map:check warning: ${w}`);
  if (errors.length > 0) return fail(errors);

  const meta = {
    mapId: OFFICE_MAP_ID,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: world.width,
    height: world.height,
  };
  writeFileSync(OFFICE_606_META_PATH, `${JSON.stringify(meta, null, 2)}\n`);

  const walkable = world.collision.reduce((n, c) => n + (c === 0 ? 1 : 0), 0);
  console.log(
    `map:check OK ${meta.mapId} ${world.width}x${world.height} @${world.tileSize}px, ` +
      `${world.desks.length} desks, ${world.zones.length} zones, ${walkable} walkable tiles`,
  );
  console.log(
    `map:check wrote ${relative(process.cwd(), OFFICE_606_META_PATH)} (sha256 ${meta.sha256.slice(0, 12)}...)`,
  );
  return 0;
}

process.exitCode = main();
