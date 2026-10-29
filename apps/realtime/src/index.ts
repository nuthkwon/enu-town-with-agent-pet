/**
 * ENU Town realtime server (Colyseus 0.18): room `office-606` with the director (server-placed
 * avatars; nobody steers one), pets, chat and DMs, and owner-only pet bubbles. Reached through Caddy at `/colyseus` (prefix stripped), so it serves at root.
 * No LLM calls here: pet bubbles only ever show text the owner's own Claude wrote.
 */
import { matchMaker } from '@colyseus/core';
import { createDb } from '@enu/db';
import { OFFICE_ROOM_NAME } from '@enu/shared';
import { systemClock } from './clock';
import { setRealtimeContext } from './context';
import { loadRealtimeEnv } from './env';
import { createLogger } from './logger';
import { createRealtimeServer } from './server';

const env = loadRealtimeEnv();
const logger = createLogger(env);

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

if (env.NODE_ENV === 'production' && env.ALLOWED_ORIGINS.length === 0) {
  logger.fatal('ALLOWED_ORIGINS must list the public web origin in production');
  process.exit(1);
}
if (env.NUDGE_JOIN_DELAY_MS !== undefined || env.NUDGE_MIN_INTERVAL_MIN !== undefined) {
  logger.warn(
    { joinDelayMs: env.NUDGE_JOIN_DELAY_MS, minIntervalMin: env.NUDGE_MIN_INTERVAL_MIN },
    'nudge timing overrides are set (meant for e2e/tests only)',
  );
}

const dbHandle = createDb(env.DATABASE_URL, { max: 8, applicationName: 'enu-town-realtime' });
setRealtimeContext({ env, db: dbHandle.db, logger, clock: systemClock });

const server = createRealtimeServer({ env, logger, pool: dbHandle.pool });
server.onShutdown(async () => {
  await dbHandle.close().catch((err: unknown) => logger.error({ err }, 'db pool close failed'));
  logger.info('realtime stopped');
});

try {
  await server.listen(env.REALTIME_PORT);
  // One persistent room (autoDispose off): create it now so LISTEN runs before the first join.
  await matchMaker.createRoom(OFFICE_ROOM_NAME, {});
} catch (err) {
  logger.fatal({ err }, 'realtime failed to start');
  await dbHandle.close().catch(() => undefined);
  process.exit(1);
}

logger.info({ port: env.REALTIME_PORT, origins: env.ALLOWED_ORIGINS }, 'realtime ready');
