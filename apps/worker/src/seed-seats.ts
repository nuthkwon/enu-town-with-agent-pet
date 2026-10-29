/**
 * Loads the seat roster into the database inside the container:
 *   docker compose run --rm -v ./config/seats.local.json:/app/config/seats.local.json:ro migrate node dist/seed-seats.mjs
 * The roster holds real names and roles, so it is never baked into an image or committed.
 */
import { readFileSync } from 'node:fs';
import { createDb, safeErr } from '@enu/db';
import { seedSeats } from '@enu/db/seed-seats';
import { rosterSchema } from '@enu/shared';
import { loadWorkerEnv } from './env';
import { createLogger } from './logger';

const env = loadWorkerEnv();
const logger = createLogger(env, 'enu-seed-seats');
const file = process.env.SEATS_FILE ?? '/app/config/seats.local.json';

try {
  const roster = rosterSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
  const result = await seedSeats(db, roster);
  await close();
  logger.info(result, 'seat roster and holidays loaded');
  process.exit(0);
} catch (err) {
  // Never the raw message: a failed insert's Drizzle error lists the roster's real names as params.
  logger.fatal({ err: safeErr(err), file }, 'seeding seats failed');
  process.exit(1);
}
