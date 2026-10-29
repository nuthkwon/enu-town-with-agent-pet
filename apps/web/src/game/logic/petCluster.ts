/**
 * Several pets per person (protocol 3): the server keeps every extra pet on the default pet's tile with its pose,
 * and the client fans them out by slot, so a person's pets read as one little flock and never cover each other.
 */

/** World-pixel offsets from the default pet (slot 0), by slot. */
export const PET_CLUSTER_OFFSETS: readonly { dx: number; dy: number }[] = [
  { dx: 0, dy: 0 },
  { dx: -13, dy: 3 },
  { dx: 13, dy: 3 },
  { dx: -7, dy: -9 },
  { dx: 7, dy: -9 },
];

export function petClusterOffset(slot: number): { dx: number; dy: number } {
  return PET_CLUSTER_OFFSETS[slot] ?? PET_CLUSTER_OFFSETS[0]!;
}

/**
 * The texture "look" of a pet: the species alone for the base colours (the preloaded sheets), species and tint
 * otherwise (`pt-<look>` from the sprite API).
 */
export function petLook(species: string, tint: string): string {
  return !tint || tint === 'base' ? species : `${species}-${tint}`;
}
