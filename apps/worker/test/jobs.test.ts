import { describe, expect, it } from 'vitest';
import { JOBS, JOB_NAMES, inBatches } from '../src/jobs/index';

describe('job registration table', () => {
  it('registers every job exactly once with a pg-boss compatible name', () => {
    expect(JOBS.map((j) => j.name).sort()).toEqual([...JOB_NAMES].sort());
    for (const j of JOBS) {
      expect(j.name).toMatch(/^[\w.\-/]+$/);
      expect(j.cron.split(' ')).toHaveLength(5);
      expect(typeof j.run).toBe('function');
      expect(j.expireInSeconds).toBeGreaterThan(0);
    }
  });

  it('uses the agreed schedules (local time, APP_TIMEZONE)', () => {
    const cron = Object.fromEntries(JOBS.map((j) => [j.name, j.cron]));
    expect(cron).toEqual({
      'nudges.expire': '*/10 * * * *',
      'claude.link-state': '*/15 * * * *',
      'retention.purge': '17 3 * * *',
      'auth.cleanup': '47 3 * * *',
    });
  });

  it('catches up once on missed daily runs but skips missed frequent ones', () => {
    const missed = Object.fromEntries(JOBS.map((j) => [j.name, j.missed]));
    expect(missed).toEqual({
      'nudges.expire': 'skip',
      'claude.link-state': 'skip',
      'retention.purge': 'once',
      'auth.cleanup': 'once',
    });
  });
});

describe('inBatches', () => {
  it('repeats until a batch comes back short and sums the counts', async () => {
    const seen: number[] = [];
    let left = 7;
    const total = await inBatches(3, async (limit) => {
      seen.push(limit);
      const n = Math.min(limit, left);
      left -= n;
      return n;
    });
    expect(total).toBe(7);
    expect(seen).toEqual([3, 3, 3]);
  });

  it('runs one batch when nothing matches and rejects bad sizes', async () => {
    let calls = 0;
    expect(await inBatches(5000, async () => (calls++, 0))).toBe(0);
    expect(calls).toBe(1);
    await expect(inBatches(0, async () => 0)).rejects.toThrow(/batch size/);
  });
});
