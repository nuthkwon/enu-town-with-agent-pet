import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HEARTBEAT_MAX_AGE_MS, checkHeartbeat, isHeartbeatFresh, startHeartbeat, writeHeartbeat } from '../src/health';

const NOW = Date.UTC(2026, 9, 29, 5, 0, 0);

describe('isHeartbeatFresh', () => {
  it('accepts timestamps younger than 90 s', () => {
    expect(isHeartbeatFresh(String(NOW - 1000), NOW)).toBe(true);
    expect(isHeartbeatFresh(`${NOW - HEARTBEAT_MAX_AGE_MS + 1}\n`, NOW)).toBe(true);
  });

  it('rejects stale, missing, garbage or far-future values', () => {
    expect(isHeartbeatFresh(String(NOW - HEARTBEAT_MAX_AGE_MS), NOW)).toBe(false);
    expect(isHeartbeatFresh(null, NOW)).toBe(false);
    expect(isHeartbeatFresh('', NOW)).toBe(false);
    expect(isHeartbeatFresh('soon', NOW)).toBe(false);
    expect(isHeartbeatFresh(String(NOW + 10 * 60_000), NOW)).toBe(false);
  });
});

describe('heartbeat file', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'enu-worker-hb-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips through write and check', async () => {
    const file = path.join(dir, 'hb');
    expect(await checkHeartbeat(file, NOW)).toBe(false);
    await writeHeartbeat(file, NOW);
    expect(await checkHeartbeat(file, NOW + 30_000)).toBe(true);
    expect(await checkHeartbeat(file, NOW + 91_000)).toBe(false);
    await writeFile(file, 'garbage');
    expect(await checkHeartbeat(file, NOW)).toBe(false);
  });

  it('writes immediately when the probe succeeds and skips the write when it fails', async () => {
    const logger = pino({ level: 'silent' });
    const ok = path.join(dir, 'ok');
    const hb = startHeartbeat({ probe: async () => 1, logger, file: ok, intervalMs: 60_000 });
    await hb.ready;
    hb.stop();
    expect(await checkHeartbeat(ok)).toBe(true);

    const bad = path.join(dir, 'bad');
    const hb2 = startHeartbeat({
      probe: async () => {
        throw new Error('db down');
      },
      logger,
      file: bad,
      intervalMs: 60_000,
    });
    await hb2.ready;
    hb2.stop();
    expect(await checkHeartbeat(bad)).toBe(false);
  });
});
