import { newId, petNudges, type DbHandle } from '@enu/db';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_POLICY, startBoss, stopBoss } from '../src/boss';
import { JOBS } from '../src/jobs/index';
import { DAY, MIN, kst, plus, testEnv } from './helpers';

/** A throw-away pg-boss schema so this smoke test never touches a real installation. */
const SCHEMA = 'pgboss_worker_smoke_test';
const env = testEnv({ PGBOSS_SCHEMA: SCHEMA });
const NOW = kst(2026, 10, 29, 14, 0);

let h: DbHandle;
let boss: PgBoss | null = null;

const dropSchema = () => h.db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  h = await setupTestDb();
  await truncateAll(h.db);
  await dropSchema();
});

afterAll(async () => {
  if (boss) await stopBoss(boss, 5000);
  await dropSchema();
  await h.close();
});

describe('pg-boss registration (smoke)', () => {
  it('creates exclusive queues, schedules every job in APP_TIMEZONE and runs a job end to end', async () => {
    boss = await startBoss({
      env,
      db: h.db,
      logger: pino({ level: 'silent' }),
      clock: () => NOW,
      pollingIntervalSeconds: 0.5,
    });

    const schedules = await boss.getSchedules();
    expect(schedules.map((s) => [s.name, s.cron, s.timezone]).sort()).toEqual(
      JOBS.map((j) => [j.name, j.cron, 'Asia/Seoul']).sort(),
    );
    for (const job of JOBS) {
      const q = await boss.getQueue(job.name);
      expect(q?.policy).toBe(QUEUE_POLICY);
      expect(q?.expireInSeconds).toBe(job.expireInSeconds);
    }

    // A second instance (restart / replica) re-registers idempotently.
    const second = await startBoss({ env, db: h.db, logger: pino({ level: 'silent' }) });
    expect(await second.getSchedules()).toHaveLength(JOBS.length);
    await stopBoss(second, 2000);

    const u = await createTestUser(h.db);
    const nudgeId = newId();
    await h.db.insert(petNudges).values({
      id: nudgeId,
      userId: u.id,
      text: '점심 산책',
      showAfter: plus(NOW, -DAY),
      expiresAt: plus(NOW, -MIN),
    });

    const jobId = await boss.send('nudges.expire', {});
    expect(jobId).toBeTruthy();
    let state: string | undefined;
    let output: unknown;
    for (let i = 0; i < 100 && state !== 'completed' && state !== 'failed'; i++) {
      await delay(100);
      const [job] = await boss.findJobs('nudges.expire', { id: jobId! });
      state = job?.state;
      output = job?.output;
    }
    expect(state).toBe('completed');
    expect(output).toMatchObject({ expired: 1, notifiedUsers: 1 });
    const [row] = await h.db.select().from(petNudges).where(eq(petNudges.id, nudgeId));
    expect(row!.status).toBe('expired');
  });
});
