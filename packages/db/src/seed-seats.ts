import type { Roster } from '@enu/shared';
import { sql } from 'drizzle-orm';
import holidaysFile from '../seed/kr-holidays.json' with { type: 'json' };
import type { Db } from './client';
import { desks, krHolidays } from './schema/app';

/** Korean public holidays bundled with the code (extend yearly). */
export const KR_HOLIDAYS = (holidaysFile as unknown as { holidays: [string, string][] }).holidays;

/** Upserts the seat roster (labels, avatar/pet presets, team/title/role) and the holiday calendar. Keeps assignments. */
export async function seedSeats(db: Db, roster: Roster): Promise<{ seats: number; holidays: number }> {
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
      await tx.insert(krHolidays).values({ date, name }).onConflictDoUpdate({ target: krHolidays.date, set: { name } });
    }
  });
  return { seats: roster.seats.length, holidays: KR_HOLIDAYS.length };
}
