import path from 'node:path';
import { matchMaker } from '@colyseus/core';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import config from '@colyseus/tools';
import { Client, type Room } from '@colyseus/sdk';
import {
  activityReports,
  desks,
  newId,
  workLogs,
  type Db,
  type DbHandle,
  type ScheduleBlockRow,
} from '@enu/db';
import { PROTOCOL_VERSION } from '@enu/protocol';
import {
  OFFICE_ROOM_NAME,
  PRIVACY_NOTICE_VERSION,
  REALTIME_TICKET_AUDIENCE,
  localDateKey,
  zonedTimeToUtc,
  type NowKind,
  type ScheduleKind,
} from '@enu/shared';
import { TEST_DB_URL, createTestUser, setupTestDb, truncateAll, type TestUserInput } from '@enu/testing';
import { SignJWT } from 'jose';
import type { Clock } from '../../src/clock';
import { setRealtimeContext } from '../../src/context';
import { loadRealtimeEnv, type RealtimeEnv } from '../../src/env';
import { createLogger } from '../../src/logger';
import type { OfficeRoom } from '../../src/rooms/OfficeRoom';
import {
  createTransport,
  installCorsPolicy,
  installMatchmakePolicy,
  registerHttpRoutes,
  rooms,
} from '../../src/server';

export const SECRET = 'test-ticket-secret-0123456789abcdef0123';
export const ORIGIN = 'http://localhost:3000';
export const MAPS_DIR = path.resolve(import.meta.dirname, '../../../web/public/assets/maps');
export const TZ = 'Asia/Seoul';
export const kst = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  zonedTimeToUtc(y, mo, d, h, mi, TZ);
/** A Wednesday, inside work hours (no quiet time) and office hours. */
export const WORK_TIME = kst(2026, 10, 28, 10, 0);
/** The same Wednesday after office hours. */
export const AFTER_HOURS = kst(2026, 10, 28, 20, 0);

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
    installMatchmakePolicy();
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

/**
 * Joins office-606 as `userId` with a fresh ticket (each identity needs its own SDK client). The join
 * options carry the current protocol version unless `options` replaces them.
 */
export async function joinAs(
  h: Harness,
  userId: string,
  opts: {
    origin?: string | null;
    ticket?: string;
    options?: Record<string, unknown>;
    /** Collects every raw frame this client receives (from the first state on). */
    frames?: Uint8Array[];
  } = {},
): Promise<Joined> {
  const client = sdkClient(h.port, opts.origin === undefined ? ORIGIN : opts.origin);
  client.auth.token = opts.ticket ?? (await mintTicket(userId));
  // Clients may only join (installMatchmakePolicy): the room is created server-side, as index.ts does.
  await officeRoom(h);
  const room = await client.join(OFFICE_ROOM_NAME, opts.options ?? { protocol: PROTOCOL_VERSION });
  const frames = opts.frames;
  if (frames) {
    const events = room.connection.events;
    const original = events.onmessage;
    events.onmessage = (ev: { data: ArrayBuffer }) => {
      frames.push(new Uint8Array(ev.data));
      return original?.(ev);
    };
  }
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

/** The office room, created (with nobody connected) when it does not exist yet. */
export async function officeRoom(h: Harness): Promise<OfficeRoom> {
  const [listing] = await matchMaker.query({ name: OFFICE_ROOM_NAME });
  if (listing) return h.colyseus.getRoomById(listing.roomId) as unknown as OfficeRoom;
  return (await h.colyseus.createRoom(OFFICE_ROOM_NAME, {})) as unknown as OfficeRoom;
}

/** Picks up users created in the DB after the room exists (the room's own 5-minute resync). */
export async function syncRoster(h: Harness): Promise<OfficeRoom> {
  const room = await officeRoom(h);
  await room.resyncAll();
  return room;
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

/**
 * Creates a roster member (user + profile, onboarded, current privacy notice accepted), optionally at
 * a desk. Pass `onboarded: false` or `noticeVersion: null` for people the ticket check must refuse.
 */
export async function makeUser(
  h: Harness,
  input: TestUserInput & { deskId?: string } = {},
): Promise<{ id: string; email: string; name: string }> {
  const { deskId, ...rest } = input;
  const u = await createTestUser(h.db, {
    ...rest,
    noticeVersion: rest.noticeVersion === undefined ? PRIVACY_NOTICE_VERSION : rest.noticeVersion,
  });
  if (deskId) {
    await h.db
      .insert(desks)
      .values({ deskId, userId: u.id })
      .onConflictDoUpdate({ target: desks.deskId, set: { userId: u.id } });
  }
  return u;
}

/** A 32-hex keyed ref hash stand-in (the real one is an HMAC; the room only compares them). */
export const refHash = (label: string): string => label.padEnd(32, '0').slice(0, 32);

export interface ReportInput {
  now?: { kind: NowKind; refHash?: string | null; until: Date } | null;
  schedule?: { start: Date; end: Date; kind: ScheduleKind; refHash?: string | null }[];
}

/** Writes today's (`h.clock`, Asia/Seoul) activity report row, as post_activity would. */
export async function setReport(h: Harness, userId: string, r: ReportInput): Promise<void> {
  const schedule: ScheduleBlockRow[] = (r.schedule ?? []).map((b) => ({
    start_at: b.start.toISOString(),
    end_at: b.end.toISOString(),
    kind: b.kind,
    ref_hash: b.refHash ?? null,
  }));
  const values = {
    nowKind: r.now?.kind ?? null,
    nowRefHash: r.now?.refHash ?? null,
    nowUntil: r.now?.until ?? null,
    schedule,
    source: 'cowork_scheduled',
  };
  await h.db
    .insert(activityReports)
    .values({ userId, periodKey: localDateKey(h.clock.now(), TZ), ...values })
    .onConflictDoUpdate({ target: [activityReports.userId, activityReports.periodKey], set: values });
}

/** Writes today's work log (task statuses matter; titles are never read by the room). */
export async function setWorkLog(
  h: Harness,
  userId: string,
  log: { visibility?: 'private' | 'company'; statuses?: string[]; deletedAt?: Date | null } = {},
): Promise<string> {
  const now = h.clock.now();
  const id = newId();
  await h.db.insert(workLogs).values({
    id,
    userId,
    periodKey: localDateKey(now, TZ),
    periodStart: new Date(now.getTime() - 3_600_000),
    periodEnd: now,
    summary: '오늘 한 일',
    tasks: (log.statuses ?? ['in_progress']).map((status, i) => ({ title: `작업 ${i + 1}`, status })),
    visibility: log.visibility ?? 'company',
    source: 'cowork_scheduled',
    claudeWrittenAt: now,
    deletedAt: log.deletedAt ?? null,
  });
  return id;
}
