import { chatMessageRecipients, chatMessages, claudeLinks, desks, newId, privacyConsents, profiles, workLogs, type DbHandle } from '@enu/db';
import { createTestUser } from '@enu/testing';
import {
  PRIVACY_NOTICE_VERSION,
  REALTIME_TICKET_AUDIENCE,
  type ChatItemDto,
  type MeDto,
  type Paginated,
  type ProfileCardDto,
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
import * as peopleRoute from '@/app/api/v1/people/route';
import * as cardRoute from '@/app/api/v1/users/[id]/card/route';
import * as historyRoute from '@/app/api/v1/users/[id]/chat-history/route';
import * as summariesRoute from '@/app/api/v1/users/[id]/claude-summaries/route';
import * as userLogsRoute from '@/app/api/v1/users/[id]/work-logs/route';
import * as healthRoute from '@/app/api/healthz/route';
import * as ticketRoute from '@/app/api/realtime-ticket/route';
import * as spriteRoute from '@/app/api/sprites/avatar/[key]/route';
import { closeDb } from '@/server/db';
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
    const patch = await call(profileRoute.PATCH, '/api/v1/me/profile', { method: 'PATCH', body: { status_text: 'x' } });
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
    });
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
    expect((await call(adminSeatsRoute.GET, '/api/v1/admin/seats', { cookie: byRole.cookie })).status).toBe(200);
    const byEmail = await userWithSession({ email: 'boss@enu-tech.co.kr' });
    expect((await call(adminSeatsRoute.GET, '/api/v1/admin/seats', { cookie: byEmail.cookie })).status).toBe(200);
  });

  it('mints a 60 s realtime ticket for the session user', async () => {
    const me = await userWithSession();
    const res = await call(ticketRoute.GET, '/api/realtime-ticket', { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await jsonOf<{ token: string; expiresAt: string; wsUrl: string }>(res);
    expect(body.wsUrl).toBe('ws://localhost:2567');
    const { payload, protectedHeader } = await jwtVerify(body.token, new TextEncoder().encode(process.env.REALTIME_TICKET_SECRET), {
      audience: REALTIME_TICKET_AUDIENCE,
      algorithms: ['HS256'],
    });
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.sub).toBe(me.id);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(60);
    expect(payload.exp! * 1000).toBe(new Date(body.expiresAt).getTime());
    await expect(jwtVerify(body.token, new TextEncoder().encode(process.env.REALTIME_TICKET_SECRET), { audience: 'http://localhost:3000/api/mcp' })).rejects.toThrow();
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
      await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, { cookie: viewer.cookie, params: { id: owner.id } }),
    );
    expect(feed.items.map((l) => l.id)).toEqual([publicId]);

    const card = await jsonOf<ProfileCardDto>(
      await call(cardRoute.GET, `/api/v1/users/${owner.id}/card`, { cookie: viewer.cookie, params: { id: owner.id } }),
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

    const own = await jsonOf<Paginated<WorkLogDto>>(await call(myLogsRoute.GET, '/api/v1/me/work-logs', { cookie: owner.cookie }));
    expect(own.items.map((l) => l.id)).toEqual([privateId, publicId]);

    const unknown = newId();
    expect((await call(cardRoute.GET, `/api/v1/users/${unknown}/card`, { cookie: viewer.cookie, params: { id: unknown } })).status).toBe(404);
  });

  it('hides logs of deactivated authors from others', async () => {
    const owner = await createTestUser(h.db, { status: 'deactivated' });
    const viewer = await userWithSession();
    await insertLog(owner.id);
    const res = await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, { cookie: viewer.cookie, params: { id: owner.id } });
    expect(res.status).toBe(404);
    expect((await call(cardRoute.GET, `/api/v1/users/${owner.id}/card`, { cookie: viewer.cookie, params: { id: owner.id } })).status).toBe(404);
  });

  it('shows the Claude chat summary only when log and summary are both company', async () => {
    const owner = await userWithSession({ name: '요약러' });
    const viewer = await userWithSession();
    const hidden = await insertLog(owner.id, { periodKey: '2026-10-27', chatSummaryVisibility: 'private' });
    const shown = await insertLog(owner.id, { periodKey: '2026-10-28', chatSummaryVisibility: 'company' });
    await insertLog(owner.id, { periodKey: '2026-10-29', visibility: 'private', chatSummaryVisibility: 'company' });

    const feed = await jsonOf<Paginated<WorkLogDto>>(
      await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, { cookie: viewer.cookie, params: { id: owner.id } }),
    );
    const byId = new Map(feed.items.map((l) => [l.id, l]));
    expect(feed.items).toHaveLength(2);
    expect(byId.get(hidden)?.claudeChatSummary).toBeNull();
    expect(byId.get(shown)?.claudeChatSummary).toBe('재시도 전략을 Claude와 검토했습니다.');
    expect(byId.get(shown)?.provenanceLabel).toBe('요약러님의 Claude가 작성');

    const summaries = await jsonOf<Paginated<{ logId: string }>>(
      await call(summariesRoute.GET, `/api/v1/users/${owner.id}/claude-summaries`, { cookie: viewer.cookie, params: { id: owner.id } }),
    );
    expect(summaries.items.map((s) => s.logId)).toEqual([shown]);

    const mine = await jsonOf<Paginated<{ logId: string }>>(
      await call(summariesRoute.GET, `/api/v1/users/${owner.id}/claude-summaries`, { cookie: owner.cookie, params: { id: owner.id } }),
    );
    expect(mine.items).toHaveLength(3);
  });

  it('paginates with an opaque cursor', async () => {
    const owner = await userWithSession();
    for (const day of ['2026-10-20', '2026-10-21', '2026-10-22']) await insertLog(owner.id, { periodKey: day });
    const p1 = await jsonOf<Paginated<WorkLogDto>>(await call(myLogsRoute.GET, '/api/v1/me/work-logs?limit=2', { cookie: owner.cookie }));
    expect(p1.items.map((l) => l.periodKey)).toEqual(['2026-10-22', '2026-10-21']);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await jsonOf<Paginated<WorkLogDto>>(
      await call(myLogsRoute.GET, `/api/v1/me/work-logs?limit=2&cursor=${p1.nextCursor}`, { cookie: owner.cookie }),
    );
    expect(p2.items.map((l) => l.periodKey)).toEqual(['2026-10-20']);
    expect(p2.nextCursor).toBeNull();
    expect((await call(myLogsRoute.GET, '/api/v1/me/work-logs?cursor=garbage!', { cookie: owner.cookie })).status).toBe(400);
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
    await listener.query('listen enu_town_events');

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
    expect(row).toMatchObject({ visibility: 'private', visibilitySetBy: 'user', chatSummaryVisibilitySetBy: 'user', editedByUser: false });
    expect(row?.userEditedAt).toBeNull();

    await new Promise((r) => setTimeout(r, 200));
    await listener.query('unlisten *');
    listener.release();
    expect(events).toContainEqual({ v: 1, type: 'work_log_changed', user_id: owner.id, log_id: id, visibility: 'private', created: false });
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
    expect(await bad.json()).toMatchObject({ error: 'content_rejected', fields: [{ field: 'summary', reason: 'pii' }] });

    const empty = await call(myLogRoute.PATCH, `/api/v1/me/work-logs/${id}`, { method: 'PATCH', cookie: owner.cookie, params: { id }, body: {} });
    expect(empty.status).toBe(400);
  });

  it('DELETE soft-deletes and nulls the content immediately', async () => {
    const owner = await userWithSession();
    const viewer = await userWithSession();
    const id = await insertLog(owner.id);
    const res = await call(myLogRoute.DELETE, `/api/v1/me/work-logs/${id}`, { method: 'DELETE', cookie: owner.cookie, params: { id } });
    expect(res.status).toBe(204);
    const [row] = await h.db.select().from(workLogs).where(eq(workLogs.id, id));
    expect(row?.deletedAt).toBeTruthy();
    expect(row).toMatchObject({ summary: null, tasks: [], blockers: [], claudeChatSummary: null });
    const own = await jsonOf<Paginated<WorkLogDto>>(await call(myLogsRoute.GET, '/api/v1/me/work-logs', { cookie: owner.cookie }));
    expect(own.items).toHaveLength(0);
    const feed = await jsonOf<Paginated<WorkLogDto>>(
      await call(userLogsRoute.GET, `/api/v1/users/${owner.id}/work-logs`, { cookie: viewer.cookie, params: { id: owner.id } }),
    );
    expect(feed.items).toHaveLength(0);
    const again = await call(myLogRoute.DELETE, `/api/v1/me/work-logs/${id}`, { method: 'DELETE', cookie: owner.cookie, params: { id } });
    expect(again.status).toBe(404);
  });
});

