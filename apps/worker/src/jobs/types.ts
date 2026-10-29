import type { Db } from '@enu/db';
import type { WorkerEnv } from '../env';

export const JOB_NAMES = ['nudges.expire', 'claude.link-state', 'retention.purge', 'auth.cleanup'] as const;
export type JobName = (typeof JOB_NAMES)[number];

/**
 * A job is a plain async function of (db, now, env) returning a JSON-serialisable summary
 * (counts only — never message bodies or Claude-written text). pg-boss stores it as the job output.
 */
export type JobRunner<S extends object = object> = (db: Db, now: Date, env: WorkerEnv) => Promise<S>;

export interface JobDefinition<S extends object = object> {
  name: JobName;
  /** 5-field cron, evaluated in `env.APP_TIMEZONE`. */
  cron: string;
  description: string;
  /** How long one run may stay active before pg-boss expires (and retries) it. */
  expireInSeconds: number;
  retryLimit: number;
  /** What to do about occurrences missed while no worker was running. */
  missed: 'skip' | 'once';
  run: JobRunner<S>;
}

/** Safety valve for batch loops (5000 x 10000 = 50M rows per category per run). */
const MAX_BATCHES = 10_000;

/**
 * Repeats `runBatch(limit)` until it affects fewer than `limit` rows. Each batch is its own
 * statement (autocommit), so row locks are held only briefly.
 */
export async function inBatches(batchSize: number, runBatch: (limit: number) => Promise<number>): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error(`invalid batch size ${batchSize}`);
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await runBatch(batchSize);
    total += n;
    if (n < batchSize) break;
  }
  return total;
}

/** `rowCount` of a node-postgres result (null for statements that do not report one). */
export const affected = (r: { rowCount: number | null }): number => r.rowCount ?? 0;
