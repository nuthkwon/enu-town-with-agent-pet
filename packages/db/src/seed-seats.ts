import { PET_SPECIES, type PetSpecies, type Roster } from '@enu/shared';
import { sql } from 'drizzle-orm';
import holidaysFile from '../seed/kr-holidays.json' with { type: 'json' };
import type { Db } from './client';
import { desks, krHolidays } from './schema/app';

/** Korean public holidays bundled with the code (extend yearly). */
export const KR_HOLIDAYS = (holidaysFile as unknown as { holidays: [string, string][] }).holidays;

/** Pet species used by more than one seat, with the desk ids that share it (roster order). */
export function duplicatePetSpecies(roster: Roster): { species: PetSpecies; deskIds: string[] }[] {
  const bySpecies = new Map<PetSpecies, string[]>();
  for (const s of roster.seats)
    bySpecies.set(s.pet.species, [...(bySpecies.get(s.pet.species) ?? []), s.deskId]);
  return [...bySpecies]
    .filter(([, deskIds]) => deskIds.length > 1)
    .map(([species, deskIds]) => ({ species, deskIds }));
}

/**
 * Every employee gets a different-looking pet: throws if two seats share a pet species, naming the
 * desks (and the species still free) so the roster can be fixed. Never mentions names.
 */
export function assertDistinctPetSpecies(roster: Roster): void {
  const dups = duplicatePetSpecies(roster);
  if (!dups.length) return;
  const used = new Set(roster.seats.map((s) => s.pet.species));
  const free = PET_SPECIES.filter((s) => !used.has(s));
  throw new Error(
    `seat roster: every seat needs a different pet species, but ` +
      dups.map((d) => `'${d.species}' is shared by desks ${d.deskIds.join(', ')}`).join('; ') +
      `. Unused species: ${free.join(', ') || '(none)'}.`,
  );
}

/**
 * Upserts the seat roster (labels, avatar/pet presets, team/title/role) and the holiday calendar. Keeps assignments.
 * Refuses a roster in which two seats share a pet species.
 */
export async function seedSeats(db: Db, roster: Roster): Promise<{ seats: number; holidays: number }> {
  assertDistinctPetSpecies(roster);
  await db.transaction(async (tx) => {
    for (const s of roster.seats) {
      const values = {
        labelName: s.name,
        avatar: s.avatar,
        petSpecies: s.pet.species,
        petName: s.pet.name,
        team: s.team ?? null,
        title: s.title ?? null,
        roleNote: s.role ?? null,
      };
      await tx
        .insert(desks)
        .values({ deskId: s.deskId, ...values })
        .onConflictDoUpdate({ target: desks.deskId, set: { ...values, updatedAt: sql`now()` } });
    }
    for (const [date, name] of KR_HOLIDAYS) {
      await tx
        .insert(krHolidays)
        .values({ date, name })
        .onConflictDoUpdate({ target: krHolidays.date, set: { name } });
    }
  });
  return { seats: roster.seats.length, holidays: KR_HOLIDAYS.length };
}
