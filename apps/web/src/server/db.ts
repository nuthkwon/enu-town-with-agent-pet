import { createDb, type Db, type DbHandle } from '@enu/db';
import { getEnv } from './env';

/** One pg pool per process (cached on globalThis so dev hot reloads do not leak pools). */
const g = globalThis as unknown as { __enuWebDb?: DbHandle };

export function getDbHandle(): DbHandle {
  g.__enuWebDb ??= createDb(getEnv().DATABASE_URL, { max: 10, applicationName: 'enu-den-web' });
  return g.__enuWebDb;
}

export function getDb(): Db {
  return getDbHandle().db;
}

/** Closes the pool (tests, graceful shutdown). */
export async function closeDb(): Promise<void> {
  const h = g.__enuWebDb;
  g.__enuWebDb = undefined;
  if (h) await h.close();
}
