/**
 * Visual QA: composes contact sheets (scaled x4, nearest neighbour) of every generated sprite into
 * `../enu-preview/` next to the repository (outside of git).
 *
 *   pnpm --filter @enu/sprites exec tsx scripts/preview.ts [outDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AvatarPreset, PET_SPECIES } from '@enu/shared';
import { Canvas } from '../src/draw/canvas';
import { hex } from '../src/draw/color';
import { encodePng } from '../src/png';
import { renderAvatarFrame } from '../src/avatar';
import { renderPetFrame } from '../src/pet';
import { renderEffectFrame, renderEffectsImage } from '../src/effects';
import { renderTilesetImage } from '../src/tileset';
import { paintTile } from '../src/parts/tiles';
import {
  AVATAR_FRAME,
  EFFECT_FRAMES,
  type EffectName,
  PET_ANIMS,
  PET_FRAME,
  TILE,
  TILESET_COLUMNS,
} from '../src/spec';
import { TILE_CATALOG, type TileName } from '@enu/shared';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outDir = resolve(process.argv[2] ?? join(repoRoot, '..', 'enu-preview'));
mkdirSync(outDir, { recursive: true });

const BG = hex('#f6eefa');
const BG2 = hex('#ece2f4');

function background(w: number, h: number, cell = 8): Canvas {
  const c = new Canvas(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) c.set(x, y, (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? BG2 : BG);
  return c;
}

function save(name: string, c: Canvas, scale: number): void {
  const file = join(outDir, name);
  writeFileSync(file, encodePng(scale === 1 ? c : c.scale(scale)));
  console.log(`wrote ${file}`);
}

function seatPresets(): AvatarPreset[] {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'config/seats.example.json'), 'utf8')) as {
    seats: { avatar: AvatarPreset }[];
  };
  return raw.seats.map((s) => s.avatar);
}

const FRAMES: [('down' | 'left' | 'right' | 'up'), 'idle' | 'walk', number][] = [
  ['down', 'idle', 0],
  ['down', 'idle', 1],
  ['down', 'walk', 0],
  ['down', 'walk', 1],
  ['down', 'walk', 2],
  ['left', 'idle', 0],
  ['left', 'walk', 0],
  ['left', 'walk', 2],
  ['left', 'walk', 3],
  ['right', 'idle', 0],
  ['up', 'idle', 0],
  ['up', 'walk', 0],
  ['up', 'walk', 3],
];

function avatarSheet(presets: AvatarPreset[]): Canvas {
  const cell = 34;
  const c = background(FRAMES.length * cell + 2, presets.length * cell + 2);
  presets.forEach((p, row) => {
    FRAMES.forEach(([dir, anim, i], col) => {
      c.blit(renderAvatarFrame(p, dir, anim, i), 2 + col * cell, 2 + row * cell);
    });
  });
  return c;
}

const presets = seatPresets();
save('avatars-1.png', avatarSheet(presets.slice(0, 7)), 4);
save('avatars-2.png', avatarSheet(presets.slice(7)), 4);
save('avatars-1x.png', avatarSheet(presets), 2);

function petSheet(): Canvas {
  const cell = 26;
  const cols: ['left' | 'right', 'idle' | 'hop' | 'sleep', number][] = [];
  for (const anim of ['idle', 'hop', 'sleep'] as const)
    for (let i = 0; i < PET_ANIMS[anim].frames; i++) cols.push(['left', anim, i]);
  cols.push(['right', 'idle', 0], ['right', 'hop', 2], ['right', 'sleep', 0]);
  const c = background(cols.length * cell + 2, PET_SPECIES.length * cell + 2);
  PET_SPECIES.forEach((sp, row) => {
    cols.forEach(([dir, anim, i], col) => c.blit(renderPetFrame(sp, dir, anim, i), 2 + col * cell, 2 + row * cell));
  });
  return c;
}
save('pets.png', petSheet(), 4);

/* ---------- tileset: the sheet itself plus 3x3 repeats of tiles that must be seamless ---------- */
save('tileset.png', (() => {
  const t = renderTilesetImage();
  const c = background(t.width + 4, t.height + 4);
  c.blit(t, 2, 2);
  return c;
})(), 4);

