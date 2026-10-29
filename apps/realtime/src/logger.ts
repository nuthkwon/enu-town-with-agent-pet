import { pino, type Logger } from 'pino';
import type { RealtimeEnv } from './env';

export type { Logger };

/**
 * JSON logs to stdout (compose collects them).
 * Never log chat bodies, pet bubble texts (Claude-authored) or tickets.
 */
export function createLogger(
  env: Pick<RealtimeEnv, 'LOG_LEVEL' | 'NODE_ENV'>,
  name = 'enu-realtime',
): Logger {
  return pino({
    name,
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['token', 'ticket', '*.token', '*.ticket', 'text', '*.text', 'body', '*.body'],
      remove: true,
    },
  });
}
