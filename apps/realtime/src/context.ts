import type { Db } from '@enu/db';
import type { Clock } from './clock';
import type { RealtimeEnv } from './env';
import type { Logger } from './logger';

/**
 * Process-wide dependencies. Colyseus instantiates rooms itself and calls the static `onAuth`
 * without an instance, so the bootstrap (or a test) installs these once before the server starts.
 */
export interface RealtimeContext {
  env: RealtimeEnv;
  db: Db;
  logger: Logger;
  clock: Clock;
}

let current: RealtimeContext | null = null;

export function setRealtimeContext(ctx: RealtimeContext): void {
  current = ctx;
}

export function getRealtimeContext(): RealtimeContext {
  if (!current) throw new Error('realtime context is not initialised (call setRealtimeContext first)');
  return current;
}
