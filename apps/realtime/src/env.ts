import { loadEnv, realtimeEnvSchema, type RealtimeEnv } from '@enu/shared/env';

export type { RealtimeEnv };

/** Parses the realtime env (throws with a readable list of problems so the process refuses to boot). */
export function loadRealtimeEnv(source: Record<string, string | undefined> = process.env): RealtimeEnv {
  return loadEnv(realtimeEnvSchema, source);
}
