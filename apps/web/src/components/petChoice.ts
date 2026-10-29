import { PET_SPECIES, type PetSpecies } from '@enu/shared';

/** Narrows a stored species id to a known one (unknown ids fall back to the first species). */
export function asSpecies(v: string): PetSpecies {
  return (PET_SPECIES as readonly string[]).includes(v) ? (v as PetSpecies) : PET_SPECIES[0];
}

/**
 * The species a picker starts on: the current one unless a colleague already has it (every member has a
 * different pet), then the first free one in PET_SPECIES order. A taken species is never preselected.
 */
export function pickFreeSpecies(current: string, taken: readonly string[]): PetSpecies {
  const takenSet = new Set(taken);
  const cur = asSpecies(current);
  if (!takenSet.has(cur) && (PET_SPECIES as readonly string[]).includes(current)) return cur;
  return PET_SPECIES.find((s) => !takenSet.has(s)) ?? cur;
}

export function isTaken(species: string, taken: readonly string[]): boolean {
  return taken.includes(species);
}
