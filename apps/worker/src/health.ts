import { readFile, rename, writeFile } from 'node:fs/promises';
import type { Logger } from 'pino';

/** File the worker touches while healthy; the container healthcheck reads it. */
export const HEARTBEAT_FILE = '/tmp/enu-worker-heartbeat';
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_MAX_AGE_MS = 90_000;

/** True when `content` holds an epoch-ms timestamp younger than `maxAgeMs` (small future skew tolerated). */
export function isHeartbeatFresh(
  content: string | null,
  nowMs: number,
  maxAgeMs = HEARTBEAT_MAX_AGE_MS,
): boolean {
  if (content == null) return false;
  const trimmed = content.trim();
  if (!/^\d{1,16}$/.test(trimmed)) return false;
  const ts = Number(trimmed);
  const age = nowMs - ts;
  return age < maxAgeMs && age > -maxAgeMs;
}

/** Atomically writes the current epoch ms (write tmp + rename, so readers never see a partial file). */
export async function writeHeartbeat(file = HEARTBEAT_FILE, nowMs = Date.now()): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, String(nowMs), 'utf8');
  await rename(tmp, file);
}

export async function checkHeartbeat(
  file = HEARTBEAT_FILE,
  nowMs = Date.now(),
  maxAgeMs = HEARTBEAT_MAX_AGE_MS,
): Promise<boolean> {
  const content = await readFile(file, 'utf8').catch(() => null);
  return isHeartbeatFresh(content, nowMs, maxAgeMs);
}

export interface HeartbeatOptions {
  /** Liveness probe run before each write (e.g. `select 1`); a failure skips the write. */
  probe: () => Promise<unknown>;
  logger: Logger;
  file?: string;
  intervalMs?: number;
}

export interface HeartbeatHandle {
  /** Resolves after the first beat attempt (successful or not). */
  ready: Promise<void>;
  stop: () => void;
}

/** Writes the heartbeat immediately and then every `intervalMs` while the probe succeeds. */
export function startHeartbeat(opts: HeartbeatOptions): HeartbeatHandle {
  const file = opts.file ?? HEARTBEAT_FILE;
  let running = false;
  const beat = async () => {
    if (running) return;
    running = true;
    try {
      await opts.probe();
      await writeHeartbeat(file);
    } catch (err) {
      opts.logger.warn({ err }, 'heartbeat skipped');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void beat(), opts.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return { ready: beat(), stop: () => clearInterval(timer) };
}
