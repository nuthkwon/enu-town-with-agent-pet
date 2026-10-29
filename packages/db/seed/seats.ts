import { createDb } from '../src/client';
import { seedSeats } from '../src/seed-seats';
import { loadRoster } from './roster';

/** Upserts the 14 seats (labels + presets + roles) and the holiday calendar. Keeps assignments. */
const url = process.env.DATABASE_URL ?? 'postgres://enu:enu@127.0.0.1:5432/enu_town_dev';
const { db, close } = createDb(url, { max: 1 });
const { roster, source } = loadRoster();
const r = await seedSeats(db, roster);
console.log(`seeded ${r.seats} seats from ${source} roster and ${r.holidays} holidays`);
await close();
