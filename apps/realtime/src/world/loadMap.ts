import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadOfficeWorld, type OfficeWorld } from '@enu/map';
import { OFFICE_MAP_ID } from '@enu/shared';

export interface LoadedMap {
  mapId: string;
  /** sha256 of the .tmj bytes; clients compare it with the map they loaded. */
  mapHash: string;
  /** sha256 recorded by `pnpm map:check` (null when the meta file is missing). */
  metaHash: string | null;
  world: OfficeWorld;
}

/** Reads `${mapsDir}/office-606/office-606.tmj` (+ `.meta.json`) and builds the collision world. */
export function loadOfficeMap(mapsDir: string, mapId: string = OFFICE_MAP_ID): LoadedMap {
  const dir = path.resolve(mapsDir, mapId);
  const bytes = fs.readFileSync(path.join(dir, `${mapId}.tmj`));
  const mapHash = createHash('sha256').update(bytes).digest('hex');
  let metaHash: string | null = null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, `${mapId}.meta.json`), 'utf8')) as { sha256?: unknown };
    metaHash = typeof meta.sha256 === 'string' ? meta.sha256 : null;
  } catch {
    metaHash = null;
  }
  const world = loadOfficeWorld(JSON.parse(bytes.toString('utf8')) as unknown);
  return { mapId, mapHash, metaHash, world };
}
