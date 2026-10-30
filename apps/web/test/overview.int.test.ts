import { newOpaqueId, workLogEntries, workLogs, type DbHandle } from '@enu/db';
import { createTestUser } from '@enu/testing';
import {
  APP_TIMEZONE_DEFAULT,
  PRIVACY_NOTICE_VERSION,
  localDateKey,
  type OverviewTodayDto,
  type WorkLogChange,
  type WorkLogFeedDto,
} from '@enu/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as exportRoute from '@/app/api/v1/me/export/route';
import * as workLogRoute from '@/app/api/v1/me/work-logs/[id]/route';
import * as feedRoute from '@/app/api/v1/overview/feed/route';
import * as todayRoute from '@/app/api/v1/overview/today/route';
import { closeDb } from '@/server/db';
import { enforceRateLimit, resetRateLimits } from '@/server/rate-limit';
import { call, devLogin, freshDb, jsonOf } from './helpers';

/** The work overview (ADR 0007): what the feed lists, which times it shows, and what owners' decisions do. */

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
});
afterAll(async () => {
  await h.close();
  await closeDb();
});
beforeEach(async () => {
  await freshDb(h);
  resetRateLimits();
});

const DAY_MS = 86_400_000;
const today = () => localDateKey(new Date(), APP_TIMEZONE_DEFAULT);
const yesterday = () => localDateKey(new Date(Date.now() - DAY_MS), APP_TIMEZONE_DEFAULT);
/** An ISO date-time anywhere in a payload. */
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d\d:/;

type UserInput = Parameters<typeof createTestUser>[1];
const author = (input: UserInput = {}) =>
  createTestUser(h.db, { noticeVersion: PRIVACY_NOTICE_VERSION, shareActivity: true, ...input });

async function viewer(input: UserInput = {}) {
  const u = await author(input);
  return { ...u, cookie: (await devLogin(u.email)).cookie };
}

async function logOf(userId: string, over: Partial<typeof workLogs.$inferInsert> = {}): Promise<string> {
  const id = newOpaqueId();
  const now = new Date();
  await h.db.insert(workLogs).values({
    id,
    userId,
    periodKey: today(),
    periodStart: now,
    periodEnd: now,
    summary: '오늘의 요약',
    tasks: [{ title: 'TARA 갱신', status: 'in_progress' }],
    blockers: ['공급사 회신 대기'],
    visibility: 'company',
    source: 'cowork_scheduled',
    claudeWrittenAt: now,
    ...over,
  });
  return id;
}

let seq = 0;
async function entryOf(
  logId: string,
  userId: string,
  over: Partial<typeof workLogEntries.$inferInsert> = {},
  changes: WorkLogChange[] = [{ type: 'summary', text: `요약 ${++seq}` }],
) {
  await h.db.insert(workLogEntries).values({
    id: newOpaqueId(),
    logId,
    userId,
    dayKey: today(),
    seq: ++seq,
    writtenAt: new Date(),
    inOfficeHours: true,
    kind: 'updated',
    changes,
    ...over,
  });
}

async function feed(cookie: string, day?: string) {
  const res = await call(feedRoute.GET, `/api/v1/overview/feed${day ? `?day=${day}` : ''}`, { cookie });
  const raw = await res.text();
  expect(res.status, raw).toBe(200);
  return { body: JSON.parse(raw) as WorkLogFeedDto, raw, res };
}

