import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/** Default migrations folder next to this package (override with MIGRATIONS_DIR in bundles/containers). */
export function defaultMigrationsDir(): string {
  return (
    process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations')
  );
}

export async function runMigrations(
  connectionString: string,
  migrationsFolder = defaultMigrationsDir(),
): Promise<void> {
  const { db, close } = createDb(connectionString, { max: 1, applicationName: 'enu-den-migrate' });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
