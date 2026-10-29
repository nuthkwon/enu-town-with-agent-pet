import { safeErr } from '@enu/db';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { RealtimeEnv } from './env';

export type { Logger };

/**
 * JSON logs to stdout (compose collects them).
 * Never log chat bodies, pet bubble texts (Claude-authored) or tickets. Errors always go through
 * `safeErr` (the `err` key): a failed Drizzle query carries every bound value in its message.
 */
export function createLogger(
  env: Pick<RealtimeEnv, 'LOG_LEVEL' | 'NODE_ENV'>,
  name = 'enu-realtime',
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    name,
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: safeErr },
    redact: {
      paths: ['token', 'ticket', '*.token', '*.ticket', 'text', '*.text', 'body', '*.body'],
      remove: true,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
