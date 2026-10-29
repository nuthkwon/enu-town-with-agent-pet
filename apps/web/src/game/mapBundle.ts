import { buildWorld, parseTmj, type OfficeWorld } from '@enu/map';
import { MAP_PATHS } from './spriteSpec';

/** The office map as loaded by the browser: raw Tiled JSON (for Phaser) + collision world (for A*). */
export interface MapBundle {
  json: unknown;
  world: OfficeWorld;
  /** sha256 hex of the .tmj bytes (null when WebCrypto is unavailable, e.g. plain http on a LAN IP). */
  hash: string | null;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export async function loadMapBundle(signal?: AbortSignal): Promise<MapBundle> {
  const res = await fetch(MAP_PATHS.tmj, { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`map request failed (${res.status})`);
  const bytes = await res.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const world = buildWorld(parseTmj(json));
  return { json, world, hash };
}
