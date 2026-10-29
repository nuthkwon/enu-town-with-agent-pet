import { loadEnv, workerEnvSchema, type WorkerEnv } from '@enu/shared/env';

export type { WorkerEnv };

/** Parses the worker env (throws with a readable list of problems so the process refuses to boot). */
export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return loadEnv(workerEnvSchema, source);
}
