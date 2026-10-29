/**
 * Visual QA: composes contact sheets of every generated sprite (nearest-neighbour upscaled) into a
 * folder OUTSIDE the repository (default: `<repo>/../enu-preview/`).
 *
 *   pnpm --filter @enu/sprites exec tsx scripts/preview.ts [outDir]
 *
 * Files: avatars-1.png / avatars-2.png (14 seat presets, x4), avatars-2x.png (all presets, x2),
 * hair-styles.png (8 styles x 4 directions, x6), avatar-anim.png (full sheets with shadows, x5),
 * pets.png (x4), pets-zoom.png (x6), tileset.png (x4), tiles-seamless.png (3x3 repeats, x2),
 * effects.png (x8), scene.png (the generated office map with every seat, x2) + zoomed crops.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AvatarPreset,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  PET_SPECIES,
  type PetSpecies,
  SKIN_TONES,
  TILE_CATALOG,
  type TileName,
} from '@enu/shared';
import { renderAvatarFrame, renderAvatarImage } from '../src/avatar';
import { Canvas } from '../src/draw/canvas';
import { hex } from '../src/draw/color';
import { renderEffectFrame, renderEffectsImage } from '../src/effects';
import { paintTile } from '../src/parts/tiles';
import { renderPetFrame } from '../src/pet';
import { encodePng } from '../src/png';
import {
  AVATAR_COLUMNS,
  AVATAR_DIRECTIONS,
  AVATAR_FEET_Y,
  AVATAR_FRAME,
  type AvatarAnim,
  type AvatarDirection,
  PET_ANIMS,
  PET_FRAME,
  type PetAnim,
  type PetDirection,
  TILE,
} from '../src/spec';
import { renderTilesetImage } from '../src/tileset';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outDir = resolve(process.argv[2] ?? join(repoRoot, '..', 'enu-preview'));
mkdirSync(outDir, { recursive: true });

const BG = hex('#f6eefa');
const BG2 = hex('#ece2f4');

function background(w: number, h: number, cell = 8): Canvas {
  const c = new Canvas(w, h);
  c.map((x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? BG2 : BG));
  return c;
}

function save(name: string, c: Canvas, scale: number): void {
  const file = join(outDir, name);
  writeFileSync(file, encodePng(scale === 1 ? c : c.scale(scale)));
  console.log(`wrote ${file}`);
}

/** Avatar presets of seats.example.json (pseudonymous; names are not used). */
const seats = (
  JSON.parse(readFileSync(join(repoRoot, 'config/seats.example.json'), 'utf8')) as {
    seats: { deskId: string; avatar: AvatarPreset; pet: { species: PetSpecies } }[];
  }
).seats;
const presets = seats.map((s) => s.avatar);

/* ---------- avatars ---------- */

const FRAMES: [AvatarDirection, AvatarAnim, number][] = [
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

function avatarSheet(list: AvatarPreset[]): Canvas {
  const cell = AVATAR_FRAME + 2;
  const c = background(FRAMES.length * cell + 2, list.length * cell + 2);
  list.forEach((p, row) => {
    FRAMES.forEach(([dir, anim, i], col) =>
      c.blit(renderAvatarFrame(p, dir, anim, i), 2 + col * cell, 2 + row * cell),
    );
  });
  return c;
}

save('avatars-1.png', avatarSheet(presets.slice(0, 7)), 4);
save('avatars-2.png', avatarSheet(presets.slice(7)), 4);
save('avatars-2x.png', avatarSheet(presets), 2);

/* every hair style (alternating bodies, colours, skins; two with wings) in all four directions */
save(
  'hair-styles.png',
  (() => {
    const dirs: [AvatarDirection, AvatarAnim, number][] = [
      ['down', 'idle', 0],
      ['left', 'idle', 0],
      ['right', 'walk', 0],
      ['up', 'idle', 0],
    ];
    const cell = AVATAR_FRAME + 1;
    const c = background(dirs.length * 2 * cell, 4 * cell);
    HAIR_STYLES.forEach((hair, i) => {
      const p: AvatarPreset = {
        body: i % 2 ? 'm' : 'f',
        hair,
        hairColor: HAIR_COLORS[i]!,
        outfit: OUTFIT_COLORS[i]!,
        skin: SKIN_TONES[i % 3]!,
        wings: i === 2 || i === 5,
      };
      dirs.forEach(([d, a, f], col) =>
        c.blit(renderAvatarFrame(p, d, a, f), ((i % 2) * dirs.length + col) * cell, Math.floor(i / 2) * cell),
      );
    });
    return c;
  })(),
  6,
);

/* full sheets (all frames) with the ground shadow, to judge the bounce */
save(
  'avatar-anim.png',
  (() => {
    const list: AvatarPreset[] = [
      { body: 'f', hair: 'ponytail', hairColor: 'pink', outfit: 'lilac', skin: 'light', wings: true },
      { body: 'm', hair: 'swept', hairColor: 'blonde', outfit: 'mint', skin: 'tan', wings: false },
    ];
    const sheetH = AVATAR_DIRECTIONS.length * AVATAR_FRAME;
    const c = new Canvas(AVATAR_COLUMNS * AVATAR_FRAME, sheetH * list.length);
    c.map((x, y) => (((x >> 5) + (y >> 5)) % 2 ? BG : BG2));
    const shadow = renderEffectFrame('shadow');
    list.forEach((p, k) => {
      for (let r = 0; r < AVATAR_DIRECTIONS.length; r++)
        for (let col = 0; col < AVATAR_COLUMNS; col++)
          c.blit(shadow, col * AVATAR_FRAME + 8, k * sheetH + r * AVATAR_FRAME + AVATAR_FEET_Y - 9);
      c.blit(renderAvatarImage(p), 0, k * sheetH);
    });
    return c;
  })(),
  5,
);

/* ---------- pets ---------- */

function petSheet(cols: [PetDirection, PetAnim, number][]): Canvas {
  const cell = PET_FRAME + 2;
  const c = background(cols.length * cell + 2, PET_SPECIES.length * cell + 2);
  PET_SPECIES.forEach((sp, row) => {
    cols.forEach(([dir, anim, i], col) =>
      c.blit(renderPetFrame(sp, dir, anim, i), 2 + col * cell, 2 + row * cell),
    );
  });
  return c;
}
const allPetFrames: [PetDirection, PetAnim, number][] = [];
for (const anim of ['idle', 'hop', 'sleep'] as const)
  for (let i = 0; i < PET_ANIMS[anim].frames; i++) allPetFrames.push(['left', anim, i]);
allPetFrames.push(['right', 'idle', 0], ['right', 'hop', 2], ['right', 'sleep', 0]);
save('pets.png', petSheet(allPetFrames), 4);
save(
  'pets-zoom.png',
  petSheet([
    ['left', 'idle', 0],
    ['left', 'idle', 1],
    ['left', 'hop', 0],
    ['left', 'sleep', 0],
    ['right', 'idle', 2],
  ]),
  6,
);

/* ---------- tileset ---------- */

save(
  'tileset.png',
  (() => {
    const t = renderTilesetImage();
    const c = background(t.width + 4, t.height + 4);
    c.blit(t, 2, 2);
    return c;
  })(),
  4,
);

/* tiles that are repeated on the map, shown 3x3 over their floor to check the seams */
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
save(
  'tiles-seamless.png',
  (() => {
    const n = 3;
    const per = 4;
    const cell = TILE * n + 6;
    const c = background(per * cell, Math.ceil(SEAMLESS.length / per) * cell);
    SEAMLESS.forEach((name, k) => {
      const ox = (k % per) * cell + 3;
      const oy = Math.floor(k / per) * cell + 3;
      const floor = paintTile(name.startsWith('floor') ? name : 'floor_carpet');
      const tile = paintTile(name);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          c.blit(floor, ox + x * TILE, oy + y * TILE);
          c.blit(tile, ox + x * TILE, oy + y * TILE);
        }
    });
    return c;
  })(),
  2,
);