describe('chat history', () => {
  async function msg(input: { kind: 'dm' | 'room' | 'nearby'; sender: string; body: string; dm?: [string, string]; recipients?: string[]; at: number }) {
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
    if (input.recipients?.length) {
      await h.db.insert(chatMessageRecipients).values(input.recipients.map((u) => ({ messageId: id, userId: u })));
    }
    return id;
  }

  it('implements dm / nearby / room kinds exactly', async () => {
    const a = await userWithSession({ name: '에이' });
    const b = await createTestUser(h.db, { name: '비' });
    const c = await createTestUser(h.db, { name: '씨' });

    const dm1 = await msg({ kind: 'dm', sender: a.id, body: 'A->B', dm: [a.id, b.id], at: 1 });
    const dm2 = await msg({ kind: 'dm', sender: b.id, body: 'B->A', dm: [b.id, a.id], at: 2 });
    await msg({ kind: 'dm', sender: b.id, body: 'B->C', dm: [b.id, c.id], at: 3 });
    const deleted = await msg({ kind: 'dm', sender: b.id, body: 'deleted', dm: [b.id, a.id], at: 4 });
    await h.db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, deleted));

    const nearA = await msg({ kind: 'nearby', sender: a.id, body: 'A near, B heard', recipients: [a.id, b.id], at: 5 });
    const nearB = await msg({ kind: 'nearby', sender: b.id, body: 'B near, A heard', recipients: [b.id, a.id], at: 6 });
    await msg({ kind: 'nearby', sender: b.id, body: 'B near, A not there', recipients: [b.id, c.id], at: 7 });
    await msg({ kind: 'nearby', sender: c.id, body: 'C near, both heard', recipients: [a.id, b.id, c.id], at: 8 });

    const roomB = await msg({ kind: 'room', sender: b.id, body: 'B room', at: 9 });
    await msg({ kind: 'room', sender: c.id, body: 'C room', at: 10 });

    const get = async (kind: string) =>
      jsonOf<Paginated<ChatItemDto>>(
        await call(historyRoute.GET, `/api/v1/users/${b.id}/chat-history?kind=${kind}`, { cookie: a.cookie, params: { id: b.id } }),
      );
    const dm = await get('dm');
    expect(dm.items.map((m) => m.id)).toEqual([dm1, dm2]);
    expect(dm.items[1]).toMatchObject({ senderId: b.id, senderName: '비', text: 'B->A', kind: 'dm' });
    expect((await get('nearby')).items.map((m) => m.id)).toEqual([nearA, nearB]);
    expect((await get('room')).items.map((m) => m.id)).toEqual([roomB]);

    const bad = await call(historyRoute.GET, `/api/v1/users/${b.id}/chat-history?kind=all`, { cookie: a.cookie, params: { id: b.id } });
    expect(bad.status).toBe(400);

    const room = await jsonOf<Paginated<ChatItemDto>>(await call(roomRoute.GET, '/api/v1/chat/room?limit=1', { cookie: a.cookie }));
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
    await h.db.insert(desks).values([{ deskId: 'L3a' }, { deskId: 'L3b' }]).onConflictDoNothing();
    const me = await userWithSession();
    await h.db.update(profiles).set({ onboardingCompletedAt: null }).where(eq(profiles.userId, me.id));
    const res = await call(onboardingRoute.POST, '/api/v1/me/onboarding', { method: 'POST', cookie: me.cookie, body });
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
    const scopes = (await h.db.select().from(privacyConsents).where(eq(privacyConsents.userId, me.id))).map((c) => c.scope).sort();
    expect(scopes).toEqual(['claude_chat_summary', 'service']);

    // Taken seats are refused; moving to a free seat frees the old one.
    const other = await userWithSession();
    const taken = await call(onboardingRoute.POST, '/api/v1/me/onboarding', { method: 'POST', cookie: other.cookie, body });
    expect(taken.status).toBe(409);
    const moved = await call(onboardingRoute.POST, '/api/v1/me/onboarding', { method: 'POST', cookie: me.cookie, body: { ...body, desk_id: 'L3b' } });
    expect((await jsonOf<MeDto>(moved)).deskId).toBe('L3b');
    const [old] = await h.db.select().from(desks).where(eq(desks.deskId, 'L3a'));
    expect(old?.userId).toBeNull();
  });
});

