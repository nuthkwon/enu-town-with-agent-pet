import path from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import config from '@colyseus/tools';
import { Client, type Room } from '@colyseus/sdk';
import { desks, userPresence, type Db, type DbHandle } from '@enu/db';
import { OFFICE_ROOM_NAME, REALTIME_TICKET_AUDIENCE, zonedTimeToUtc } from '@enu/shared';
import { TEST_DB_URL, createTestUser, setupTestDb, truncateAll, type TestUserInput } from '@enu/testing';
import { SignJWT } from 'jose';
import type { Clock } from '../../src/clock';
import { setRealtimeContext } from '../../src/context';
import { loadRealtimeEnv, type RealtimeEnv } from '../../src/env';
import { createLogger } from '../../src/logger';
import type { OfficeRoom } from '../../src/rooms/OfficeRoom';
import { createTransport, installCorsPolicy, registerHttpRoutes, rooms } from '../../src/server';

export const SECRET = 'test-ticket-secret-0123456789abcdef0123';
export const ORIGIN = 'http://localhost:3000';
export const MAPS_DIR = path.resolve(import.meta.dirname, '../../../web/public/assets/maps');
export const TZ = 'Asia/Seoul';
export const kst = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  zonedTimeToUtc(y, mo, d, h, mi, TZ);
/** A Wednesday, inside work hours (no quiet time). */
export const WORK_TIME = kst(2026, 10, 28, 10, 0);

/** Wall clock that runs in real time from a chosen instant (so delays still elapse). */
export class OffsetClock implements Clock {
  private offset = 0;
  constructor(start: Date) {
    this.set(start);
  }
  now = (): Date => new Date(Date.now() + this.offset);
  set(d: Date): void {
    this.offset = d.getTime() - Date.now();
  }
}

export interface Harness {
  colyseus: ColyseusTestServer;
  handle: DbHandle;
  db: Db;
  port: number;
  clock: OffsetClock;
  env: RealtimeEnv;
  /** Re-installs the context with env overrides (takes effect for the next room created). */
  configure(overrides?: Record<string, string>): void;
  reset(overrides?: Record<string, string>): Promise<void>;
  close(): Promise<void>;
}

export async function startHarness(port: number, overrides: Record<string, string> = {}): Promise<Harness> {
  const handle = await setupTestDb();
  const clock = new OffsetClock(WORK_TIME);
  const makeEnv = (o: Record<string, string>) =>
    loadRealtimeEnv({
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB_URL,
      REALTIME_TICKET_SECRET: SECRET,
      MAPS_DIR,
      ALLOWED_ORIGINS: ORIGIN,
      NUDGE_TICK_MS: '100',
      ...o,
    });
  let env = makeEnv(overrides);
  const logger = createLogger(env);
  const configure = (o: Record<string, string> = {}) => {
    env = makeEnv({ ...overrides, ...o });
    h.env = env;
    setRealtimeContext({ env, db: handle.db, logger, clock });
    installCorsPolicy(env.ALLOWED_ORIGINS);
  };
  const h: Harness = {
    colyseus: undefined as unknown as ColyseusTestServer,
    handle,
    db: handle.db,
    port,
    clock,
    env,
    configure,
    async reset(o = {}) {
      await h.colyseus.cleanup();
      await truncateAll(handle.db);
      clock.set(WORK_TIME);
      configure(o);
    },
    async close() {
      await h.colyseus.cleanup().catch(() => undefined);
      await h.colyseus.shutdown().catch(() => undefined);
      await handle.close();
    },
  };
  configure();
  h.colyseus = await boot(
    config({
      rooms,
      initializeTransport: (opts: Record<string, unknown>) => createTransport(env, logger, opts),
      initializeExpress: (app) => registerHttpRoutes(app, { pool: handle.pool }),
    }),
    port,
  );
  await truncateAll(handle.db);
  return h;
}

export async function mintTicket(
  sub: string,
  opts: { secret?: string; aud?: string; iat?: number; exp?: number | string } = {},
): Promise<string> {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience(opts.aud ?? REALTIME_TICKET_AUDIENCE);
  jwt.setIssuedAt(opts.iat);
  jwt.setExpirationTime(opts.exp ?? '60s');
  return jwt.sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

export interface Inbox {
  all: { type: string | number; payload: unknown }[];
  of<T = unknown>(type: string): T[];
  waitFor<T = unknown>(type: string, pred?: (p: T) => boolean, timeoutMs?: number): Promise<T>;
}

export interface Joined {
  room: Room;
  client: Client;
  inbox: Inbox;
  leaveCode: Promise<number>;
}

export function sdkClient(port: number, origin: string | null = ORIGIN): Client {
  return new Client(`ws://127.0.0.1:${port}`, origin ? { headers: { Origin: origin } } : {});
}

/** Joins office-606 as `userId` with a fresh ticket (each identity needs its own SDK client). */
export async function joinAs(
  h: Harness,
  userId: string,
  opts: { origin?: string | null; ticket?: string } = {},
): Promise<Joined> {
  const client = sdkClient(h.port, opts.origin === undefined ? ORIGIN : opts.origin);
  client.auth.token = opts.ticket ?? (await mintTicket(userId));
  const room = await client.joinOrCreate(OFFICE_ROOM_NAME);
  const all: Inbox['all'] = [];
  room.onMessage('*', (type: string | number, payload: unknown) => {
    all.push({ type, payload });
  });
  const leaveCode = new Promise<number>((resolve) => room.onLeave((code: number) => resolve(code)));
  await room.waitForInitialState();
  const inbox: Inbox = {
    all,
    of: <T>(type: string) => all.filter((m) => m.type === type).map((m) => m.payload as T),
    waitFor: <T>(type: string, pred: (p: T) => boolean = () => true, timeoutMs = 4000) =>
      waitFor(() => all.find((m) => m.type === type && pred(m.payload as T))?.payload as T | undefined, {
        timeoutMs,
        message: `message ${type}`,
      }),
  };
  return { room, client, inbox, leaveCode };
}

export function serverRoom(h: Harness, joined: Joined): OfficeRoom {
  return h.colyseus.getRoomById(joined.room.roomId) as unknown as OfficeRoom;
}

export async function waitFor<T>(
  fn: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  opts: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<T> {
  const until = Date.now() + (opts.timeoutMs ?? 4000);
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${opts.message ?? 'condition'}`);
    await sleep(opts.intervalMs ?? 20);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Creates a user + profile, optionally seated at a desk or with a recent position. */
export async function makeUser(
  h: Harness,
  input: TestUserInput & { deskId?: string; at?: { x: number; y: number; dir?: number } } = {},
): Promise<{ id: string; email: string; name: string }> {
  const { deskId, at, ...rest } = input;
  const u = await createTestUser(h.db, rest);
  if (deskId) {
    await h.db
      .insert(desks)
      .values({ deskId, userId: u.id })
      .onConflictDoUpdate({ target: desks.deskId, set: { userId: u.id } });
  }
  if (at) {
    await h.db
      .insert(userPresence)
      .values({ userId: u.id, x: at.x, y: at.y, dir: at.dir ?? 0, zoneId: null, lastSeenAt: new Date() });
  }
  return u;
}

/** Sends steps at the normal client cadence and waits until the server applied them. */
export async function walk(j: Joined, dirs: number[], startSeq = 1, gapMs = 170): Promise<number> {
  let seq = startSeq;
  for (const dir of dirs) {
    j.room.send('step', { seq: seq++, dir });
    await sleep(gapMs);
  }
  return seq;
}
