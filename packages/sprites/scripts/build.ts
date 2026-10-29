/**
 * Writes every generated sprite into the web app's public assets:
 *   apps/web/public/assets/sprites/pets/<species>.png
 *   apps/web/public/assets/sprites/effects.png
 *   apps/web/public/assets/sprites/avatars/<avatarSpriteKey>.png   (DEFAULT_AVATAR + seat presets)
 *   apps/web/public/assets/sprites/manifest.json
 *   apps/web/public/assets/maps/office-606/office-tiles.png
 *
 * Seat presets come from config/seats.example.json and (when present) config/seats.local.json.
 * Only the `avatar` objects are read; names are never printed or written anywhere.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AvatarPreset,
  BODY_TYPES,
  DEFAULT_AVATAR,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  PET_SPECIES,
  SKIN_TONES,
  avatarSpriteKey,
} from '@enu/shared';
import { renderAvatarSheet, renderEffects, renderPetSheet, renderTileset, spriteSpec } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const publicDir = join(repoRoot, 'apps/web/public');
const spritesDir = join(publicDir, 'assets/sprites');
const tilesetPath = join(publicDir, 'assets/maps/office-606/office-tiles.png');

function isPreset(a: unknown): a is AvatarPreset {
  if (!a || typeof a !== 'object') return false;
  const p = a as Record<string, unknown>;
  return (
    (BODY_TYPES as readonly unknown[]).includes(p.body) &&
    (HAIR_STYLES as readonly unknown[]).includes(p.hair) &&
    (HAIR_COLORS as readonly unknown[]).includes(p.hairColor) &&
    (OUTFIT_COLORS as readonly unknown[]).includes(p.outfit) &&
    (SKIN_TONES as readonly unknown[]).includes(p.skin) &&
    typeof (p.wings ?? false) === 'boolean'
  );
}

/** Avatar presets of a seats file (only the `avatar` field of each seat is looked at). */
function seatPresets(file: string): AvatarPreset[] {
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { seats?: { avatar?: unknown }[] };
  const out: AvatarPreset[] = [];
  let skipped = 0;
  for (const seat of raw.seats ?? []) {
    const a = seat.avatar as Record<string, unknown> | undefined;
    const preset = a ? { ...a, wings: a.wings ?? false } : undefined;
    if (isPreset(preset)) out.push(preset);
    else skipped++;
  }
  if (skipped)
    console.warn(`  ${relative(repoRoot, file)}: skipped ${skipped} seat(s) with an invalid avatar preset`);
  return out;
}

function write(file: string, data: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

const started = performance.now();
const files: string[] = [];
const rel = (f: string): string => '/' + relative(publicDir, f).split('\\').join('/');

// pets
for (const species of PET_SPECIES) {
  const f = join(spritesDir, 'pets', `${species}.png`);
  write(f, renderPetSheet(species));
  files.push(rel(f));
}

// effects + tileset
write(join(spritesDir, 'effects.png'), renderEffects());
files.push(rel(join(spritesDir, 'effects.png')));
write(tilesetPath, renderTileset());
files.push(rel(tilesetPath));

// avatars: default + every seat preset (deduplicated by sprite key)
const presets = new Map<string, AvatarPreset>();
for (const p of [
  DEFAULT_AVATAR,
  ...seatPresets(join(repoRoot, 'config/seats.example.json')),
  ...seatPresets(join(repoRoot, 'config/seats.local.json')),
]) {
  presets.set(avatarSpriteKey(p), p);
}
const avatarDir = join(spritesDir, 'avatars');
const avatars: Record<string, string> = {};
for (const [key, preset] of [...presets].sort(([a], [b]) => a.localeCompare(b))) {
  const f = join(avatarDir, `${key}.png`);
  write(f, renderAvatarSheet(preset));
  avatars[key] = rel(f);
  files.push(rel(f));
}

const manifest = {
  generator: '@enu/sprites',
  spec: spriteSpec(),
  pets: Object.fromEntries(PET_SPECIES.map((s) => [s, `/assets/sprites/pets/${s}.png`])),
  effects: '/assets/sprites/effects.png',
  tileset: rel(tilesetPath),
  avatars,
  files: [...files].sort(),
};
write(join(spritesDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `sprites: ${PET_SPECIES.length} pets, ${presets.size} avatars, effects, tileset -> ${relative(repoRoot, publicDir)} ` +
    `(${Math.round(performance.now() - started)} ms)`,
);
