/**
 * Migration entry for the compose `migrate` service: `node dist/migrate.mjs`.
 * Uses MIGRATIONS_DIR when set; otherwise `<this file>/../migrations` (i.e. `/app/migrations`
 * next to `/app/dist` in the image, or packages/db/migrations when run from source with tsx).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defaultMigrationsDir, runMigrations } from '@enu/db/migrate';
import { loadWorkerEnv } from './env';
import { createLogger } from './logger';

const env = loadWorkerEnv();
const logger = createLogger(env, 'enu-migrate');
const dir = path.resolve(defaultMigrationsDir());

if (!existsSync(path.join(dir, 'meta', '_journal.json'))) {
  logger.fatal({ dir }, 'migrations folder not found (set MIGRATIONS_DIR)');
  process.exit(1);
}

try {
  await runMigrations(env.DATABASE_URL, dir);
  logger.info({ dir }, 'migrations applied');
  process.exit(0);
} catch (err) {
  logger.fatal({ err, dir }, 'migration failed');
  process.exit(1);
}
