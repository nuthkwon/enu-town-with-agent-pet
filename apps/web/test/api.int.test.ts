import {
  activityReports,
  chatMessages,
  claudeLinks,
  desks,
  newId,
  petNudges,
  pets,
  privacyConsents,
  profiles,
  todos,
  workLogs,
  type DbHandle,
} from '@enu/db';
import { postWorkLog } from '@enu/mcp-tools';
import { createTestUser } from '@enu/testing';
import {
  PET_SPECIES,
  PRIVACY_NOTICE_VERSION,
  REALTIME_TICKET_AUDIENCE,
  TOWN_EVENTS_CHANNEL,
  localDateKey,
  type ChatItemDto,
  type MeDto,
  type Paginated,
  type PersonDto,
  type PetSpecies,
  type ProfileCardDto,
  type TownEvent,
  type WorkLogDto,
} from '@enu/shared';
import { and, eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as adminSeatsRoute from '@/app/api/v1/admin/seats/route';
import * as deactivateRoute from '@/app/api/v1/admin/users/[id]/deactivate/route';
import * as roomRoute from '@/app/api/v1/chat/room/route';
import * as desksRoute from '@/app/api/v1/desks/route';
import * as dmThreadsRoute from '@/app/api/v1/dm/threads/route';
import * as linksRoute from '@/app/api/v1/me/claude-links/route';
import * as revokeRoute from '@/app/api/v1/me/claude-links/revoke/route';
import * as exportRoute from '@/app/api/v1/me/export/route';
import * as onboardingRoute from '@/app/api/v1/me/onboarding/route';
import * as petRoute from '@/app/api/v1/me/pet/route';
import * as profileRoute from '@/app/api/v1/me/profile/route';
import * as meRoute from '@/app/api/v1/me/route';
import * as myLogRoute from '@/app/api/v1/me/work-logs/[id]/route';
import * as myLogsRoute from '@/app/api/v1/me/work-logs/route';
import * as nudgeActionRoute from '@/app/api/v1/me/nudges/[id]/actions/route';
import * as todoRoute from '@/app/api/v1/me/todos/[id]/route';
import * as todosRoute from '@/app/api/v1/me/todos/route';
import * as peopleRoute from '@/app/api/v1/people/route';
import * as cardRoute from '@/app/api/v1/users/[id]/card/route';
import * as historyRoute from '@/app/api/v1/users/[id]/chat-history/route';
import * as summariesRoute from '@/app/api/v1/users/[id]/claude-summaries/route';
import * as userLogsRoute from '@/app/api/v1/users/[id]/work-logs/route';
import * as healthRoute from '@/app/api/healthz/route';
import * as ticketRoute from '@/app/api/realtime-ticket/route';
import * as spriteRoute from '@/app/api/sprites/avatar/[key]/route';
import { closeDb } from '@/server/db';
import { adminUsers } from '@/server/queries/admin';
import { call, devLogin, freshDb, jsonOf } from './helpers';

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
});

async function userWithSession(input: Parameters<typeof createTestUser>[1] = {}) {
  const u = await createTestUser(h.db, input);
  const { cookie } = await devLogin(u.email);
  return { ...u, cookie };
}

async function insertLog(userId: string, over: Partial<typeof workLogs.$inferInsert> = {}) {
  const now = new Date();
  const id = newId();
  await h.db.insert(workLogs).values({
    id,
    userId,
    periodKey: '2026-10-28',
    periodStart: now,
    periodEnd: now,
    summary: '센서 모듈 버그를 재현했습니다.',
    tasks: [{ title: '버그 재현', status: 'done' }],
    blockers: ['장비 예약'],
    claudeChatSummary: '재시도 전략을 Claude와 검토했습니다.',
    visibility: 'company',
    chatSummaryVisibility: 'private',
    source: 'cowork_scheduled',
    claudeWrittenAt: now,
    ...over,
  });
  return id;
}

/** Collects town events (NOTIFY) until `stop()`; events arrive on commit. */
async function listenEvents() {
  const conn = await h.pool.connect();
  const events: TownEvent[] = [];
  conn.on('notification', (m) => events.push(JSON.parse(m.payload ?? 'null') as TownEvent));
  await conn.query(`listen ${TOWN_EVENTS_CHANNEL}`);
  return {
    events,
    stop: async () => {
      await new Promise((r) => setTimeout(r, 200));
      await conn.query('unlisten *');
      conn.release();
    },
  };
}

/** Today's (APP_TIMEZONE office day) activity report row for `userId`. */
async function insertReport(userId: string, periodKey = localDateKey(new Date(), 'Asia/Seoul')) {
  await h.db.insert(activityReports).values({
    userId,
    periodKey,
    nowKind: 'review',
    nowRefHash: 'f'.repeat(32),
    nowUntil: new Date(Date.now() + 3600_000),
    schedule: [
      {
        start_at: new Date(Date.now() - 3600_000).toISOString(),
        end_at: new Date(Date.now() + 1800_000).toISOString(),
        kind: 'meeting',
        ref_hash: 'e'.repeat(32),
      },
    ],
    source: 'cowork_scheduled',
  });
  return periodKey;
}

async function setPet(userId: string, species: PetSpecies) {
  await h.db
    .update(pets)
    .set({ species })
    .where(and(eq(pets.userId, userId), eq(pets.isDefault, true)));
}

async function defaultPetRow(userId: string) {
  const [p] = await h.db
    .select()
    .from(pets)
    .where(and(eq(pets.userId, userId), eq(pets.isDefault, true)));
  return p;
}