describe('profile, pet and links', () => {
  it('updates prefs, records chat-summary consent and blocks org-field edits for members', async () => {
    const me = await userWithSession();
    const res = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { status_text: '회의실에 있어요', default_chat_summary_visibility: 'company', share_dms_with_my_claude: true, quiet_start: '20:00' },
    });
    expect(res.status).toBe(200);
    const dto = await jsonOf<MeDto>(res);
    expect(dto.statusText).toBe('회의실에 있어요');
    expect(dto.prefs).toMatchObject({ defaultChatSummaryVisibility: 'company', shareDmsWithMyClaude: true, quietStart: '20:00' });
    const [consent] = await h.db
      .select()
      .from(privacyConsents)
      .where(and(eq(privacyConsents.userId, me.id), eq(privacyConsents.scope, 'claude_chat_summary')));
    expect(consent?.withdrawnAt).toBeNull();

    const org = await call(profileRoute.PATCH, '/api/v1/me/profile', { method: 'PATCH', cookie: me.cookie, body: { team: 'mgmt' } });
    expect(org.status).toBe(403);
    const invalid = await call(profileRoute.PATCH, '/api/v1/me/profile', { method: 'PATCH', cookie: me.cookie, body: { quiet_start: '25:00' } });
    expect(invalid.status).toBe(400);
  });

  it('lists and revokes Claude links', async () => {
    const me = await userWithSession();
    const now = new Date();
    const l1 = newId();
    const l2 = newId();
    await h.db.insert(claudeLinks).values([
      { id: l1, userId: me.id, clientId: 'https://claude.ai/oauth/mcp', clientName: 'Claude', clientKind: 'claude_ai', redirectHost: 'claude.ai', consentedAt: now },
      { id: l2, userId: me.id, clientId: 'cc-local', clientName: 'Claude Code', clientKind: 'claude_code', redirectHost: 'localhost', consentedAt: now },
    ]);
    const list = await jsonOf<{ id: string; revokedAt: string | null }[]>(await call(linksRoute.GET, '/api/v1/me/claude-links', { cookie: me.cookie }));
    expect(list.map((l) => l.id).sort()).toEqual([l1, l2].sort());

    const one = await call(revokeRoute.POST, '/api/v1/me/claude-links/revoke', { method: 'POST', cookie: me.cookie, body: { link_id: l1 } });
    expect(await one.json()).toEqual({ revoked: 1 });
    const pet = await jsonOf<{ links: { id: string }[] }>(await call(petRoute.GET, '/api/v1/me/pet', { cookie: me.cookie }));
    expect(pet.links.map((l) => l.id)).toEqual([l2]);

    const all = await call(revokeRoute.POST, '/api/v1/me/claude-links/revoke', { method: 'POST', cookie: me.cookie, body: {} });
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
    await h.db.insert(chatMessages).values({ id: newId(), kind: 'dm', senderId: other.id, dmLow: low, dmHigh: high, body: '남이 보낸 DM', clientMsgId: 'x1' });
    await h.db.insert(chatMessages).values({ id: newId(), kind: 'dm', senderId: me.id, dmLow: low, dmHigh: high, body: '내가 보낸 DM', clientMsgId: 'x2' });
    const res = await call(exportRoute.GET, '/api/v1/me/export', { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="enu-town-export-\d{8}\.json"$/);
    const text = await res.text();
    expect(text).toContain('내가 보낸 DM');
    expect(text).not.toContain('남이 보낸 DM');
    expect(text).not.toContain('남의 비공개 로그');
    const data = JSON.parse(text) as { workLogs: unknown[]; account: { email: string } };
    expect(data.workLogs).toHaveLength(1);
    expect(data.account.email).toBe(me.email);
  });
});

