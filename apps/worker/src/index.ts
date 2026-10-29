/**
 * ENU Den worker: pg-boss cron jobs (nudge expiry, link state, retention, auth cleanup).
 * No LLM calls here or anywhere server-side — jobs only change statuses and delete old rows.
 */
import { createDb } from '@enu/db';
import { startBoss, stopBoss } from './boss';
import { loadWorkerEnv } from './env';
import { startHeartbeat } from './health';
import { createLogger } from './logger';

const env = loadWorkerEnv();
const logger = createLogger(env);

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

const dbHandle = createDb(env.DATABASE_URL, { max: 4, applicationName: 'enu-den-worker' });

let boss: Awaited<ReturnType<typeof startBoss>>;
try {
  boss = await startBoss({ env, db: dbHandle.db, logger });
} catch (err) {
  logger.fatal({ err }, 'worker failed to start');
  await dbHandle.close().catch(() => undefined);
  process.exit(1);
}

const heartbeat = startHeartbeat({ probe: () => dbHandle.pool.query('select 1'), logger });

let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  heartbeat.stop();
  let code = 0;
  try {
    await stopBoss(boss);
  } catch (err) {
    code = 1;
    logger.error({ err }, 'pg-boss stop failed');
  }
  await dbHandle.close().catch((err: unknown) => {
    code = 1;
    logger.error({ err }, 'db pool close failed');
  });
  logger.info('worker stopped');
  process.exit(code);
}

process.once('SIGINT', (s) => void shutdown(s));
process.once('SIGTERM', (s) => void shutdown(s));
logger.info({ schema: env.PGBOSS_SCHEMA, tz: env.APP_TIMEZONE }, 'worker ready');