describe('authentication and authorization', () => {
  it('returns 401 JSON without a session', async () => {
    const id = newId();
    const cases = [
      [meRoute.GET, '/api/v1/me'],
      [peopleRoute.GET, '/api/v1/people'],
      [desksRoute.GET, '/api/v1/desks'],
      [myLogsRoute.GET, '/api/v1/me/work-logs'],
      [petRoute.GET, '/api/v1/me/pet'],
      [linksRoute.GET, '/api/v1/me/claude-links'],
      [exportRoute.GET, '/api/v1/me/export'],
      [roomRoute.GET, '/api/v1/chat/room'],
      [dmThreadsRoute.GET, '/api/v1/dm/threads'],
      [ticketRoute.GET, '/api/realtime-ticket'],
      [adminSeatsRoute.GET, '/api/v1/admin/seats'],
    ] as const;
    for (const [handler, path] of cases) {
      const res = await call(handler as never, path);
      expect(res.status, path).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'unauthorized' });
    }
    const card = await call(cardRoute.GET, `/api/v1/users/${id}/card`, { params: { id } });
    expect(card.status).toBe(401);
    const patch = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      body: { status_text: 'x' },
    });
    expect(patch.status).toBe(401);
  });

  it('rejects cross-origin writes even with a valid session', async () => {
    const me = await userWithSession();
    const res = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      origin: 'https://evil.example',
      body: { status_text: '해킹' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'bad_origin' });
  });

  it('serves /me with notice and link info', async () => {
    const me = await userWithSession({ name: '김요정' });
    const res = await call(meRoute.GET, '/api/v1/me', { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await jsonOf<MeDto>(res);
    expect(body).toMatchObject({
      userId: me.id,
      email: me.email,
      displayName: '김요정',
      isAdmin: false,
      noticeVersion: PRIVACY_NOTICE_VERSION,
      noticeAccepted: false,
      mcpUrl: 'http://localhost:3000/api/mcp',
      avatarKey: 'av-m-short-black-sky-warm',
      shareActivity: null,
      showLive: true,
      officeTimeZone: 'Asia/Seoul',
      manualStatus: null,
      activityToday: null,
      takenPetSpecies: [],
    });
  });

  it('serves my own status, today’s activity (no refs) and my own log timestamps on /me', async () => {
    const me = await userWithSession({ shareActivity: true });
    const until = new Date(Date.now() + 1800_000);
    await h.db
      .update(profiles)
      .set({ manualStatus: 'focus', manualStatusUntil: until, statusText: '집중해서 문서 작성 중' })
      .where(eq(profiles.userId, me.id));
    await insertReport(me.id);
    // Yesterday's report is never served.
    await insertReport(me.id, '2020-01-01');
    const body = await jsonOf<MeDto>(await call(meRoute.GET, '/api/v1/me', { cookie: me.cookie }));
    expect(body).toMatchObject({
      shareActivity: true,
      statusText: '집중해서 문서 작성 중',
      manualStatus: { status: 'focus', until: until.toISOString() },
      activityToday: { now: { kind: 'review' }, schedule: [{ kind: 'meeting', hasRef: true }] },
    });
    expect(JSON.stringify(body)).not.toContain('e'.repeat(32));
    expect(JSON.stringify(body)).not.toContain('f'.repeat(32));

    // An expired status is never served.
    await h.db
      .update(profiles)
      .set({ manualStatusUntil: new Date(Date.now() - 1000) })
      .where(eq(profiles.userId, me.id));
    expect(
      (await jsonOf<MeDto>(await call(meRoute.GET, '/api/v1/me', { cookie: me.cookie }))).manualStatus,
    ).toBeNull();
  });

  it('keeps admin routes for admins (role or ADMIN_EMAILS)', async () => {
    const member = await userWithSession();
    const forbidden = await call(adminSeatsRoute.GET, '/api/v1/admin/seats', { cookie: member.cookie });
    expect(forbidden.status).toBe(403);
    const target = await createTestUser(h.db);
    const deact = await call(deactivateRoute.POST, `/api/v1/admin/users/${target.id}/deactivate`, {
      method: 'POST',
      cookie: member.cookie,
      params: { id: target.id },
      body: {},
    });
    expect(deact.status).toBe(403);

    const byRole = await userWithSession({ role: 'admin' });
    expect((await call(adminSeatsRoute.GET, '/api/v1/admin/seats', { cookie: byRole.cookie })).status).toBe(
      200,
    );
    const byEmail = await userWithSession({ email: 'boss@enu-tech.co.kr' });
    expect((await call(adminSeatsRoute.GET, '/api/v1/admin/seats', { cookie: byEmail.cookie })).status).toBe(
      200,
    );
  });

  it('mints a 60 s realtime ticket for the session user', async () => {
    const me = await userWithSession();
    const res = await call(ticketRoute.GET, '/api/realtime-ticket', { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await jsonOf<{ token: string; expiresAt: string; wsUrl: string }>(res);
    expect(body.wsUrl).toBe('ws://localhost:2567');
    const { payload, protectedHeader } = await jwtVerify(
      body.token,
      new TextEncoder().encode(process.env.REALTIME_TICKET_SECRET),
      {
        audience: REALTIME_TICKET_AUDIENCE,
        algorithms: ['HS256'],
      },
    );
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.sub).toBe(me.id);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(60);
    expect(payload.exp! * 1000).toBe(new Date(body.expiresAt).getTime());
    await expect(
      jwtVerify(body.token, new TextEncoder().encode(process.env.REALTIME_TICKET_SECRET), {
        audience: 'http://localhost:3000/api/mcp',
      }),
    ).rejects.toThrow();
  });

  it('reports health', async () => {
    const res = await healthRoute.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('work logs and visibility', () => {
  it('never shows another user’s private log (404 for writes, absent from feeds)', async () => {
    const owner = await userWithSession({ name: '소유자' });
    const viewer = await userWithSession({ name: '동료' });
    const privateId = await insertLog(owner.id, { visibility: 'private', periodKey: '2026-10-29' });
    const publicId = await insertLog(owner.id, { periodKey: '2026-10-28' });

    const feed = await jsonOf<Paginated<WorkLogDto>>(
      await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    expect(feed.items.map((l) => l.id)).toEqual([publicId]);

    const card = await jsonOf<ProfileCardDto>(
      await call(cardRoute.GET, `/api/v1/users/${owner.id}/card`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    expect(card.latestLog?.id).toBe(publicId);
    expect(card.person.displayName).toBe('소유자');

    for (const method of ['PATCH', 'DELETE'] as const) {
      const handler = method === 'PATCH' ? myLogRoute.PATCH : myLogRoute.DELETE;
      const res = await call(handler, `/api/v1/me/work-logs/${privateId}`, {
        method,
        cookie: viewer.cookie,
        params: { id: privateId },
        body: method === 'PATCH' ? { visibility: 'company' } : undefined,
      });
      expect(res.status).toBe(404);
    }
    const [still] = await h.db.select().from(workLogs).where(eq(workLogs.id, privateId));
    expect(still?.visibility).toBe('private');

    const own = await jsonOf<Paginated<WorkLogDto>>(
      await call(myLogsRoute.GET, '/api/v1/me/work-logs', { cookie: owner.cookie }),
    );
    expect(own.items.map((l) => l.id)).toEqual([privateId, publicId]);

    const unknown = newId();
    expect(
      (
        await call(cardRoute.GET, `/api/v1/users/${unknown}/card`, {
          cookie: viewer.cookie,
          params: { id: unknown },
        })
      ).status,
    ).toBe(404);
  });

  it('hides logs of deactivated authors from others', async () => {
    const owner = await createTestUser(h.db, { status: 'deactivated' });
    const viewer = await userWithSession();
    await insertLog(owner.id);
    const res = await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, {
      cookie: viewer.cookie,
      params: { id: owner.id },
    });
    expect(res.status).toBe(404);
    expect(
      (
        await call(cardRoute.GET, `/api/v1/users/${owner.id}/card`, {
          cookie: viewer.cookie,
          params: { id: owner.id },
        })
      ).status,
    ).toBe(404);
  });

  it('shows the Claude chat summary only when log and summary are both company', async () => {
    const owner = await userWithSession({ name: '요약러' });
    const viewer = await userWithSession();
    const hidden = await insertLog(owner.id, { periodKey: '2026-10-27', chatSummaryVisibility: 'private' });
    const shown = await insertLog(owner.id, { periodKey: '2026-10-28', chatSummaryVisibility: 'company' });
    await insertLog(owner.id, {
      periodKey: '2026-10-29',
      visibility: 'private',
      chatSummaryVisibility: 'company',
    });

    const feed = await jsonOf<Paginated<WorkLogDto>>(
      await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    const byId = new Map(feed.items.map((l) => [l.id, l]));
    expect(feed.items).toHaveLength(2);
    expect(byId.get(hidden)?.claudeChatSummary).toBeNull();
    expect(byId.get(shown)?.claudeChatSummary).toBe('재시도 전략을 Claude와 검토했습니다.');
    expect(byId.get(shown)?.provenanceLabel).toBe('요약러님의 Claude가 작성');

    const summaries = await jsonOf<Paginated<{ logId: string }>>(
      await call(summariesRoute.GET, `/api/v1/users/${owner.id}/claude-summaries`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    expect(summaries.items.map((s) => s.logId)).toEqual([shown]);

    const mine = await jsonOf<Paginated<{ logId: string }>>(
      await call(summariesRoute.GET, `/api/v1/users/${owner.id}/claude-summaries`, {
        cookie: owner.cookie,
        params: { id: owner.id },
      }),
    );
    expect(mine.items).toHaveLength(3);
  });

  it('gives colleagues no status text, status or log timestamps (the owner keeps them)', async () => {
    const owner = await userWithSession({ name: '기록러' });
    const viewer = await userWithSession();
    await h.db
      .update(profiles)
      .set({ statusText: '오후 외근', lastWorkLogAt: new Date() })
      .where(eq(profiles.userId, owner.id));
    const id = await insertLog(owner.id, { editedByUser: true, userEditedAt: new Date() });

    const people = await jsonOf<PersonDto[]>(
      await call(peopleRoute.GET, '/api/v1/people', { cookie: viewer.cookie }),
    );
    const listed = people.find((p) => p.userId === owner.id);
    expect(listed).toBeDefined();
    const card = await jsonOf<ProfileCardDto>(
      await call(cardRoute.GET, `/api/v1/users/${owner.id}/card`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    for (const person of [listed, card.person]) {
      expect(person).not.toHaveProperty('statusText');
      expect(person).not.toHaveProperty('lastWorkLogAt');
    }
    expect(JSON.stringify({ people, card })).not.toContain('오후 외근');
    expect(card.latestLog).toMatchObject({
      id,
      claudeWrittenAt: null,
      updatedAt: null,
      userEditedAt: null,
      editedByUser: true,
      provenanceLabel: '기록러님의 Claude가 작성 · 본인 수정',
    });
    const feed = await jsonOf<Paginated<WorkLogDto>>(
      await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    expect(feed.items[0]).toMatchObject({ claudeWrittenAt: null, updatedAt: null, userEditedAt: null });

    // The owner still sees them on /me and in their own log views.
    const me = await jsonOf<MeDto>(await call(meRoute.GET, '/api/v1/me', { cookie: owner.cookie }));
    expect(me.statusText).toBe('오후 외근');
    expect(me.lastWorkLogAt).not.toBeNull();
    const own = await jsonOf<Paginated<WorkLogDto>>(
      await call(myLogsRoute.GET, '/api/v1/me/work-logs', { cookie: owner.cookie }),
    );
    expect(own.items[0]?.claudeWrittenAt).not.toBeNull();
    expect(own.items[0]?.updatedAt).not.toBeNull();
    expect(own.items[0]?.userEditedAt).not.toBeNull();
    const ownCard = await jsonOf<ProfileCardDto>(
      await call(cardRoute.GET, `/api/v1/users/${owner.id}/card`, {
        cookie: owner.cookie,
        params: { id: owner.id },
      }),
    );
    expect(ownCard.latestLog?.claudeWrittenAt).not.toBeNull();
  });

  it('gives colleagues work-log ids that carry no time (a UUIDv7 id would leak the first Claude write)', async () => {
    const owner = await userWithSession({ name: '기록러' });
    const viewer = await userWithSession();
    await h.db
      .update(profiles)
      .set({ defaultChatSummaryVisibility: 'company' })
      .where(eq(profiles.userId, owner.id));
    // The real write path, as the owner's Claude calls post_work_log.
    const out = await postWorkLog(
      h.db,
      { userId: owner.id, clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata' },
      {
        summary: '센서 모듈 버그를 재현했습니다.',
        tasks: [{ title: '버그 재현', status: 'done' }],
        blockers: [],
        source_hint: 'scheduled_task',
        claude_chat_summary: '재시도 전략을 Claude와 검토했습니다.',
        chat_summary_visibility: 'company',
      },
      { now: new Date(), publicUrl: 'http://localhost:3000' },
    );
    const [row] = await h.db.select().from(workLogs).where(eq(workLogs.id, out.log_id));
    expect(row).toBeDefined();
    const timeOf = (uuid: string) => parseInt(uuid.replace(/-/g, '').slice(0, 12), 16);
    const leaks = (uuid: string) =>
      [row!.createdAt, row!.periodStart, row!.claudeWrittenAt].some(
        (d) => Math.abs(timeOf(uuid) - d.getTime()) < 60_000,
      );

    const feed = await jsonOf<Paginated<WorkLogDto>>(
      await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    const card = await jsonOf<ProfileCardDto>(
      await call(cardRoute.GET, `/api/v1/users/${owner.id}/card`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    const summaries = await jsonOf<Paginated<{ logId: string }>>(
      await call(summariesRoute.GET, `/api/v1/users/${owner.id}/claude-summaries`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    const ids = [feed.items[0]?.id, card.latestLog?.id, summaries.items[0]?.logId];
    expect(ids).toEqual([row!.id, row!.id, row!.id]);
    for (const id of ids) {
      expect(id!.charAt(14)).toBe('4'); // random UUIDv4, not time-ordered v7
      expect(leaks(id!)).toBe(false);
    }
  });

  it('paginates with an opaque cursor', async () => {
    const owner = await userWithSession();
    for (const day of ['2026-10-20', '2026-10-21', '2026-10-22'])
      await insertLog(owner.id, { periodKey: day });
    const p1 = await jsonOf<Paginated<WorkLogDto>>(
      await call(myLogsRoute.GET, '/api/v1/me/work-logs?limit=2', { cookie: owner.cookie }),
    );
    expect(p1.items.map((l) => l.periodKey)).toEqual(['2026-10-22', '2026-10-21']);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await jsonOf<Paginated<WorkLogDto>>(
      await call(myLogsRoute.GET, `/api/v1/me/work-logs?limit=2&cursor=${p1.nextCursor}`, {
        cookie: owner.cookie,
      }),
    );
    expect(p2.items.map((l) => l.periodKey)).toEqual(['2026-10-20']);
    expect(p2.nextCursor).toBeNull();
    expect(
      (await call(myLogsRoute.GET, '/api/v1/me/work-logs?cursor=garbage!', { cookie: owner.cookie })).status,
    ).toBe(400);
  });

  it('refuses to create logs from the web (405)', async () => {
    const res = await myLogsRoute.POST();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    expect(await res.json()).toMatchObject({ error: 'method_not_allowed' });
  });

  it('PATCH visibility pins visibility_set_by=user without marking content edited', async () => {
    const owner = await userWithSession();
    const id = await insertLog(owner.id);
    const listener = await h.pool.connect();
    const events: unknown[] = [];
    listener.on('notification', (m) => events.push(JSON.parse(m.payload ?? 'null')));
    await listener.query(`listen ${TOWN_EVENTS_CHANNEL}`);

    const res = await call(myLogRoute.PATCH, `/api/v1/me/work-logs/${id}`, {
      method: 'PATCH',
      cookie: owner.cookie,
      params: { id },
      body: { visibility: 'private', chat_summary_visibility: 'company' },
    });
    expect(res.status).toBe(200);
    const dto = await jsonOf<WorkLogDto>(res);
    expect(dto.visibility).toBe('private');
    expect(dto.editedByUser).toBe(false);
    const [row] = await h.db.select().from(workLogs).where(eq(workLogs.id, id));
    expect(row).toMatchObject({
      visibility: 'private',
      visibilitySetBy: 'user',
      chatSummaryVisibilitySetBy: 'user',
      editedByUser: false,
    });
    expect(row?.userEditedAt).toBeNull();

    await new Promise((r) => setTimeout(r, 200));
    await listener.query('unlisten *');
    listener.release();
    expect(events).toContainEqual({
      v: 1,
      type: 'work_log_changed',
      user_id: owner.id,
      log_id: id,
      visibility: 'private',
      created: false,
      by: 'user',
    });
  });

  it('PATCH content marks edited_by_user and rejects unpublishable text', async () => {
    const owner = await userWithSession({ name: '편집자' });
    const id = await insertLog(owner.id);
    const res = await call(myLogRoute.PATCH, `/api/v1/me/work-logs/${id}`, {
      method: 'PATCH',
      cookie: owner.cookie,
      params: { id },
      body: { summary: '직접 고친 요약입니다.', blockers: [] },
    });
    expect(res.status).toBe(200);
    const dto = await jsonOf<WorkLogDto>(res);
    expect(dto.summary).toBe('직접 고친 요약입니다.');
    expect(dto.editedByUser).toBe(true);
    expect(dto.userEditedAt).toBeTruthy();
    expect(dto.provenanceLabel).toBe('편집자님의 Claude가 작성 · 본인 수정');
    const [row] = await h.db.select().from(workLogs).where(eq(workLogs.id, id));
    expect(row?.visibilitySetBy).toBe('claude');
    expect(row?.blockers).toEqual([]);

    const bad = await call(myLogRoute.PATCH, `/api/v1/me/work-logs/${id}`, {
      method: 'PATCH',
      cookie: owner.cookie,
      params: { id },
      body: { summary: '연락처 010-1234-5678 로 주세요' },
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: 'content_rejected',
      fields: [{ field: 'summary', reason: 'pii' }],
    });

    const empty = await call(myLogRoute.PATCH, `/api/v1/me/work-logs/${id}`, {
      method: 'PATCH',
      cookie: owner.cookie,
      params: { id },
      body: {},
    });
    expect(empty.status).toBe(400);
  });

  it('DELETE soft-deletes and nulls the content immediately', async () => {
    const owner = await userWithSession();
    const viewer = await userWithSession();
    const id = await insertLog(owner.id);
    const listener = await listenEvents();
    const res = await call(myLogRoute.DELETE, `/api/v1/me/work-logs/${id}`, {
      method: 'DELETE',
      cookie: owner.cookie,
      params: { id },
    });
    expect(res.status).toBe(204);
    await listener.stop();
    // The owner's own edit never sparkles in the town (only Claude writes do).
    expect(listener.events).toContainEqual({
      v: 1,
      type: 'work_log_changed',
      user_id: owner.id,
      log_id: id,
      visibility: 'company',
      created: false,
      by: 'user',
    });
    const [row] = await h.db.select().from(workLogs).where(eq(workLogs.id, id));
    expect(row?.deletedAt).toBeTruthy();
    expect(row).toMatchObject({ summary: null, tasks: [], blockers: [], claudeChatSummary: null });
    const own = await jsonOf<Paginated<WorkLogDto>>(
      await call(myLogsRoute.GET, '/api/v1/me/work-logs', { cookie: owner.cookie }),
    );
    expect(own.items).toHaveLength(0);
    const feed = await jsonOf<Paginated<WorkLogDto>>(
      await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, {
        cookie: viewer.cookie,
        params: { id: owner.id },
      }),
    );
    expect(feed.items).toHaveLength(0);
    const again = await call(myLogRoute.DELETE, `/api/v1/me/work-logs/${id}`, {
      method: 'DELETE',
      cookie: owner.cookie,
      params: { id },
    });
    expect(again.status).toBe(404);
  });
});

describe('chat history', () => {
  async function msg(input: {
    kind: 'dm' | 'room';
    sender: string;
    body: string;
    dm?: [string, string];
    at: number;
  }) {
    const id = newId();
    const pair = input.dm ? ([...input.dm].sort() as [string, string]) : null;
    await h.db.insert(chatMessages).values({
      id,
      kind: input.kind,
      senderId: input.sender,
      dmLow: pair?.[0] ?? null,
      dmHigh: pair?.[1] ?? null,
      body: input.body,
      clientMsgId: `t-${id}`,
      createdAt: new Date(Date.UTC(2026, 9, 29, 1, 0, input.at)),
    });
    return id;
  }

  it('implements dm / room kinds exactly; nearby no longer exists', async () => {
    const a = await userWithSession({ name: '에이' });
    const b = await createTestUser(h.db, { name: '비' });
    const c = await createTestUser(h.db, { name: '씨' });

    const dm1 = await msg({ kind: 'dm', sender: a.id, body: 'A->B', dm: [a.id, b.id], at: 1 });
    const dm2 = await msg({ kind: 'dm', sender: b.id, body: 'B->A', dm: [b.id, a.id], at: 2 });
    await msg({ kind: 'dm', sender: b.id, body: 'B->C', dm: [b.id, c.id], at: 3 });
    const deleted = await msg({ kind: 'dm', sender: b.id, body: 'deleted', dm: [b.id, a.id], at: 4 });
    await h.db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, deleted));

    const roomB = await msg({ kind: 'room', sender: b.id, body: 'B room', at: 9 });
    await msg({ kind: 'room', sender: c.id, body: 'C room', at: 10 });

    const get = async (kind: string) =>
      call(historyRoute.GET, `/api/v1/users/${b.id}/chat-history?kind=${kind}`, {
        cookie: a.cookie,
        params: { id: b.id },
      });
    const dm = await jsonOf<Paginated<ChatItemDto>>(await get('dm'));
    expect(dm.items.map((m) => m.id)).toEqual([dm1, dm2]);
    expect(dm.items[1]).toEqual({
      id: dm2,
      kind: 'dm',
      senderId: b.id,
      senderName: '비',
      text: 'B->A',
      createdAt: '2026-10-29T01:00:02.000Z',
    });
    expect((await jsonOf<Paginated<ChatItemDto>>(await get('room'))).items.map((m) => m.id)).toEqual([roomB]);

    for (const kind of ['nearby', 'all']) {
      const bad = await get(kind);
      expect(bad.status, kind).toBe(400);
      expect(await bad.json()).toMatchObject({
        error: 'invalid_query',
        fields: [{ field: 'kind', reason: 'invalid_value' }],
      });
    }

    const room = await jsonOf<Paginated<ChatItemDto>>(
      await call(roomRoute.GET, '/api/v1/chat/room?limit=1', { cookie: a.cookie }),
    );
    expect(room.items.map((m) => m.text)).toEqual(['C room']);
    const older = await jsonOf<Paginated<ChatItemDto>>(
      await call(roomRoute.GET, `/api/v1/chat/room?limit=1&before=${room.nextCursor}`, { cookie: a.cookie }),
    );
    expect(older.items.map((m) => m.text)).toEqual(['B room']);

    const threads = await jsonOf<{ peerId: string; lastText: string; unread: number }[]>(
      await call(dmThreadsRoute.GET, '/api/v1/dm/threads', { cookie: a.cookie }),
    );
    expect(threads).toEqual([expect.objectContaining({ peerId: b.id, lastText: 'B->A', unread: 1 })]);
  });
});

describe('onboarding', () => {
  const body = {
    accept_notice_version: PRIVACY_NOTICE_VERSION,
    desk_id: 'L3a',
    avatar: { body: 'f', hair: 'bob', hairColor: 'pink', outfit: 'mint', skin: 'light', wings: true },
    pet_species: 'fox',
    pet_name: '여울',
    default_chat_summary_visibility: 'company',
    share_activity: false,
    pet_chat_default_visibility: 'private',
  } as const;

  it('requires the current notice version', async () => {
    const me = await userWithSession();
    const res = await call(onboardingRoute.POST, '/api/v1/me/onboarding', {
      method: 'POST',
      cookie: me.cookie,
      body: { ...body, accept_notice_version: '2020-01' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'notice_required' });
    const consents = await h.db.select().from(privacyConsents).where(eq(privacyConsents.userId, me.id));
    expect(consents).toHaveLength(0);
  });

  it('records consents, seat, avatar and pet, and completes onboarding', async () => {
    await h.db
      .insert(desks)
      .values([{ deskId: 'L3a' }, { deskId: 'L3b' }])
      .onConflictDoNothing();
    const me = await userWithSession();
    await h.db.update(profiles).set({ onboardingCompletedAt: null }).where(eq(profiles.userId, me.id));
    const res = await call(onboardingRoute.POST, '/api/v1/me/onboarding', {
      method: 'POST',
      cookie: me.cookie,
      body,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const dto = await jsonOf<MeDto>(res);
    expect(dto).toMatchObject({
      deskId: 'L3a',
      onboardingCompleted: true,
      noticeAccepted: true,
      avatarKey: 'av-f-bob-pink-mint-light-w',
      pet: { species: 'fox', name: '여울' },
    });
    expect(dto.prefs.defaultChatSummaryVisibility).toBe('company');
    const scopes = (await h.db.select().from(privacyConsents).where(eq(privacyConsents.userId, me.id)))
      .map((c) => c.scope)
      .sort();
    expect(scopes).toEqual(['claude_chat_summary', 'service']);
    expect(dto.prefs.petChatDefaultVisibility).toBe('private');

    // Taken seats are refused; moving to a free seat frees the old one (keeping my own pet is fine).
    const other = await userWithSession();
    const taken = await call(onboardingRoute.POST, '/api/v1/me/onboarding', {
      method: 'POST',
      cookie: other.cookie,
      body: { ...body, pet_species: 'bunny' },
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: 'desk_taken' });
    const moved = await call(onboardingRoute.POST, '/api/v1/me/onboarding', {
      method: 'POST',
      cookie: me.cookie,
      body: { ...body, desk_id: 'L3b' },
    });
    expect((await jsonOf<MeDto>(moved)).deskId).toBe('L3b');
    const [old] = await h.db.select().from(desks).where(eq(desks.deskId, 'L3a'));
    expect(old?.userId).toBeNull();
  });

  it('requires an explicit 활동 공유 choice and records the activity_sharing consent', async () => {
    const me = await userWithSession();
    const { share_activity: _omitted, ...withoutChoice } = body;
    const missing = await call(onboardingRoute.POST, '/api/v1/me/onboarding', {
      method: 'POST',
      cookie: me.cookie,
      body: { ...withoutChoice, desk_id: null },
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: 'invalid_body',
      fields: [{ field: 'share_activity', reason: 'invalid_type' }],
    });

    const listener = await listenEvents();
    const res = await call(onboardingRoute.POST, '/api/v1/me/onboarding', {
      method: 'POST',
      cookie: me.cookie,
      body: { ...body, desk_id: null, share_activity: true, pet_chat_default_visibility: 'company' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const dto = await jsonOf<MeDto>(res);
    expect(dto.shareActivity).toBe(true);
    expect(dto.prefs.petChatDefaultVisibility).toBe('company');
    await listener.stop();
    expect(listener.events).toEqual(
      expect.arrayContaining([
        { v: 1, type: 'profile_changed', user_id: me.id },
        { v: 1, type: 'activity_changed', user_id: me.id },
      ]),
    );
    const consents = await h.db.select().from(privacyConsents).where(eq(privacyConsents.userId, me.id));
    for (const scope of ['activity_sharing', 'pet_chat_sharing']) {
      expect(consents.find((c) => c.scope === scope)).toMatchObject({
        noticeVersion: PRIVACY_NOTICE_VERSION,
        withdrawnAt: null,
      });
    }
  });

  it('refuses a pet another active member already has (409 pet_taken)', async () => {
    const holder = await createTestUser(h.db);
    await setPet(holder.id, 'fox');
    const me = await userWithSession();
    const res = await call(onboardingRoute.POST, '/api/v1/me/onboarding', {
      method: 'POST',
      cookie: me.cookie,
      body: { ...body, desk_id: null },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'pet_taken',
      message: '이미 다른 동료가 고른 펫이에요. 다른 펫을 골라 주세요.',
      fields: [{ field: 'pet_species', reason: 'taken' }],
    });
    // Nothing of the wizard was saved.
    expect(await h.db.select().from(privacyConsents).where(eq(privacyConsents.userId, me.id))).toHaveLength(
      0,
    );
    expect((await defaultPetRow(me.id))?.species).not.toBe('fox');
  });
});

describe('활동 공유, 접속 표시 and pets', () => {
  it('turning 활동 공유 off deletes today’s report, withdraws the consent and NOTIFYs both events', async () => {
    const me = await userWithSession({ shareActivity: true });
    await insertReport(me.id);
    const listener = await listenEvents();
    const res = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { share_activity: false },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const dto = await jsonOf<MeDto>(res);
    expect(dto).toMatchObject({ shareActivity: false, activityToday: null });
    await listener.stop();
    const mine = listener.events.filter((e) => 'user_id' in e && e.user_id === me.id);
    expect(mine).toEqual(
      expect.arrayContaining([
        { v: 1, type: 'profile_changed', user_id: me.id },
        { v: 1, type: 'activity_changed', user_id: me.id },
      ]),
    );
    expect(await h.db.select().from(activityReports).where(eq(activityReports.userId, me.id))).toEqual([]);
    const [consent] = await h.db
      .select()
      .from(privacyConsents)
      .where(and(eq(privacyConsents.userId, me.id), eq(privacyConsents.scope, 'activity_sharing')));
    expect(consent?.withdrawnAt).not.toBeNull();

    // Back on: the consent is active again, and nothing of today's report comes back.
    const on = await jsonOf<MeDto>(
      await call(profileRoute.PATCH, '/api/v1/me/profile', {
        method: 'PATCH',
        cookie: me.cookie,
        body: { share_activity: true },
      }),
    );
    expect(on).toMatchObject({ shareActivity: true, activityToday: null });
    const [again] = await h.db
      .select()
      .from(privacyConsents)
      .where(and(eq(privacyConsents.userId, me.id), eq(privacyConsents.scope, 'activity_sharing')));
    expect(again?.withdrawnAt).toBeNull();
  });

  it('PATCH show_live updates 접속 표시 and NOTIFYs profile_changed only', async () => {
    const me = await userWithSession();
    const listener = await listenEvents();
    const res = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { show_live: false },
    });
    expect((await jsonOf<MeDto>(res)).showLive).toBe(false);
    await listener.stop();
    expect(listener.events.filter((e) => 'user_id' in e && e.user_id === me.id)).toEqual([
      { v: 1, type: 'profile_changed', user_id: me.id },
    ]);
    const [p] = await h.db.select().from(profiles).where(eq(profiles.userId, me.id));
    expect(p?.showLive).toBe(false);
  });

  it('keeps every active member’s pet different', async () => {
    const [first, second, third, fourth] = PET_SPECIES as unknown as [
      PetSpecies,
      PetSpecies,
      PetSpecies,
      PetSpecies,
    ];
    const me = await userWithSession();
    await setPet(me.id, third);
    await setPet((await createTestUser(h.db)).id, fourth);
    await setPet((await createTestUser(h.db)).id, second);
    const leaver = await createTestUser(h.db, { status: 'deactivated' });
    await setPet(leaver.id, first);

    // Other active members' species, in PET_SPECIES order (not mine, not a deactivated member's).
    const meDto = await jsonOf<MeDto>(await call(meRoute.GET, '/api/v1/me', { cookie: me.cookie }));
    expect(meDto.takenPetSpecies).toEqual([second, fourth]);

    const patchPet = (species: PetSpecies) =>
      call(profileRoute.PATCH, '/api/v1/me/profile', {
        method: 'PATCH',
        cookie: me.cookie,
        body: { pet_species: species, pet_name: '몽실' },
      });
    const taken = await patchPet(second);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      error: 'pet_taken',
      fields: [{ field: 'pet_species', reason: 'taken' }],
    });
    const unchanged = await defaultPetRow(me.id);
    expect(unchanged?.species).toBe(third);
    expect(unchanged?.name).not.toBe('몽실');

    // Re-saving my own species is fine.
    const own = await patchPet(third);
    expect(own.status, await own.clone().text()).toBe(200);
    expect((await jsonOf<MeDto>(own)).pet).toEqual({ species: third, name: '몽실' });

    // A deactivated member's species is free again.
    const freed = await patchPet(first);
    expect(freed.status, await freed.clone().text()).toBe(200);
    expect((await jsonOf<MeDto>(freed)).pet.species).toBe(first);

    // A species shared from before this rule never blocks other profile edits; switching to it does.
    await setPet((await createTestUser(h.db)).id, first);
    const rename = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { display_name: '새 이름', pet_species: first },
    });
    expect(rename.status, await rename.clone().text()).toBe(200);
    expect((await patchPet(fourth)).status).toBe(409);
  });

  it('never lets two concurrent picks of one species both win', async () => {
    const a = await userWithSession();
    const b = await userWithSession();
    const species = PET_SPECIES[PET_SPECIES.length - 1] as PetSpecies;
    const pick = (cookie: string) =>
      call(profileRoute.PATCH, '/api/v1/me/profile', {
        method: 'PATCH',
        cookie,
        body: { pet_species: species },
      });
    const statuses = (await Promise.all([pick(a.cookie), pick(b.cookie)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const holders = await h.db
      .select()
      .from(pets)
      .where(and(eq(pets.species, species), eq(pets.isDefault, true)));
    expect(holders).toHaveLength(1);
  });
});

describe('profile, pet and links', () => {
  it('updates prefs, records chat-summary consent and blocks org-field edits for members', async () => {
    const me = await userWithSession();
    const res = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: {
        status_text: '회의실에 있어요',
        default_chat_summary_visibility: 'company',
        share_dms_with_my_claude: true,
        quiet_start: '20:00',
      },
    });
    expect(res.status).toBe(200);
    const dto = await jsonOf<MeDto>(res);
    expect(dto.statusText).toBe('회의실에 있어요');
    expect(dto.prefs).toMatchObject({
      defaultChatSummaryVisibility: 'company',
      shareDmsWithMyClaude: true,
      quietStart: '20:00',
    });
    const [consent] = await h.db
      .select()
      .from(privacyConsents)
      .where(and(eq(privacyConsents.userId, me.id), eq(privacyConsents.scope, 'claude_chat_summary')));
    expect(consent?.withdrawnAt).toBeNull();

    const org = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { team: 'mgmt' },
    });
    expect(org.status).toBe(403);
    const invalid = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { quiet_start: '25:00' },
    });
    expect(invalid.status).toBe(400);
  });

  it('lists and revokes Claude links', async () => {
    const me = await userWithSession();
    const now = new Date();
    const l1 = newId();
    const l2 = newId();
    await h.db.insert(claudeLinks).values([
      {
        id: l1,
        userId: me.id,
        clientId: 'https://claude.ai/oauth/mcp',
        clientName: 'Claude',
        clientKind: 'claude_ai',
        redirectHost: 'claude.ai',
        consentedAt: now,
      },
      {
        id: l2,
        userId: me.id,
        clientId: 'cc-local',
        clientName: 'Claude Code',
        clientKind: 'claude_code',
        redirectHost: 'localhost',
        consentedAt: now,
      },
    ]);
    const list = await jsonOf<{ id: string; revokedAt: string | null }[]>(
      await call(linksRoute.GET, '/api/v1/me/claude-links', { cookie: me.cookie }),
    );
    expect(list.map((l) => l.id).sort()).toEqual([l1, l2].sort());

    const one = await call(revokeRoute.POST, '/api/v1/me/claude-links/revoke', {
      method: 'POST',
      cookie: me.cookie,
      body: { link_id: l1 },
    });
    expect(await one.json()).toEqual({ revoked: 1 });
    const pet = await jsonOf<{ links: { id: string }[] }>(
      await call(petRoute.GET, '/api/v1/me/pet', { cookie: me.cookie }),
    );
    expect(pet.links.map((l) => l.id)).toEqual([l2]);

    const all = await call(revokeRoute.POST, '/api/v1/me/claude-links/revoke', {
      method: 'POST',
      cookie: me.cookie,
      body: {},
    });
    expect(await all.json()).toEqual({ revoked: 1 });
    const rows = await h.db.select().from(claudeLinks).where(eq(claudeLinks.userId, me.id));
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('exports only my own data', async () => {
    const me = await userWithSession();
    const other = await createTestUser(h.db);
    await insertLog(me.id);
    await insertLog(other.id, { visibility: 'private', summary: '남의 비공개 로그' });
    const [low, high] = [me.id, other.id].sort() as [string, string];
    await h.db.insert(chatMessages).values({
      id: newId(),
      kind: 'dm',
      senderId: other.id,
      dmLow: low,
      dmHigh: high,
      body: '남이 보낸 DM',
      clientMsgId: 'x1',
    });
    await h.db.insert(chatMessages).values({
      id: newId(),
      kind: 'dm',
      senderId: me.id,
      dmLow: low,
      dmHigh: high,
      body: '내가 보낸 DM',
      clientMsgId: 'x2',
    });
    await insertReport(me.id);
    await insertReport(other.id);
    await h.db.insert(chatMessages).values({
      id: newId(),
      kind: 'room',
      senderId: me.id,
      body: '내가 보낸 전체 채팅',
      clientMsgId: 'x3',
    });
    const res = await call(exportRoute.GET, '/api/v1/me/export', { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="enu-den-export-\d{8}\.json"$/,
    );
    const text = await res.text();
    expect(text).toContain('내가 보낸 DM');
    expect(text).not.toContain('남이 보낸 DM');
    expect(text).not.toContain('남의 비공개 로그');
    const data = JSON.parse(text) as {
      workLogs: unknown[];
      account: { email: string };
      profile: { showLive: boolean; manualStatus: string | null };
      activityReports: { now: { kind: string; hasRef: boolean } | null; schedule: { hasRef: boolean }[] }[];
      sentChatMessages: Record<string, unknown>[];
    };
    expect(data.workLogs).toHaveLength(1);
    expect(data.account.email).toBe(me.email);
    expect(data.profile).toMatchObject({ showLive: true, manualStatus: null });
    // My own report only, with has_ref instead of the keyed hashes.
    expect(data.activityReports).toEqual([
      expect.objectContaining({
        now: expect.objectContaining({ kind: 'review', hasRef: true }),
        schedule: [expect.objectContaining({ kind: 'meeting', hasRef: true })],
      }),
    ]);
    expect(text).not.toContain('f'.repeat(32));
    expect(text).not.toContain('e'.repeat(32));
    expect(data.sentChatMessages).toHaveLength(2);
    for (const m of data.sentChatMessages) expect(m).not.toHaveProperty('zoneId');
  });
});

describe('to-dos and pet bubbles', () => {
  async function seedTodo(userId: string) {
    const todoId = newId();
    await h.db
      .insert(todos)
      .values({ id: todoId, userId, externalRef: `t:${todoId}`, title: '배포 체크리스트', priority: 1 });
    const nudgeId = newId();
    const now = Date.now();
    await h.db.insert(petNudges).values({
      id: nudgeId,
      userId,
      text: '배포 전에 체크리스트 한 번 볼까요?',
      todoId,
      showAfter: new Date(now - 60_000),
      expiresAt: new Date(now + 3600_000),
    });
    return { todoId, nudgeId };
  }

  it('lets the owner close a to-do (status_source=user) and retires its bubbles', async () => {
    const me = await userWithSession();
    const other = await userWithSession();
    const { todoId, nudgeId } = await seedTodo(me.id);
    const listener = await h.pool.connect();
    const events: { type: string }[] = [];
    listener.on('notification', (m) => events.push(JSON.parse(m.payload ?? 'null')));
    await listener.query(`listen ${TOWN_EVENTS_CHANNEL}`);

    const foreign = await call(todoRoute.PATCH, `/api/v1/me/todos/${todoId}`, {
      method: 'PATCH',
      cookie: other.cookie,
      params: { id: todoId },
      body: { status: 'done' },
    });
    expect(foreign.status).toBe(404);
    const res = await call(todoRoute.PATCH, `/api/v1/me/todos/${todoId}`, {
      method: 'PATCH',
      cookie: me.cookie,
      params: { id: todoId },
      body: { status: 'done' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: todoId, status: 'done', statusSource: 'user' });
    const [n] = await h.db.select().from(petNudges).where(eq(petNudges.id, nudgeId));
    expect(n?.status).toBe('superseded');

    const past = await call(todoRoute.PATCH, `/api/v1/me/todos/${todoId}`, {
      method: 'PATCH',
      cookie: me.cookie,
      params: { id: todoId },
      body: { snoozed_until: new Date(Date.now() - 1000).toISOString() },
    });
    expect(past.status).toBe(400);
    const snoozed = await call(todoRoute.PATCH, `/api/v1/me/todos/${todoId}`, {
      method: 'PATCH',
      cookie: me.cookie,
      params: { id: todoId },
      body: { snoozed_until: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect(await snoozed.json()).toMatchObject({ status: 'snoozed', statusSource: 'user' });
    const list = await jsonOf<{ id: string }[]>(
      await call(todosRoute.GET, '/api/v1/me/todos', { cookie: me.cookie }),
    );
    expect(list.map((t) => t.id)).toEqual([todoId]);

    await new Promise((r) => setTimeout(r, 200));
    await listener.query('unlisten *');
    listener.release();
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['todos_changed', 'nudges_changed']));
  });

  it('acks, snoozes and dismisses bubbles, refusing already-handled ones', async () => {
    const me = await userWithSession();
    const { nudgeId } = await seedTodo(me.id);
    const act = (body: unknown) =>
      call(nudgeActionRoute.POST, `/api/v1/me/nudges/${nudgeId}/actions`, {
        method: 'POST',
        cookie: me.cookie,
        params: { id: nudgeId },
        body,
      });
    const before = Date.now();
    const snooze = await act({ action: 'snooze', snooze_minutes: 15 });
    expect(snooze.status).toBe(200);
    expect(await snooze.json()).toMatchObject({ id: nudgeId, status: 'snoozed' });
    const [row] = await h.db.select().from(petNudges).where(eq(petNudges.id, nudgeId));
    expect(row!.snoozedUntil!.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1000);
    expect(await (await act({ action: 'ack' })).json()).toMatchObject({ status: 'acked' });
    expect((await act({ action: 'dismiss' })).status).toBe(409);
    expect((await act({ action: 'explode' })).status).toBe(400);
    const missing = newId();
    expect(
      (
        await call(nudgeActionRoute.POST, `/api/v1/me/nudges/${missing}/actions`, {
          method: 'POST',
          cookie: me.cookie,
          params: { id: missing },
          body: { action: 'ack' },
        })
      ).status,
    ).toBe(404);
  });
});

describe('admin', () => {
  it('assigns, moves and unassigns seats (one desk per user)', async () => {
    await h.db
      .insert(desks)
      .values([{ deskId: 'L1a' }, { deskId: 'L1b' }])
      .onConflictDoNothing();
    const admin = await userWithSession({ role: 'admin' });
    const u = await createTestUser(h.db, { name: '자리주인' });
    const assign = (deskId: string, userId: string | null) =>
      call(adminSeatsRoute.POST, '/api/v1/admin/seats', {
        method: 'POST',
        cookie: admin.cookie,
        body: { desk_id: deskId, user_id: userId },
      });

    expect((await assign('L1a', u.id)).status).toBe(200);
    const moved = await jsonOf<{
      desks: { deskId: string; userId: string | null; displayName: string | null }[];
    }>(await assign('L1b', u.id));
    const byDesk = new Map(moved.desks.map((d) => [d.deskId, d]));
    expect(byDesk.get('L1a')?.userId).toBeNull();
    expect(byDesk.get('L1b')).toMatchObject({ userId: u.id, displayName: '자리주인' });
    await assign('L1b', null);
    const [d] = await h.db.select().from(desks).where(eq(desks.deskId, 'L1b'));
    expect(d?.userId).toBeNull();
    expect((await assign('L1a', newId())).status).toBe(404);
  });

  it('shows the last log date only for logs a colleague could see (never a private one)', async () => {
    const admin = await userWithSession({ role: 'admin' });
    const secretive = await createTestUser(h.db, { name: '비공개러' });
    const open = await createTestUser(h.db, { name: '공개러' });
    const gone = await createTestUser(h.db, { name: '퇴사자', status: 'deactivated' });
    await insertLog(secretive.id, { periodKey: '2026-10-29', visibility: 'private' });
    await insertLog(open.id, { periodKey: '2026-10-27', visibility: 'company' });
    await insertLog(open.id, { periodKey: '2026-10-29', visibility: 'private' });
    await insertLog(open.id, { periodKey: '2026-10-28', visibility: 'company', deletedAt: new Date() });
    await insertLog(gone.id, { periodKey: '2026-10-26', visibility: 'company' });
    const rows = await adminUsers(h.db, {
      userId: admin.id,
      email: admin.email,
      name: admin.name,
      role: 'admin',
      isAdmin: true,
      sessionId: 'test-session',
    });
    const last = (id: string) => rows.find((r) => r.userId === id)?.lastLogDate;
    expect(last(secretive.id)).toBeNull();
    expect(last(open.id)).toBe('2026-10-27');
    expect(last(gone.id)).toBeNull(); // colleagues see no logs of a deactivated author at all
  });

  it('deactivates a user (sessions, links and seat revoked)', async () => {
    await h.db
      .insert(desks)
      .values([{ deskId: 'L2a' }])
      .onConflictDoNothing();
    const admin = await userWithSession({ role: 'admin' });
    const target = await userWithSession({ name: '퇴사자' });
    await h.db.update(desks).set({ userId: target.id }).where(eq(desks.deskId, 'L2a'));
    const res = await call(deactivateRoute.POST, `/api/v1/admin/users/${target.id}/deactivate`, {
      method: 'POST',
      cookie: admin.cookie,
      params: { id: target.id },
      body: {},
    });
    expect(res.status).toBe(200);
    expect((await call(meRoute.GET, '/api/v1/me', { cookie: target.cookie })).status).toBe(401);
    const [d] = await h.db.select().from(desks).where(eq(desks.deskId, 'L2a'));
    expect(d?.userId).toBeNull();
    const self = await call(deactivateRoute.POST, `/api/v1/admin/users/${admin.id}/deactivate`, {
      method: 'POST',
      cookie: admin.cookie,
      params: { id: admin.id },
      body: {},
    });
    expect(self.status).toBe(400);
  });
});

describe('avatar sprites', () => {
  it('rejects malformed keys with 400 and serves PNG sheets for valid ones', async () => {
    const bad = await call(spriteRoute.GET, '/api/sprites/avatar/av-m-nope', {
      params: { key: 'av-m-nope' },
    });
    expect(bad.status).toBe(400);
    const key = 'av-f-bob-pink-rose-light-w';
    const ok = await call(spriteRoute.GET, `/api/sprites/avatar/${key}`, { params: { key } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const buf = Buffer.from(await ok.arrayBuffer());
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(448);
    expect(buf.readUInt32BE(20)).toBe(128);
  });
});