const SEAMLESS: TileName[] = [
  'floor_carpet',
  'floor_runner',
  'floor_wood',
  'floor_tile',
  'floor_meeting',
  'floor_server',
  'wall',
  'window',
  'railing',
  'desk_mid',
  'desk_block',
  'meeting_table',
  'partition_h',
  'partition_v',
  'counter',
  'cabinet',
];
save('tiles-seamless.png', (() => {
  const n = 3;
  const cell = TILE * n + 6;
  const per = 4;
  const c = background(per * cell, Math.ceil(SEAMLESS.length / per) * cell);
  SEAMLESS.forEach((name, k) => {
    const ox = (k % per) * cell + 3;
    const oy = Math.floor(k / per) * cell + 3;
    const floor = paintTile(name.startsWith('floor') ? name : 'floor_carpet');
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        c.blit(floor, ox + x * TILE, oy + y * TILE);
        c.blit(paintTile(name), ox + x * TILE, oy + y * TILE);
      }
  });
  return c;
})(), 2);

/* ---------- effects ---------- */
save('effects.png', (() => {
  const e = renderEffectsImage();
  const c = background(e.width + 4, e.height + 4, 4);
  c.blit(e, 2, 2);
  return c;
})(), 8);

/* ---------- scene: the generated office map with every seat's avatar + pet ---------- */
interface TmjLayer {
  name: string;
  type: string;
  data?: number[];
  objects?: { name: string; properties?: { name: string; value: unknown }[] }[];
}
function scene(): Canvas | undefined {
  let tmj: { width: number; height: number; layers: TmjLayer[] };
  try {
    tmj = JSON.parse(
      readFileSync(join(repoRoot, 'apps/web/public/assets/maps/office-606/office-606.tmj'), 'utf8'),
    ) as typeof tmj;
  } catch {
    console.log('no office-606.tmj yet (pnpm map:gen) - skipping scene');
    return undefined;
  }
  const tiles = TILE_CATALOG.map((t) => paintTile(t.name));
  const c = new Canvas(tmj.width * TILE, tmj.height * TILE);
  const drawLayer = (name: string): void => {
    const layer = tmj.layers.find((l) => l.name === name);
    layer?.data?.forEach((gid, i) => {
      if (gid > 0) c.blit(tiles[gid - 1]!, (i % tmj.width) * TILE, Math.floor(i / tmj.width) * TILE);
    });
  };
  drawLayer('floor');
  drawLayer('walls');
  drawLayer('furniture');
  const seats = (
    JSON.parse(readFileSync(join(repoRoot, 'config/seats.example.json'), 'utf8')) as {
      seats: { deskId: string; avatar: AvatarPreset; pet: { species: (typeof PET_SPECIES)[number] } }[];
    }
  ).seats;
  const desks = tmj.layers.find((l) => l.name === 'desks')?.objects ?? [];
  const shadow = renderEffectFrame('shadow');
  const shadowSmall = renderEffectFrame('shadowSmall');
  seats.forEach((seat, k) => {
    const d = desks.find((o) => o.name === seat.deskId);
    const prop = (n: string): unknown => d?.properties?.find((p) => p.name === n)?.value;
    if (!d) return;
    const sx = Number(prop('seatX')) * TILE;
    const sy = Number(prop('seatY')) * TILE;
    const facing = String(prop('facing')) as 'up' | 'down' | 'left' | 'right';
    c.blit(shadow, sx + 8, sy + 31 - 9);
    c.blit(renderAvatarFrame(seat.avatar, facing, k % 3 === 0 ? 'walk' : 'idle', k % 4), sx, sy - 6);
    const px = sx + (facing === 'left' ? -18 : 18);
    const py = sy - 6;
    c.blit(shadowSmall, px + 4, py + 16);
    c.blit(renderPetFrame(seat.pet.species, facing === 'left' ? 'right' : 'left', k % 5 === 0 ? 'sleep' : 'idle', k % 4), px, py);
  });
  drawLayer('furniture-top');
  // a couple of floating effects
  c.blit(renderEffectFrame('sparkle2'), 10 * TILE, 12 * TILE);
  c.blit(renderEffectFrame('heart'), 4 * TILE + 8, 4 * TILE);
  c.blit(renderEffectFrame('zzz'), 7 * TILE, 14 * TILE);
  return c;
}
const sc = scene();
if (sc) {
  save('scene.png', sc, 2);
  save('scene-zoom.png', sc.crop(0, 3 * TILE, 12 * TILE, 8 * TILE), 3);
  save('scene-zoom2.png', sc.crop(12 * TILE, 3 * TILE, 10 * TILE, 8 * TILE), 3);
  save('scene-zoom3.png', sc.crop(0, 12 * TILE, 22 * TILE, 11 * TILE), 2);
}
void AVATAR_FRAME;
void PET_FRAME;
void TILESET_COLUMNS;
void EFFECT_FRAMES;
export type { EffectName };
