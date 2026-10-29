import { PET_SPECIES, PET_TINTS, type PetSpecies, type PetTint } from '@enu/shared';
import { SPRITE_PATHS } from '@/game/spriteSpec';

/**
 * Browser-safe pet sheet keys: `pt-{species}-{tint}` (town sheet) and `pc-{species}-{tint}` (companion sheet).
 * Base colours are committed static files; tints are rendered by /api/sprites/pet/[key].
 */

export type PetSheetKind = 'pt' | 'pc';

export interface PetSheetRef {
  kind: PetSheetKind;
  species: PetSpecies;
  tint: PetTint;
}

export function petSheetKey(ref: PetSheetRef): string {
  return `${ref.kind}-${ref.species}-${ref.tint}`;
}

/** Strict parse: only keys that round-trip exactly through `petSheetKey`. */
export function parsePetKey(key: string): PetSheetRef | null {
  if (key.length > 40) return null;
  const parts = key.split('-');
  if (parts.length !== 3) return null;
  const [kind, species, tint] = parts as [string, string, string];
  if (kind !== 'pt' && kind !== 'pc') return null;
  if (!(PET_SPECIES as readonly string[]).includes(species)) return null;
  if (!(PET_TINTS as readonly string[]).includes(tint)) return null;
  const ref: PetSheetRef = { kind, species: species as PetSpecies, tint: tint as PetTint };
  return petSheetKey(ref) === key ? ref : null;
}

/** The town sheet of a pet look (static file for the base look). */
export function petSheetUrl(species: PetSpecies, tint: PetTint = 'base'): string {
  return tint === 'base'
    ? SPRITE_PATHS.pet(species)
    : SPRITE_PATHS.petApi(petSheetKey({ kind: 'pt', species, tint }));
}

/** The companion sheet of a pet look (static file for the base look). */
export function companionSheetUrl(species: PetSpecies, tint: PetTint = 'base'): string {
  return tint === 'base'
    ? SPRITE_PATHS.companion(species)
    : SPRITE_PATHS.petApi(petSheetKey({ kind: 'pc', species, tint }));
}
