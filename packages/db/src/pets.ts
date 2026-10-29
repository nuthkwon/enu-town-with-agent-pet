import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from './client';
import { newOpaqueId } from './ids';
import { pets } from './schema/app';

export type PetRow = typeof pets.$inferSelect;

/** The owner's default pet (every profile has exactly one from provisioning on). */
export async function defaultPetOf(db: DbOrTx, userId: string): Promise<PetRow | null> {
  const [row] = await db
    .select()
    .from(pets)
    .where(and(eq(pets.userId, userId), eq(pets.isDefault, true)))
    .limit(1);
  return row ?? null;
}

/** Creates the default pet (base look). Callers hold `lockPetSpecies` and chose a free species. */
export async function insertDefaultPet(
  tx: DbOrTx,
  input: { userId: string; name: string; species: string },
): Promise<PetRow> {
  const [row] = await tx
    .insert(pets)
    .values({
      id: newOpaqueId(),
      userId: input.userId,
      name: input.name,
      species: input.species,
      tint: 'base',
      isDefault: true,
      sortOrder: 0,
    })
    .returning();
  return row!;
}

/**
 * Renames or restyles the default pet (onboarding, profile edit), creating it if a legacy profile has none.
 * Callers changing the species hold `lockPetSpecies` and checked that it is free.
 */
export async function updateDefaultPet(
  tx: DbOrTx,
  userId: string,
  change: { name?: string; species?: string },
): Promise<PetRow> {
  const current = await defaultPetOf(tx, userId);
  if (!current) {
    return insertDefaultPet(tx, { userId, name: change.name ?? '펫', species: change.species ?? 'cat' });
  }
  if (change.name === undefined && change.species === undefined) return current;
  const [row] = await tx
    .update(pets)
    .set({
      ...(change.name !== undefined ? { name: change.name } : {}),
      ...(change.species !== undefined ? { species: change.species } : {}),
    })
    .where(eq(pets.id, current.id))
    .returning();
  return row!;
}
