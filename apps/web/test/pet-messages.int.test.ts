import { auditEvents, newOpaqueId, petMessages, pets, user, workLogs, type DbHandle } from '@enu/db';
import { createTestUser } from '@enu/testing';
import {
  APP_TIMEZONE_DEFAULT,
  TOWN_EVENTS_CHANNEL,
  localDateKey,
  type ColleaguePetMessageDto,
  type OwnerPetDto,
  type OwnerPetMessageDto,
  type PetThreadPageDto,
  type TownEvent,
} from '@enu/shared';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as exportRoute from '@/app/api/v1/me/export/route';
import * as hideRoute from '@/app/api/v1/me/pets/[petId]/hide-history/route';
import * as messageRoute from '@/app/api/v1/me/pets/[petId]/messages/[messageId]/route';
import * as messagesRoute from '@/app/api/v1/me/pets/[petId]/messages/route';
import * as readRoute from '@/app/api/v1/me/pets/[petId]/read/route';
import * as threadRoute from '@/app/api/v1/me/pets/[petId]/thread/route';
import * as petsRoute from '@/app/api/v1/me/pets/route';
import * as colleagueThreadRoute from '@/app/api/v1/users/[id]/pets/[petId]/thread/route';
import { closeDb } from '@/server/db';
import { encodeCursor } from '@/server/http';
import { resetRateLimits } from '@/server/rate-limit';
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
  resetRateLimits();
});

/** Every key a colleague's message may carry; anything else (times, answer or read state) is a leak. */
const COLLEAGUE_KEYS = ['author', 'dayKey', 'id', 'petId', 'text', 'view'];
/** An ISO time of day anywhere in a payload. */
const TIME_OF_DAY = /T\d\d:\d\d/;
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

async function userWithSession(input: Parameters<typeof createTestUser>[1] = {}) {
  const u = await createTestUser(h.db, input);
  const { cookie } = await devLogin(u.email);
  const [pet] = await h.db
    .select()
    .from(pets)
    .where(and(eq(pets.userId, u.id), eq(pets.isDefault, true)));
  return { ...u, cookie, petId: pet!.id };
}

let clientSeq = 0;
const send = (cookie: string, petId: string, text: string, extra: Record<string, unknown> = {}) =>
  call(messagesRoute.POST, `/api/v1/me/pets/${petId}/messages`, {
    method: 'POST',
    cookie,
    params: { petId },
    body: { text, client_msg_id: `client-${++clientSeq}-${Date.now()}`, ...extra },
  });

async function sent(cookie: string, petId: string, text: string, extra: Record<string, unknown> = {}) {
  const res = await send(cookie, petId, text, extra);
  expect(res.status, await res.clone().text()).toBe(201);
  return jsonOf<OwnerPetMessageDto>(res);
}

const ownerThread = (cookie: string, petId: string, query = '') =>
  call(threadRoute.GET, `/api/v1/me/pets/${petId}/thread${query}`, { cookie, params: { petId } });

const colleagueThread = (cookie: string, ownerId: string, petId: string, query = '') =>
  call(colleagueThreadRoute.GET, `/api/v1/users/${ownerId}/pets/${petId}/thread${query}`, {
    cookie,
    params: { id: ownerId, petId },
  });

const patchMessage = (cookie: string, petId: string, messageId: string, visibility: string) =>
  call(messageRoute.PATCH, `/api/v1/me/pets/${petId}/messages/${messageId}`, {
    method: 'PATCH',
    cookie,
    params: { petId, messageId },
    body: { visibility },
  });

/** A reply of the owner's Claude, written directly (the reply service arrives with the MCP and channel lanes). */
async function insertReply(
  question: OwnerPetMessageDto,
  ownerId: string,
  text: string,
  opts: { part?: number; visibility?: 'company' | 'private'; unread?: boolean; at?: Date } = {},
) {
  const id = newOpaqueId();
  await h.db.insert(petMessages).values({
    id,
    petId: question.petId,
    userId: ownerId,
    author: 'pet',
    body: text,
    dayKey: question.dayKey,
    visibility: opts.visibility ?? 'company',
    visibilitySetBy: 'claude',
    source: 'claude_code_channel',
    inReplyTo: question.id,
    replyPart: opts.part ?? 1,
    unread: opts.unread ?? true,
    createdAt: opts.at ?? new Date(Date.parse(question.createdAt) + (opts.part ?? 1)),
  });
  return id;
}

