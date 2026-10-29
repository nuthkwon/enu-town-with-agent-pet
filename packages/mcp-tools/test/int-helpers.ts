import { auditEvents, chatMessages, claudeLinks, newId, type Db, type DbHandle } from '@enu/db';
import { TOWN_EVENTS_CHANNEL, parseTownEvent, type TownEvent } from '@enu/shared';
import { FakeClock } from '@enu/testing';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { and, eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { SlidingWindowRateLimiter, type McpDeps } from '../src/index';
import { connectClient, createTestHandler, testDeps, type Mode } from './harness';

export const PUBLIC_URL = 'https://town.example';
export const TZ = 'Asia/Seoul';
/** Thursday 2026-10-29 14:00 KST (a business day, inside work hours). */
export const THU_14 = '2026-10-29T05:00:00.000Z';
/** Saturday 2026-10-31 11:00 KST. */
export const SAT_11 = '2026-10-31T02:00:00.000Z';
/** Thursday 2026-10-29 21:00 KST. */
export const THU_21 = '2026-10-29T12:00:00.000Z';

export interface Harness {
  clock: FakeClock;
  deps: McpDeps;
  handler: McpHttpHandler;
  /** Connects a client for (userId, clientId) with the given negotiation mode. */
  client: (userId: string, clientId?: string) => ReturnType<typeof connectClient>;
  close: () => Promise<void>;
}

export function makeHarness(db: Db, mode: Mode, startAt = THU_14): Harness {
  const clock = new FakeClock(new Date(startAt));
  const deps: McpDeps = testDeps(db, {
    publicUrl: PUBLIC_URL,
    now: clock.now,
    rateLimiter: new SlidingWindowRateLimiter(),
    onError: (e) => {
      throw e instanceof Error ? e : new Error(String(e));
    },
  });
  const handler = createTestHandler(deps);
  const clients: Awaited<ReturnType<typeof connectClient>>[] = [];
  return {
    clock,
    deps,
    handler,
    client: async (userId, clientId = 'https://claude.ai/oauth/client') => {
      const c = await connectClient(handler, { userId, clientId }, mode);
      clients.push(c);
      return c;
    },
    close: async () => {
      for (const c of clients) await c.close();
      await handler.close();
    },
  };
}

export interface Listener {
  events: TownEvent[];
  /** Events for one user (other suites may share the database). */
  forUser: (userId: string) => TownEvent[];
  waitFor: (pred: (events: TownEvent[]) => boolean) => Promise<void>;
  stop: () => Promise<void>;
}

/** LISTENs on the town events channel with a dedicated pool connection. */
export async function listen(handle: DbHandle): Promise<Listener> {
  const conn = await handle.pool.connect();
  const events: TownEvent[] = [];
  const onNotification = (msg: { channel: string; payload?: string | undefined }) => {
    if (msg.channel !== TOWN_EVENTS_CHANNEL || !msg.payload) return;
    const ev = parseTownEvent(msg.payload);
    if (ev) events.push(ev);
  };
  conn.on('notification', onNotification);
  await conn.query(`LISTEN ${TOWN_EVENTS_CHANNEL}`);
  const forUser = (userId: string) => events.filter((e) => 'user_id' in e && e.user_id === userId);
  return {
    events,
    forUser,
    waitFor: (pred) => vi.waitFor(() => {
      if (!pred(events)) throw new Error(`events so far: ${JSON.stringify(events)}`);
    }, { timeout: 3000, interval: 20 }),
    stop: async () => {
      await conn.query('UNLISTEN *');
      conn.off('notification', onNotification);
      conn.release();
    },
  };
}

/** Short pause so that any (unexpected) NOTIFY would have arrived. */
export const settle = () => new Promise((r) => setTimeout(r, 150));

export async function insertDm(
  db: Db,
  from: string,
  to: string,
  body: string,
  createdAt: Date,
  extra: { deletedAt?: Date } = {},
): Promise<string> {
  const [low, high] = [from, to].sort() as [string, string];
  const id = newId();
  await db.insert(chatMessages).values({
    id,
    kind: 'dm',
    senderId: from,
    dmLow: low,
    dmHigh: high,
    body,
    clientMsgId: newId(),
    createdAt,
    deletedAt: extra.deletedAt ?? null,
  });
  return id;
}

export async function linkRow(db: Db, userId: string, clientId: string) {
  const [row] = await db
    .select()
    .from(claudeLinks)
    .where(and(eq(claudeLinks.userId, userId), eq(claudeLinks.clientId, clientId)));
  return row;
}

export async function auditFor(db: Db, userId: string) {
  return db.select().from(auditEvents).where(eq(auditEvents.actorUserId, userId)).orderBy(auditEvents.id);
}
