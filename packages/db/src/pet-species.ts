import { PET_SPECIES, type PetSpecies } from '@enu/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from './client';
import { pets } from './schema/app';
import { user } from './schema/auth';

/**
 * Every active member's default pet is a different species (further pets reuse species with a tint). Each default
 * species pick (onboarding, profile edit, provisioning, pet edit) takes this lock first and checks `takenPetSpecies`
 * inside the same transaction, so two concurrent picks of one species cannot both win.
 */
export async function lockPetSpecies(tx: DbOrTx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('enu_den_pet_species'))`);
}

/**
 * Default-pet species of active members other than `exceptUserId`, in PET_SPECIES order. A deactivated member's
 * species is free again; unknown species strings are ignored.
 */
export async function takenPetSpecies(db: DbOrTx, exceptUserId: string | null): Promise<PetSpecies[]> {
  const rows = await db
    .selectDistinct({ species: pets.species })
    .from(pets)
    .innerJoin(user, eq(user.id, pets.userId))
    .where(
      and(
        eq(pets.isDefault, true),
        eq(user.status, 'active'),
        exceptUserId === null ? undefined : ne(pets.userId, exceptUserId),
      ),
    );
  const taken = new Set(rows.map((r) => r.species));
  return PET_SPECIES.filter((s) => taken.has(s));
}