/* ---------- effects ---------- */

save(
  'effects.png',
  (() => {
    const e = renderEffectsImage();
    const c = background(e.width + 4, e.height + 4, 4);
    c.blit(e, 2, 2);
    return c;
  })(),
  8,
);

/* ---------- scene: the generated office map with every seat's avatar and pet ---------- */

interface TmjLayer {
  name: string;
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
    console.log('no office-606.tmj yet (pnpm map:gen) - skipping the scene preview');
    return undefined;
  }
  const tiles = TILE_CATALOG.map((t) => paintTile(t.name));
  const c = new Canvas(tmj.width * TILE, tmj.height * TILE);
  const drawLayer = (name: string): void => {
    tmj.layers
      .find((l) => l.name === name)
      ?.data?.forEach((gid, i) => {
        if (gid > 0) c.blit(tiles[gid - 1]!, (i % tmj.width) * TILE, Math.floor(i / tmj.width) * TILE);
      });
  };
  drawLayer('floor');
  drawLayer('walls');
  drawLayer('furniture');
  const desks = tmj.layers.find((l) => l.name === 'desks')?.objects ?? [];
  const shadow = renderEffectFrame('shadow');
  const shadowSmall = renderEffectFrame('shadowSmall');
  seats.forEach((seat, k) => {
    const d = desks.find((o) => o.name === seat.deskId);
    if (!d) return;
    const prop = (n: string): unknown => d.properties?.find((p) => p.name === n)?.value;
    const sx = Number(prop('seatX')) * TILE;
    const sy = Number(prop('seatY')) * TILE;
    const facing = String(prop('facing')) as AvatarDirection;
    c.blit(shadow, sx + 8, sy + AVATAR_FEET_Y - 9 - 6);
    c.blit(renderAvatarFrame(seat.avatar, facing, k % 3 === 0 ? 'walk' : 'idle', k % 4), sx, sy - 6);
    const px = sx + (facing === 'left' ? -18 : 18);
    const py = sy - 6;
    c.blit(shadowSmall, px + 4, py + 15);
    const petDir: PetDirection = facing === 'left' ? 'right' : 'left';
    c.blit(renderPetFrame(seat.pet.species, petDir, k % 5 === 0 ? 'sleep' : 'idle', k % 4), px, py);
  });
  drawLayer('furniture-top');
  c.blit(renderEffectFrame('sparkle2'), 10 * TILE, 12 * TILE);
  c.blit(renderEffectFrame('heart'), 4 * TILE + 8, 4 * TILE);
  c.blit(renderEffectFrame('zzz'), 7 * TILE, 14 * TILE);
  return c;
}

const sc = scene();
if (sc) {
  save('scene.png', sc, 2);
  save('scene-zoom-left.png', sc.crop(0, 3 * TILE, 12 * TILE, 8 * TILE), 3);
  save('scene-zoom-right.png', sc.crop(12 * TILE, 3 * TILE, 10 * TILE, 8 * TILE), 3);
  save('scene-zoom-bottom.png', sc.crop(0, 12 * TILE, 22 * TILE, 11 * TILE), 2);
}
