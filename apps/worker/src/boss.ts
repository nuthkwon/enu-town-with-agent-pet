import type { Db } from '@enu/db';
import { PgBoss, type Job } from 'pg-boss';
import type { Logger } from 'pino';
import type { WorkerEnv } from './env';
import { JOBS, type JobDefinition } from './jobs/index';

/**
 * `exclusive`: at most one job per queue is queued *or* active, cluster-wide. A cron tick that
 * fires while the previous run is still going is dropped instead of piling up behind it.
 */
export const QUEUE_POLICY = 'exclusive' as const;
/** Completed/failed job rows are kept this long in the pg-boss schema. */
export const JOB_RECORD_RETENTION_SECONDS = 3 * 24 * 60 * 60;
export const RETRY_DELAY_SECONDS = 60;

export interface BossDeps {
  env: WorkerEnv;
  db: Db;
  logger: Logger;
  /** Defaults to the registration table. */
  jobs?: readonly JobDefinition[];
  /** Source of the `now` passed to jobs (tests inject a fixed clock). */
  clock?: () => Date;
  /** Worker polling interval (pg-boss default 2 s). */
  pollingIntervalSeconds?: number;
}

export function createBoss(env: Pick<WorkerEnv, 'DATABASE_URL' | 'PGBOSS_SCHEMA'>, logger: Logger): PgBoss {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PGBOSS_SCHEMA,
    max: 4,
    application_name: 'enu-town-worker-boss',
  });
  // An EventEmitter 'error' without a listener would crash the process.
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  boss.on('warning', (warning) => logger.warn({ warning }, 'pg-boss warning'));
  return boss;
}

/** Runs one job with logging; errors are rethrown so pg-boss records the failure and retries. */
export async function runJob(def: JobDefinition, deps: Pick<BossDeps, 'db' | 'env' | 'logger' | 'clock'>, jobId?: string): Promise<object> {
  const now = (deps.clock ?? (() => new Date()))();
  const log = deps.logger.child({ job: def.name, jobId });
  const started = Date.now();
  try {
    const summary = await def.run(deps.db, now, deps.env);
    log.info({ summary, ms: Date.now() - started }, 'job done');
    return summary;
  } catch (err) {
    log.error({ err, ms: Date.now() - started }, 'job failed');
    throw err;
  }
}

/** Creates each queue (idempotent), (re)schedules it in APP_TIMEZONE and starts its worker. */
export async function registerJobs(boss: PgBoss, deps: BossDeps): Promise<void> {
  const jobs = deps.jobs ?? JOBS;
  for (const def of jobs) {
    await boss.createQueue(def.name, {
      policy: QUEUE_POLICY,
      expireInSeconds: def.expireInSeconds,
      retryLimit: def.retryLimit,
      retryDelay: RETRY_DELAY_SECONDS,
      deleteAfterSeconds: JOB_RECORD_RETENTION_SECONDS,
    });
    // Existing queues keep their creation options; keep the tunables in sync on every boot.
    await boss.updateQueue(def.name, {
      expireInSeconds: def.expireInSeconds,
      retryLimit: def.retryLimit,
      retryDelay: RETRY_DELAY_SECONDS,
      deleteAfterSeconds: JOB_RECORD_RETENTION_SECONDS,
    });
    await boss.schedule(def.name, def.cron, null, { tz: deps.env.APP_TIMEZONE, missed: def.missed });
    await boss.work(
      def.name,
      { batchSize: 1, pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 },
      async (batch: Job<object>[]) => {
        let last: object = {};
        for (const job of batch) last = await runJob(def, deps, job.id);
        return last;
      },
    );
  }

  // Drop schedules of jobs that were renamed or removed from the table.
  const known = new Set<string>(jobs.map((j) => j.name));
  for (const s of await boss.getSchedules()) {
    if (!known.has(s.name)) {
      await boss.unschedule(s.name, s.key);
      deps.logger.info({ job: s.name }, 'removed stale schedule');
    }
  }
}

/** Starts pg-boss (installing/migrating its schema), then registers every job. */
export async function startBoss(deps: BossDeps): Promise<PgBoss> {
  const boss = createBoss(deps.env, deps.logger);
  await boss.start({ attempts: 5 });
  try {
    await registerJobs(boss, deps);
  } catch (err) {
    await boss.stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
    throw err;
  }
  deps.logger.info(
    { jobs: (deps.jobs ?? JOBS).map((j) => `${j.name} @ ${j.cron}`), tz: deps.env.APP_TIMEZONE },
    'pg-boss started',
  );
  return boss;
}

/** Graceful stop: waits (up to `timeoutMs`) for active jobs, then closes pg-boss's pool. */
export async function stopBoss(boss: PgBoss, timeoutMs = 30_000): Promise<void> {
  await boss.stop({ graceful: true, timeout: timeoutMs, close: true });
}
