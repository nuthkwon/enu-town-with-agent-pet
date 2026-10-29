import { safeErr } from '@enu/db';
import { pino, type Logger } from 'pino';
import type { WorkerEnv } from './env';

export type { Logger };

/**
 * JSON logs to stdout (compose collects them). Never log message bodies or Claude-written text: errors go
 * through `safeErr` (the `err` key), since a failed Drizzle query carries every bound value in its message.
 */
export function createLogger(env: Pick<WorkerEnv, 'LOG_LEVEL' | 'NODE_ENV'>, name = 'enu-worker'): Logger {
  return pino({
    name,
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: safeErr },
  });
}