describe('the work feed', () => {
  it("lists today's office-hours writes of sharers with HH:MM and merges everything else per person", async () => {
    const me = await viewer();
    const sharer = await author({ name: '공유함' });
    const quiet = await author({ name: '공유안함', shareActivity: false });
    const late = await author({ name: '늦게씀' });
    const sharerLog = await logOf(sharer.id);
    await entryOf(sharerLog, sharer.id, { kind: 'created' });
    await entryOf(sharerLog, sharer.id);
    const quietLog = await logOf(quiet.id);
    await entryOf(quietLog, quiet.id, {}, [{ type: 'task_added', title: '심사 증적', status: 'planned' }]);
    await entryOf(quietLog, quiet.id, {}, [
      { type: 'task_status', title: '심사 증적', from: 'planned', to: 'in_progress' },
    ]);
    const lateLog = await logOf(late.id);
    await entryOf(lateLog, late.id, { inOfficeHours: false });

    const { body, raw } = await feed(me.cookie);
    expect(body).toMatchObject({ day: today(), isToday: true, nextDay: null, prevDay: yesterday() });
    const entries = body.items.filter((i) => i.form === 'entry');
    expect(entries.map((i) => i.userId)).toEqual([sharer.id, sharer.id]);
    for (const e of entries) expect(e.time).toMatch(/^\d\d:\d\d$/);
    const digests = body.items.filter((i) => i.form === 'digest');
    expect(digests.map((i) => [i.userId, i.time])).toEqual(
      expect.arrayContaining([
        [quiet.id, null],
        [late.id, null],
      ]),
    );
    expect(digests).toHaveLength(2);
    expect(digests.find((d) => d.userId === quiet.id)?.changes).toEqual([
      { type: 'task_added', title: '심사 증적', status: 'in_progress' },
    ]);
    // Nothing that carries time, order or counts leaves the server.
    expect(raw).not.toMatch(ISO_TIME);
    for (const key of ['seq', 'writtenAt', 'written_at', 'source', 'inOfficeHours'])
      expect(raw).not.toContain(key);
    for (const e of entries) expect(e.id.charAt(14)).toBe('4');
  });

  it('lists only company, undeleted, unedited logs of active authors who accepted the current notice', async () => {
    const me = await viewer();
    const cases = {
      ok: await author({ name: '보임' }),
      privateLog: await author({ name: '비공개' }),
      deleted: await author({ name: '삭제' }),
      edited: await author({ name: '본인수정' }),
      inactive: await author({ name: '비활성', status: 'deactivated' }),
      oldNotice: await author({ name: '옛고지', noticeVersion: '2020-01' }),
    };
    const over: Record<keyof typeof cases, Partial<typeof workLogs.$inferInsert>> = {
      ok: {},
      privateLog: { visibility: 'private' },
      deleted: { deletedAt: new Date() },
      edited: { editedByUser: true },
      inactive: {},
      oldNotice: {},
    };
    for (const [k, u] of Object.entries(cases)) {
      await entryOf(await logOf(u.id, over[k as keyof typeof cases]), u.id);
    }
    const { body } = await feed(me.cookie);
    expect([...new Set(body.items.map((i) => i.userId))]).toEqual([cases.ok.id]);
  });

  it("removes entries on the owner's edit or delete; private hides them and company shows them again", async () => {
    const owner = await viewer();
    const colleague = await viewer({ name: '동료' });
    const logId = await logOf(owner.id);
    await entryOf(logId, owner.id, { kind: 'created' });
    const count = async () =>
      (await h.db.select().from(workLogEntries).where(eq(workLogEntries.logId, logId))).length;
    const patch = (body: unknown) =>
      call(workLogRoute.PATCH, `/api/v1/me/work-logs/${logId}`, {
        method: 'PATCH',
        cookie: owner.cookie,
        params: { id: logId },
        body,
      });

    expect((await patch({ visibility: 'private' })).status).toBe(200);
    expect((await feed(colleague.cookie)).body.items).toEqual([]);
    expect(await count()).toBe(1);
    expect((await patch({ visibility: 'company' })).status).toBe(200);
    expect((await feed(colleague.cookie)).body.items).toHaveLength(1);

    expect((await patch({ summary: '내가 고친 요약' })).status).toBe(200);
    expect(await count()).toBe(0);
    expect((await feed(colleague.cookie)).body.items).toEqual([]);

    const second = await logOf(owner.id, { periodKey: yesterday() });
    await entryOf(second, owner.id, { dayKey: yesterday(), writtenAt: null, kind: 'day' });
    const del = await call(workLogRoute.DELETE, `/api/v1/me/work-logs/${second}`, {
      method: 'DELETE',
      cookie: owner.cookie,
      params: { id: second },
    });
    expect(del.status).toBe(204);
    expect((await h.db.select().from(workLogEntries).where(eq(workLogEntries.logId, second))).length).toBe(0);
  });

  it('shows past days as dates only and moves by calendar days whatever they hold', async () => {
    const me = await viewer();
    const a = await author();
    await entryOf(await logOf(a.id, { periodKey: yesterday() }), a.id, {
      dayKey: yesterday(),
      writtenAt: null,
      kind: 'day',
    });
    const past = (await feed(me.cookie, yesterday())).body;
    expect(past).toMatchObject({ day: yesterday(), isToday: false, nextDay: today() });
    expect(past.items.map((i) => [i.form, i.time])).toEqual([['digest', null]]);
    // An empty day still links on by calendar.
    const before = localDateKey(new Date(Date.now() - 2 * DAY_MS), APP_TIMEZONE_DEFAULT);
    expect((await feed(me.cookie, before)).body).toMatchObject({
      day: before,
      items: [],
      nextDay: yesterday(),
    });
    // Junk and future days fall back to today.
    expect((await feed(me.cookie, 'junk')).body.day).toBe(today());
    expect((await feed(me.cookie, '2999-01-01')).body.day).toBe(today());
  });

  it('needs a session, is never cached and is rate limited', async () => {
    const me = await viewer();
    expect((await call(feedRoute.GET, '/api/v1/overview/feed')).status).toBe(401);
    expect((await feed(me.cookie)).res.headers.get('cache-control')).toContain('no-store');
    // The feed call above used one of the 120 per minute.
    for (let i = 0; i < 119; i++) enforceRateLimit(me.id, 'overviewRead');
    expect((await call(feedRoute.GET, '/api/v1/overview/feed', { cookie: me.cookie })).status).toBe(429);
  });
});

