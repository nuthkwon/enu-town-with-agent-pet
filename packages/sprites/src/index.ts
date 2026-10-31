/**
 * @enu/sprites — original pastel "magical-girl" pixel art defined in code.
 *
 * `render*Sheet` / `renderTileset` / `renderEffects` return PNG buffers (Node: build script, API
 * routes). `render*Image` return raw RGBA canvases (no PNG/zlib) for in-browser texture creation.
 * All functions are pure and deterministic: same input -> identical bytes.
 */
import type { AvatarPreset, PetSpecies, PetTint } from '@enu/shared';
import { renderAvatarImage } from './avatar';
import { renderCompanionImage } from './companion';
import { renderEffectsImage } from './effects';
import { renderPetImage } from './pet';
import { encodePng } from './png';
import { renderTilesetImage } from './tileset';

export * from './spec';
export { Canvas } from './draw/canvas';
export type { RGBA } from './draw/color';
export { encodePng, decodePng } from './png';
export { renderAvatarImage, renderAvatarFrame } from './avatar';
export { renderPetImage, renderPetFrame } from './pet';
export { renderCompanionImage, renderCompanionFrame } from './companion';
export { PET_TINT_COLOR, tintColors } from './variants';
export { renderTilesetImage } from './tileset';
export { renderEffectsImage, renderEffectFrame } from './effects';
export { paintTile } from './parts/tiles';
export { AVATAR_SWATCHES } from './palette';

/** Avatar sheet PNG: 14 columns (idle 4, walk 6, cast 4) x 4 rows (down, left, right, up) of 32x32. */
export function renderAvatarSheet(preset: AvatarPreset): Buffer {
  return encodePng(renderAvatarImage(preset));
}

/** Pet sheet PNG: 12 columns (idle 4, hop 6, sleep 2) x 2 rows (left, right) of 24x24. */
export function renderPetSheet(species: PetSpecies, opts?: { sleeping?: boolean; tint?: PetTint }): Buffer {
  return encodePng(renderPetImage(species, opts));
}

/** Companion sheet PNG: one row of 26 frames of 24x24 (COMPANION_EXPRESSIONS). */
export function renderCompanionSheet(species: PetSpecies, tint: PetTint = 'base'): Buffer {
  return encodePng(renderCompanionImage(species, tint));
}

/** `office-tiles.png`: one 32x32 tile per TILE_CATALOG entry, TILESET_COLUMNS per row. */
export function renderTileset(): Buffer {
  return encodePng(renderTilesetImage());
}

/** `effects.png`: 16x16 icons laid out per EFFECT_FRAMES. */
export function renderEffects(): Buffer {
  return encodePng(renderEffectsImage());
}
