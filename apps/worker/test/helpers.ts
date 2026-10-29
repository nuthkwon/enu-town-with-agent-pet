import { TOWN_EVENTS_CHANNEL, parseTownEvent, zonedTimeToUtc, type TownEvent } from '@enu/shared';
import { TEST_DB_URL } from '@enu/testing';
import pg from 'pg';
import { loadWorkerEnv, type WorkerEnv } from '../src/env';

export const TZ = 'Asia/Seoul';
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Wall-clock time in Asia/Seoul -> instant. */
export const kst = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  zonedTimeToUtc(y, mo, d, h, mi, TZ);
export const plus = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

export function testEnv(overrides: Record<string, string> = {}): WorkerEnv {
  return loadWorkerEnv({ NODE_ENV: 'test', DATABASE_URL: TEST_DB_URL, APP_TIMEZONE: TZ, ...overrides });
}

/** Collects town events (NOTIFY) delivered on the shared channel. */
export interface EventListener {
  events: TownEvent[];
  /** Events for the given users only (other suites may share the test database). */
  forUsers: (ids: readonly string[]) => TownEvent[];
  /** Waits until `count` events for `ids` arrived (or `timeoutMs` passed), then returns them. */
  waitFor: (ids: readonly string[], count: number, timeoutMs?: number) => Promise<TownEvent[]>;
  /** Lets in-flight notifications arrive, then returns events for `ids`. */
  settle: (ids: readonly string[], ms?: number) => Promise<TownEvent[]>;
  clear: () => void;
  close: () => Promise<void>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function listenTownEvents(url = TEST_DB_URL): Promise<EventListener> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const events: TownEvent[] = [];
  client.on('notification', (msg) => {
    if (msg.channel !== TOWN_EVENTS_CHANNEL || !msg.payload) return;
    const ev = parseTownEvent(msg.payload);
    if (ev) events.push(ev);
  });
  await client.query(`LISTEN ${TOWN_EVENTS_CHANNEL}`);
  const forUsers = (ids: readonly string[]) =>
    events.filter((e) => 'user_id' in e && ids.includes(e.user_id));
  return {
    events,
    forUsers,
    async waitFor(ids, count, timeoutMs = 2000) {
      const until = Date.now() + timeoutMs;
      while (forUsers(ids).length < count && Date.now() < until) await delay(20);
      return forUsers(ids);
    },
    async settle(ids, ms = 150) {
      await delay(ms);
      return forUsers(ids);
    },
    clear: () => {
      events.length = 0;
    },
    close: () => client.end(),
  };
}