describe("today's status", () => {
  it('lists people with a company log in the feed today, with the time rule for the last update', async () => {
    const me = await viewer();
    const sharer = await author({ name: '공유함' });
    const quiet = await author({ name: '공유안함', shareActivity: false });
    await author({ name: '로그없음' });
    await entryOf(await logOf(sharer.id), sharer.id);
    await entryOf(await logOf(quiet.id, { summary: '조용한 하루' }), quiet.id);

    const res = await call(todayRoute.GET, '/api/v1/overview/today', { cookie: me.cookie });
    expect(res.status).toBe(200);
    const body = await jsonOf<OverviewTodayDto>(res);
    expect(body.day).toBe(today());
    expect(body.members.map((m) => [m.userId, m.lastUpdate === null])).toEqual(
      expect.arrayContaining([
        [sharer.id, false],
        [quiet.id, true],
      ]),
    );
    expect(body.members).toHaveLength(2);
    expect(body.members.find((m) => m.userId === quiet.id)).toMatchObject({
      summary: '조용한 하루',
      tasks: [{ title: 'TARA 갱신', status: 'in_progress' }],
      blockers: ['공급사 회신 대기'],
    });
    expect(JSON.stringify(body)).not.toMatch(ISO_TIME);
  });
});

describe('export', () => {
  it("includes the owner's own feed entries (version 3)", async () => {
    const owner = await viewer();
    const other = await author();
    await entryOf(await logOf(owner.id), owner.id);
    await entryOf(await logOf(other.id), other.id);
    const res = await call(exportRoute.GET, '/api/v1/me/export', { cookie: owner.cookie });
    const body = await jsonOf<{ version: number; workLogEntries: { logId: string }[] }>(res);
    expect(body.version).toBe(3);
    expect(body.workLogEntries).toHaveLength(1);
  });
});
