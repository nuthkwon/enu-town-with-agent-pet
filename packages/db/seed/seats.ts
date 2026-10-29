import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/client';
import { desks, krHolidays } from '../src/schema/app';
import { loadRoster } from './roster';

/** Upserts the 14 seats (labels + avatar/pet presets) and the holiday calendar. Keeps assignments. */
const url = process.env.DATABASE_URL ?? 'postgres://enu:enu@127.0.0.1:5432/enu_town_dev';
const { db, close } = createDb(url, { max: 1 });
const { roster, source } = loadRoster();

await db.transaction(async (tx) => {
  for (const s of roster.seats) {
    await tx
      .insert(desks)
      .values({ deskId: s.deskId, labelName: s.name, avatar: s.avatar, petSpecies: s.pet.species, petName: s.pet.name })
      .onConflictDoUpdate({
        target: desks.deskId,
        set: { labelName: s.name, avatar: s.avatar, petSpecies: s.pet.species, petName: s.pet.name, updatedAt: sql`now()` },
      });
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { holidays } = JSON.parse(fs.readFileSync(path.join(here, 'kr-holidays.json'), 'utf8')) as {
    holidays: [string, string][];
  };
  for (const [date, name] of holidays) {
    await tx.insert(krHolidays).values({ date, name }).onConflictDoUpdate({ target: krHolidays.date, set: { name } });
  }
});
console.log(`seeded ${roster.seats.length} seats from ${source} roster and the holiday calendar`);
await close();