/** Audit rows of `userId` other than signing in. */
const auditsOf = (userId: string) =>
  h.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.actorUserId, userId), ne(auditEvents.action, 'auth.sign_in')));

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

describe('writing to my pet', () => {
  it('stores a message once per client_msg_id and NOTIFYs pet_thread_changed', async () => {
    const me = await userWithSession();
    const listener = await listenEvents();
    const body = { text: '  오늘 오전에 끝낼 일 정리해 줘 ', client_msg_id: 'c-0001-repeat' };
    const post = () =>
      call(messagesRoute.POST, `/api/v1/me/pets/${me.petId}/messages`, {
        method: 'POST',
        cookie: me.cookie,
        params: { petId: me.petId },
        body,
      });
    const first = await post();
    expect(first.status, await first.clone().text()).toBe(201);
    const again = await post();
    await listener.stop();
    expect(again.status).toBe(200);
    const [a, b] = [await jsonOf<OwnerPetMessageDto>(first), await jsonOf<OwnerPetMessageDto>(again)];
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({
      view: 'owner',
      petId: me.petId,
      author: 'owner',
      text: '오늘 오전에 끝낼 일 정리해 줘',
      dayKey: localDateKey(new Date(), APP_TIMEZONE_DEFAULT),
      visibility: 'company',
      visibilitySetBy: 'owner',
      source: null,
      clientMsgId: 'c-0001-repeat',
      inReplyTo: null,
      answerState: 'pending',
      unread: false,
    });
    expect(a.id.charAt(14)).toBe('4');
    const changes = listener.events.filter((e) => e.type === 'pet_thread_changed');
    expect(changes).toEqual([{ v: 1, type: 'pet_thread_changed', user_id: me.id, pet_id: me.petId }]);
    // Writing to a pet is not audited (content and timing stay out of the audit log).
    expect(await auditsOf(me.id)).toEqual([]);
  });

  it('follows the pet default, refuses personal data in public and takes it as 나만 보기', async () => {
    const me = await userWithSession();
    const pii = '고객 연락처 010-1234-5678 로 회신 부탁해';
    const refused = await send(me.cookie, me.petId, pii);
    expect(refused.status).toBe(422);
    expect(await jsonOf(refused)).toMatchObject({
      error: 'pii_public',
      fields: [{ field: 'text', reason: 'pii' }],
    });
    expect(await sent(me.cookie, me.petId, pii, { visibility: 'private' })).toMatchObject({
      visibility: 'private',
    });

    await h.db.update(pets).set({ defaultVisibility: 'private' }).where(eq(pets.id, me.petId));
    expect(await sent(me.cookie, me.petId, '오늘 회의 준비 같이 하자')).toMatchObject({
      visibility: 'private',
    });
    // The owner can still choose to share one message.
    expect(
      await sent(me.cookie, me.petId, '오늘 회의 준비 같이 하자', { visibility: 'company' }),
    ).toMatchObject({ visibility: 'company' });
  });

  it("rejects someone else's pet, empty text and a client id reused in another pet", async () => {
    const me = await userWithSession();
    const other = await userWithSession();
    expect((await send(me.cookie, other.petId, '안녕')).status).toBe(404);
    expect((await send(me.cookie, me.petId, ` ${ZERO_WIDTH_SPACE} `)).status).toBe(400);
    expect((await send(me.cookie, me.petId, '가'.repeat(1001))).status).toBe(400);

    const created = await call(petsRoute.POST, '/api/v1/me/pets', {
      method: 'POST',
      cookie: me.cookie,
      body: {
        name: '리뷰봇',
        species: 'owl',
        tint: 'mint',
        role_instructions: null,
        reply_route: 'both',
        default_visibility: null,
      },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const second = await jsonOf<OwnerPetDto>(created);
    const body = { text: '첫 메시지', client_msg_id: 'shared-client-id' };
    const one = await call(messagesRoute.POST, `/api/v1/me/pets/${me.petId}/messages`, {
      method: 'POST',
      cookie: me.cookie,
      params: { petId: me.petId },
      body,
    });
    expect(one.status).toBe(201);
    const two = await call(messagesRoute.POST, `/api/v1/me/pets/${second.id}/messages`, {
      method: 'POST',
      cookie: me.cookie,
      params: { petId: second.id },
      body,
    });
    expect(two.status).toBe(409);
  });
});

describe('my pet room', () => {
  it('pages newest first with every owner field and the day cards of my work logs', async () => {
    const me = await userWithSession();
    const q1 = await sent(me.cookie, me.petId, '첫 번째 질문');
    await insertReply(q1, me.id, '첫 번째 답');
    const q2 = await sent(me.cookie, me.petId, '두 번째 질문');
    const today = localDateKey(new Date(), APP_TIMEZONE_DEFAULT);
    await h.db.insert(workLogs).values({
      id: newOpaqueId(),
      userId: me.id,
      periodKey: today,
      periodStart: new Date(),
      periodEnd: new Date(),
      summary: '오늘 한 일',
      visibility: 'private',
      source: 'cowork_scheduled',
      claudeWrittenAt: new Date(),
    });

    const res = await ownerThread(me.cookie, me.petId, '?limit=2');
    expect(res.status).toBe(200);
    const page = await jsonOf<PetThreadPageDto<OwnerPetMessageDto>>(res);
    expect(page.items.map((m) => m.text)).toEqual(['첫 번째 답', '두 번째 질문']);
    expect(page.items[0]).toMatchObject({
      author: 'pet',
      source: 'claude_code_channel',
      inReplyTo: q1.id,
      replyPart: 1,
      unread: true,
      visibilitySetBy: 'claude',
    });
    expect(page.items[1]).toMatchObject({ id: q2.id, answerState: 'pending' });
    expect(page.items[1]!.createdAt).toMatch(TIME_OF_DAY);
    // My own private log rides along, with its times.
    expect(page.workLogs).toEqual([expect.objectContaining({ periodKey: today, summary: '오늘 한 일' })]);
    expect(page.workLogs[0]!.claudeWrittenAt).not.toBeNull();
    expect(page.nextCursor).not.toBeNull();

    const older = await jsonOf<PetThreadPageDto<OwnerPetMessageDto>>(
      await ownerThread(me.cookie, me.petId, `?limit=2&cursor=${page.nextCursor}`),
    );
    expect(older.items.map((m) => m.text)).toEqual(['첫 번째 질문']);
    expect(older.nextCursor).toBeNull();
    expect((await ownerThread(me.cookie, me.petId, '?cursor=bad!')).status).toBe(400);
  });

  it("is not found for someone else's pet", async () => {
    const me = await userWithSession();
    const other = await userWithSession();
    expect((await ownerThread(me.cookie, other.petId)).status).toBe(404);
    expect((await ownerThread(me.cookie, 'not-a-uuid')).status).toBe(404);
  });
});

describe("a colleague's view of a pet room", () => {
  async function conversation() {
    const owner = await userWithSession();
    const viewer = await userWithSession();
    const shared = await sent(owner.cookie, owner.petId, '배포 체크리스트 같이 보자');
    await insertReply(shared, owner.id, '체크리스트 세 항목이 남았어요');
    await insertReply(shared, owner.id, '나만 보는 메모', { part: 2, visibility: 'private' });
    const hidden = await sent(owner.cookie, owner.petId, '연봉 협상 준비', { visibility: 'private' });
    // Claude could not raise it, but even a company reply to a private question stays hidden.
    await insertReply(hidden, owner.id, '협상 자료 정리했어요');
    return { owner, viewer, shared, hidden };
  }

  it('shows company messages with the date only and no owner-only field', async () => {
    const { owner, viewer, shared } = await conversation();
    await h.db.insert(workLogs).values({
      id: newOpaqueId(),
      userId: owner.id,
      periodKey: shared.dayKey,
      periodStart: new Date(),
      periodEnd: new Date(),
      summary: '공개 업무 로그',
      visibility: 'company',
      source: 'cowork_scheduled',
      claudeWrittenAt: new Date(),
    });
    const res = await colleagueThread(viewer.cookie, owner.id, owner.petId);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toMatch(TIME_OF_DAY);
    for (const word of [
      '나만 보는 메모',
      '연봉 협상',
      '협상 자료',
      'claude_code_channel',
      'answerState',
      'unread',
    ])
      expect(raw).not.toContain(word);
    const page = JSON.parse(raw) as PetThreadPageDto<ColleaguePetMessageDto>;
    expect(page.items.map((m) => [m.author, m.text])).toEqual([
      ['owner', '배포 체크리스트 같이 보자'],
      ['pet', '체크리스트 세 항목이 남았어요'],
    ]);
    for (const m of page.items) {
      expect(Object.keys(m).sort()).toEqual(COLLEAGUE_KEYS);
      expect(m).toMatchObject({ view: 'colleague', petId: owner.petId, dayKey: shared.dayKey });
    }
    expect(page.workLogs).toEqual([
      expect.objectContaining({ summary: '공개 업무 로그', claudeWrittenAt: null, periodStart: null }),
    ]);
    // The owner previewing their own room through the colleague route gets exactly the same view.
    const preview = await colleagueThread(owner.cookie, owner.id, owner.petId);
    expect(JSON.parse(await preview.text())).toEqual(page);
  });

  it('hides the replies of a question the owner hides, and shows them again when it is shared', async () => {
    const { owner, viewer, shared } = await conversation();
    const listener = await listenEvents();
    const hide = await patchMessage(owner.cookie, owner.petId, shared.id, 'private');
    await listener.stop();
    expect(hide.status).toBe(200);
    expect(await jsonOf(hide)).toMatchObject({ id: shared.id, visibility: 'private' });
    expect(listener.events).toContainEqual({
      v: 1,
      type: 'pet_thread_changed',
      user_id: owner.id,
      pet_id: owner.petId,
    });
    const none = await jsonOf<PetThreadPageDto<ColleaguePetMessageDto>>(
      await colleagueThread(viewer.cookie, owner.id, owner.petId),
    );
    expect(none.items).toEqual([]);

    expect((await patchMessage(owner.cookie, owner.petId, shared.id, 'company')).status).toBe(200);
    const back = await jsonOf<PetThreadPageDto<ColleaguePetMessageDto>>(
      await colleagueThread(viewer.cookie, owner.id, owner.petId),
    );
    expect(back.items.map((m) => m.text)).toEqual([
      '배포 체크리스트 같이 보자',
      '체크리스트 세 항목이 남았어요',
    ]);
    // Only the owner decides.
    expect((await patchMessage(viewer.cookie, owner.petId, shared.id, 'private')).status).toBe(404);
  });

  it('pages by message id and answers a hidden or unknown id like a malformed cursor', async () => {
    const { owner, viewer, shared, hidden } = await conversation();
    const first = await jsonOf<PetThreadPageDto<ColleaguePetMessageDto>>(
      await colleagueThread(viewer.cookie, owner.id, owner.petId, '?limit=1'),
    );
    expect(first.items.map((m) => m.text)).toEqual(['체크리스트 세 항목이 남았어요']);
    expect(first.nextCursor).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8')) as string[];
    expect(decoded[0]).toBe('r');
    const second = await jsonOf<PetThreadPageDto<ColleaguePetMessageDto>>(
      await colleagueThread(viewer.cookie, owner.id, owner.petId, `?limit=1&cursor=${first.nextCursor}`),
    );
    expect(second.items.map((m) => m.id)).toEqual([shared.id]);
    expect(second.nextCursor).toBeNull();

    const refused = [
      encodeCursor({ k: 'r', id: hidden.id }),
      encodeCursor({ k: 'r', id: newOpaqueId() }),
      encodeCursor({ k: String(Date.now() * 1000), id: shared.id }),
      'bad!',
    ];
    const bodies = new Set<string>();
    for (const cursor of refused) {
      const res = await colleagueThread(viewer.cookie, owner.id, owner.petId, `?cursor=${cursor}`);
      expect(res.status, cursor).toBe(400);
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
  });

  it('is not found for a deactivated owner, an unknown pet or a pet under another owner', async () => {
    const { owner, viewer } = await conversation();
    const third = await userWithSession();
    expect((await colleagueThread(viewer.cookie, owner.id, third.petId)).status).toBe(404);
    expect((await colleagueThread(viewer.cookie, owner.id, newOpaqueId())).status).toBe(404);
    expect((await colleagueThread(viewer.cookie, 'nobody', owner.petId)).status).toBe(404);
    expect((await colleagueThread(viewer.cookie, owner.id, owner.petId)).status).toBe(200);
    await h.db.update(user).set({ status: 'deactivated' }).where(eq(user.id, owner.id));
    expect((await colleagueThread(viewer.cookie, owner.id, owner.petId)).status).toBe(404);
  });
});

describe('managing my pet room', () => {
  it('hides the whole history at once and audits only the count', async () => {
    const owner = await userWithSession();
    const viewer = await userWithSession();
    const q = await sent(owner.cookie, owner.petId, '첫 질문');
    await insertReply(q, owner.id, '첫 답');
    await sent(owner.cookie, owner.petId, '이미 비공개', { visibility: 'private' });

    const res = await call(hideRoute.POST, `/api/v1/me/pets/${owner.petId}/hide-history`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { petId: owner.petId },
    });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ updated: 2 });
    const page = await jsonOf<PetThreadPageDto<ColleaguePetMessageDto>>(
      await colleagueThread(viewer.cookie, owner.id, owner.petId),
    );
    expect(page.items).toEqual([]);
    const audits = await auditsOf(owner.id);
    expect(audits.map((a) => [a.action, a.targetId, a.metadata])).toEqual([
      ['pet_messages.hide_history', owner.petId, { count: 2 }],
    ]);
  });

  it('marks replies read up to a message', async () => {
    const owner = await userWithSession();
    const q1 = await sent(owner.cookie, owner.petId, '하나');
    const r1 = await insertReply(q1, owner.id, '하나의 답');
    const q2 = await sent(owner.cookie, owner.petId, '둘');
    await insertReply(q2, owner.id, '둘의 답', { at: new Date(Date.now() + 60_000) });
    const read = (lastMessageId: string, cookie = owner.cookie) =>
      call(readRoute.POST, `/api/v1/me/pets/${owner.petId}/read`, {
        method: 'POST',
        cookie,
        params: { petId: owner.petId },
        body: { last_message_id: lastMessageId },
      });

    const mine = async () =>
      (
        await jsonOf<OwnerPetDto[]>(await call(petsRoute.GET, '/api/v1/me/pets', { cookie: owner.cookie }))
      )[0]!;
    expect(await mine()).toMatchObject({ unread: 2, pendingCount: 2 });
    const res = await read(r1);
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ unread: 1 });
    expect(await mine()).toMatchObject({ unread: 1, last: { author: 'pet', text: '둘의 답' } });
    const stranger = await userWithSession();
    expect((await read(r1, stranger.cookie)).status).toBe(404);
  });

  it('deletes my message with its replies, and only mine', async () => {
    const owner = await userWithSession();
    const other = await userWithSession();
    const q = await sent(owner.cookie, owner.petId, '지울 질문');
    await insertReply(q, owner.id, '지워질 답');
    const keep = await sent(owner.cookie, owner.petId, '남길 질문');
    const del = (cookie: string) =>
      call(messageRoute.DELETE, `/api/v1/me/pets/${owner.petId}/messages/${q.id}`, {
        method: 'DELETE',
        cookie,
        params: { petId: owner.petId, messageId: q.id },
      });
    expect((await del(other.cookie)).status).toBe(404);
    expect((await del(owner.cookie)).status).toBe(204);
    const left = await h.db.select().from(petMessages).where(eq(petMessages.userId, owner.id));
    expect(left.map((m) => m.id)).toEqual([keep.id]);
  });

  it("exports my pet conversation but not a colleague's", async () => {
    const owner = await userWithSession();
    const other = await userWithSession();
    const q = await sent(owner.cookie, owner.petId, '내보낼 질문');
    await insertReply(q, owner.id, '내보낼 답');
    await sent(other.cookie, other.petId, '남의 펫 대화');
    const res = await call(exportRoute.GET, '/api/v1/me/export', { cookie: owner.cookie });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('남의 펫 대화');
    const data = JSON.parse(text) as {
      petMessages: { author: string; text: string; inReplyTo: string | null }[];
    };
    expect(data.petMessages.map((m) => [m.author, m.text, m.inReplyTo])).toEqual([
      ['owner', '내보낼 질문', null],
      ['pet', '내보낼 답', q.id],
    ]);
  });
});