describe('admin', () => {
  it('assigns, moves and unassigns seats (one desk per user)', async () => {
    await h.db.insert(desks).values([{ deskId: 'L1a' }, { deskId: 'L1b' }]).onConflictDoNothing();
    const admin = await userWithSession({ role: 'admin' });
    const u = await createTestUser(h.db, { name: '자리주인' });
    const assign = (deskId: string, userId: string | null) =>
      call(adminSeatsRoute.POST, '/api/v1/admin/seats', { method: 'POST', cookie: admin.cookie, body: { desk_id: deskId, user_id: userId } });

    expect((await assign('L1a', u.id)).status).toBe(200);
    const moved = await jsonOf<{ desks: { deskId: string; userId: string | null; displayName: string | null }[] }>(await assign('L1b', u.id));
    const byDesk = new Map(moved.desks.map((d) => [d.deskId, d]));
    expect(byDesk.get('L1a')?.userId).toBeNull();
    expect(byDesk.get('L1b')).toMatchObject({ userId: u.id, displayName: '자리주인' });
    await assign('L1b', null);
    const [d] = await h.db.select().from(desks).where(eq(desks.deskId, 'L1b'));
    expect(d?.userId).toBeNull();
    expect((await assign('L1a', newId())).status).toBe(404);
  });

  it('deactivates a user (sessions, links and seat revoked)', async () => {
    await h.db.insert(desks).values([{ deskId: 'L2a' }]).onConflictDoNothing();
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
    const bad = await call(spriteRoute.GET, '/api/sprites/avatar/av-m-nope', { params: { key: 'av-m-nope' } });
    expect(bad.status).toBe(400);
    const key = 'av-f-bob-pink-rose-light-w';
    const ok = await call(spriteRoute.GET, `/api/sprites/avatar/${key}`, { params: { key } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const buf = Buffer.from(await ok.arrayBuffer());
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(320);
    expect(buf.readUInt32BE(20)).toBe(128);
  });
});
