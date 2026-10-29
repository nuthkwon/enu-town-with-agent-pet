import { newOpaqueId, petMessages, petNudges, pets, type DbHandle } from '@enu/db';
import {
  MCP_TOOL_NAMES,
  getMyContextOutput,
  postPetNudgesOutput,
  postPetReplyOutput,
  type PostPetReplyOutput,
} from '@enu/shared';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postPetReplies } from '../src/index';
import { MODES, callTool } from './harness';
import {
  THU_14,
  THU_21,
  auditFor,
  linkRow,
  listen,
  makeHarness,
  settle,
  type Harness,
  type Listener,
} from './int-helpers';

let handle: DbHandle;
beforeAll(async () => {
  handle = await setupTestDb();
});
afterAll(async () => {
  await handle.close();
});

const CLIENT = 'https://claude.ai/oauth/client';
const MIN = 60_000;

async function defaultPet(userId: string) {
  const [pet] = await handle.db
    .select()
    .from(pets)
    .where(and(eq(pets.userId, userId), eq(pets.isDefault, true)));
  return pet!;
}

async function extraPet(userId: string, over: Partial<typeof pets.$inferInsert> = {}) {
  const [pet] = await handle.db
    .insert(pets)
    .values({
      id: newOpaqueId(),
      userId,
      name: '리뷰봇',
      species: 'owl',
      tint: 'mint',
      isDefault: false,
      sortOrder: 1,
      ...over,
    })
    .returning();
  return pet!;
}

/** An owner message written `minutesAgo` before THU_14 (the REST send is apps/web's; here only rows matter). */
async function ask(
  pet: { id: string; userId: string },
  text: string,
  minutesAgo: number,
  over: Partial<typeof petMessages.$inferInsert> = {},
) {
  const id = newOpaqueId();
  await handle.db.insert(petMessages).values({
    id,
    petId: pet.id,
    userId: pet.userId,
    author: 'owner',
    body: text,
    dayKey: '2026-10-29',
    visibility: 'company',
    visibilitySetBy: 'owner',
    clientMsgId: `c-${id.slice(0, 8)}`,
    answerState: 'pending',
    createdAt: new Date(Date.parse(THU_14) - minutesAgo * MIN),
    ...over,
  });
  return id;
}

const messagesOf = (petId: string) =>
  handle.db
    .select()
    .from(petMessages)
    .where(eq(petMessages.petId, petId))
    .orderBy(asc(petMessages.createdAt), asc(petMessages.id));

describe.each(MODES)('pet inbox and post_pet_reply (%s)', (mode) => {
  let h: Harness;
  let listener: Listener;
  beforeEach(async () => {
    await truncateAll(handle.db);
    h = makeHarness(handle.db, mode);
    listener = await listen(handle);
  });
  afterEach(async () => {
    await listener.stop();
    await h.close();
  });

  async function context(userId: string) {
    const out = await callTool(await h.client(userId), MCP_TOOL_NAMES.getMyContext, {
      include: ['pet_inbox'],
    });
    expect(out.isError, out.texts.join('\n')).toBe(false);
    return getMyContextOutput.parse(out.structured);
  }

  async function reply(userId: string, args: Record<string, unknown>): Promise<PostPetReplyOutput> {
    const out = await callTool(await h.client(userId), MCP_TOOL_NAMES.postPetReply, args);
    expect(out.isError, out.texts.join('\n')).toBe(false);
    return postPetReplyOutput.parse(out.structured);
  }

  it('lists what the connector may answer, with each pet and the conversation before it', async () => {
    const me = await createTestUser(handle.db);
    const main = await defaultPet(me.id);
    await handle.db
      .update(pets)
      .set({ roleInstructions: '일정 정리를 도와줘.', defaultVisibility: 'private' })
      .where(eq(pets.id, main.id));
    const coder = await extraPet(me.id, { replyRoute: 'channel' });
    const answeredQ = await ask(main, '어제 한 일 정리해 줘', 120, {
      answerState: 'answered',
      replyCount: 1,
    });
    await handle.db.insert(petMessages).values({
      id: newOpaqueId(),
      petId: main.id,
      userId: me.id,
      author: 'pet',
      body: '어제는 견적서 검토를 마쳤어요.',
      dayKey: '2026-10-29',
      visibility: 'company',
      visibilitySetBy: 'claude',
      source: 'cowork_scheduled',
      inReplyTo: answeredQ,
      replyPart: 1,
      createdAt: new Date(Date.parse(THU_14) - 110 * MIN),
    });
    const q1 = await ask(main, '오늘 회의 몇 시였지?', 30);
    const expiredHold = await ask(main, '회의 자료도 챙겨 줘', 20, {
      answerState: 'claimed',
      claimedBy: newOpaqueId(),
      claimUntil: new Date(Date.parse(THU_14) - MIN),
    });
    await ask(main, '지금 채널이 잡고 있는 질문', 10, {
      answerState: 'claimed',
      claimedBy: newOpaqueId(),
      claimUntil: new Date(Date.parse(THU_14) + 5 * MIN),
    });
    await ask(coder, '채널 전용 펫에게 한 질문', 5);

    const inbox = (await context(me.id)).pet_inbox!;
    expect(inbox.items.map((i) => i.message_id)).toEqual([q1, expiredHold]);
    expect(inbox).toMatchObject({ pending_total: 2, truncated: false });
    expect(inbox.items[0]).toMatchObject({
      pet_id: main.id,
      owner_text: '오늘 회의 몇 시였지?',
      visibility: 'company',
      sent_at: '2026-10-29T13:30:00+09:00',
    });
    expect(inbox.pets).toEqual([
      {
        pet_id: main.id,
        name: main.name,
        is_default: true,
        reply_route: 'both',
        default_visibility: 'private',
        role_instructions: '일정 정리를 도와줘.',
        recent: [
          { author: 'owner', sent_at: '2026-10-29T12:00:00+09:00', text: '어제 한 일 정리해 줘' },
          { author: 'pet', sent_at: '2026-10-29T12:10:00+09:00', text: '어제는 견적서 검토를 마쳤어요.' },
        ],
      },
    ]);
  });

  it('never lists pet messages outside office hours', async () => {
    const me = await createTestUser(handle.db);
    await ask(await defaultPet(me.id), '퇴근 후 질문', 0);
    h.clock.set(new Date(THU_21));
    const out = await context(me.id);
    expect(out.skip).toBe(true);
    expect(out.pet_inbox).toBeUndefined();
  });

  it('stores a reply verbatim, answers the earlier waiting messages too and NOTIFYs the owner', async () => {
    const me = await createTestUser(handle.db);
    const pet = await defaultPet(me.id);
    const earlier = await ask(pet, '먼저 보낸 질문', 30);
    const q = await ask(pet, '오늘 오전에 끝낼 일 정리해 줘', 10);
    const out = await reply(me.id, {
      replies: [{ in_reply_to: q, text: '  견적서 회신부터 끝내 봐요!  ' }],
    });
    expect(out.rejected).toEqual([]);
    expect(out.accepted).toEqual([
      expect.objectContaining({ index: 0, in_reply_to: q, result: 'created', visibility: 'company' }),
    ]);
    expect(out.delivery_note).toContain('펫 대화방');

    const rows = await messagesOf(pet.id);
    const stored = rows.find((r) => r.author === 'pet')!;
    expect(stored).toMatchObject({
      id: out.accepted[0]!.message_id,
      body: '견적서 회신부터 끝내 봐요!',
      inReplyTo: q,
      replyPart: 1,
      source: 'cowork_scheduled',
      visibility: 'company',
      visibilitySetBy: 'claude',
      unread: true,
      oauthClientId: CLIENT,
    });
    expect(stored.createdAt.getTime()).toBeGreaterThanOrEqual(Date.parse(THU_14));
    for (const id of [earlier, q]) {
      expect(rows.find((r) => r.id === id)).toMatchObject({
        answerState: 'answered',
        answeredLane: 'connector',
      });
    }
    expect(rows.find((r) => r.id === q)?.replyCount).toBe(1);
    await listener.waitFor(() =>
      listener
        .forUser(me.id)
        .some((e) => e.type === 'pet_thread_changed' && 'pet_id' in e && e.pet_id === pet.id),
    );
    expect((await linkRow(handle.db, me.id, CLIENT))?.lastWriteAt).not.toBeNull();
    // Replies are not audited; only the link created on the first tool call is.
    expect((await auditFor(handle.db, me.id)).map((a) => a.action)).toEqual([
      'claude_link.create_on_tool_call',
    ]);
    expect((await context(me.id)).pet_inbox).toMatchObject({ pending_total: 0, items: [] });
  });

  it('keeps parts in order, answers a repeat as duplicate and never lifts visibility', async () => {
    const me = await createTestUser(handle.db);
    const pet = await defaultPet(me.id);
    const secret = await ask(pet, '나만 보는 질문', 10, { visibility: 'private' });
    const shared = await ask(pet, '공개 질문', 5);
    const first = await reply(me.id, {
      replies: [
        { in_reply_to: secret, text: '비공개로 답할게요.', visibility: 'company' },
        { in_reply_to: shared, text: '첫 번째 부분이에요.' },
        { in_reply_to: shared, text: '세 번째 부분이에요.', part: 3 },
        { in_reply_to: shared, text: '두 번째 부분이에요.', part: 2, visibility: 'private' },
      ],
    });
    expect(first.accepted.map((a) => [a.index, a.result, a.visibility])).toEqual([
      [0, 'created', 'private'],
      [1, 'created', 'company'],
      [3, 'created', 'private'],
    ]);
    expect(first.rejected).toEqual([expect.objectContaining({ index: 2, reason: 'unknown_message' })]);

    const again = await reply(me.id, { replies: [{ in_reply_to: shared, text: '다른 글로 덮어쓰기' }] });
    expect(again.accepted).toEqual([
      expect.objectContaining({ result: 'duplicate', message_id: first.accepted[1]!.message_id }),
    ]);
    const parts = (await messagesOf(pet.id)).filter((m) => m.inReplyTo === shared);
    expect(parts.map((m) => [m.replyPart, m.body])).toEqual([
      [1, '첫 번째 부분이에요.'],
      [2, '두 번째 부분이에요.'],
    ]);
  });

  it("rejects text problems item by item and refuses what is not the connector's to answer", async () => {
    const me = await createTestUser(handle.db);
    const other = await createTestUser(handle.db);
    const pet = await defaultPet(me.id);
    const channelOnly = await extraPet(me.id, { replyRoute: 'channel' });
    const q = await ask(pet, '질문', 10);
    const held = await ask(pet, '채널이 잡은 질문', 5, {
      answerState: 'claimed',
      claimedBy: newOpaqueId(),
      claimUntil: new Date(Date.parse(THU_14) + 5 * MIN),
    });
    const routed = await ask(channelOnly, '채널 전용', 5);
    const theirs = await ask(await defaultPet(other.id), '남의 질문', 5);
    const out = await reply(me.id, {
      replies: [
        { in_reply_to: q, text: '010-1234-5678로 전화해 보세요' },
        { in_reply_to: q, text: 'https://example.com 을 참고하세요' },
        { in_reply_to: held, text: '답' },
        { in_reply_to: routed, text: '답' },
        { in_reply_to: theirs, text: '답' },
      ],
    });
    expect(out.accepted).toEqual([]);
    expect(out.rejected.map((r) => [r.index, r.reason])).toEqual([
      [0, 'pii'],
      [1, 'url'],
      [2, 'already_answered'],
      [3, 'route_not_allowed'],
      [4, 'unknown_message'],
    ]);
    expect(out.delivery_note).toContain('replies[0], replies[1]');
    expect((await messagesOf(pet.id)).filter((m) => m.author === 'pet')).toEqual([]);
    await settle();
    expect(listener.forUser(me.id).filter((e) => e.type === 'pet_thread_changed')).toEqual([]);
  });

  it('refuses connector replies outside office hours', async () => {
    const me = await createTestUser(handle.db);
    const q = await ask(await defaultPet(me.id), '저녁 질문', 0);
    h.clock.set(new Date(THU_21));
    const out = await reply(me.id, { replies: [{ in_reply_to: q, text: '내일 아침에 볼게요.' }] });
    expect(out.rejected).toEqual([expect.objectContaining({ index: 0, reason: 'outside_office_hours' })]);
  });

  it('lets the first lane win: the channel answers at night, the connector is refused the next day', async () => {
    const me = await createTestUser(handle.db);
    const pet = await defaultPet(me.id);
    const q = await ask(pet, '밤에 보낸 질문', -400);
    const tokenId = newOpaqueId();
    const night = new Date(THU_21);
    const [byChannel] = await postPetReplies(
      handle.db,
      { userId: me.id, clientId: 'enu-den-channel', source: 'claude_code_channel', tokenId },
      [{ inReplyTo: q, text: '채널에서 바로 답했어요.', part: 1 }],
      night,
    );
    expect(byChannel).toMatchObject({ ok: true, result: 'created' });
    h.clock.set(new Date('2026-10-30T01:00:00.000Z')); // Friday 10:00
    const out = await reply(me.id, { replies: [{ in_reply_to: q, text: '체크인에서 답할게요.' }] });
    expect(out.rejected).toEqual([expect.objectContaining({ reason: 'already_answered' })]);
    const rows = await messagesOf(pet.id);
    expect(rows.find((r) => r.id === q)).toMatchObject({ answerState: 'answered', answeredLane: 'channel' });
    expect(rows.filter((r) => r.author === 'pet').map((r) => [r.source, r.oauthClientId])).toEqual([
      ['claude_code_channel', null],
    ]);
  });

  it("lets a nudge name one of my pets and rejects anyone else's", async () => {
    const me = await createTestUser(handle.db);
    const other = await createTestUser(handle.db);
    const mine = await extraPet(me.id);
    const out = await callTool(await h.client(me.id), MCP_TOOL_NAMES.postPetNudges, {
      nudges: [
        { text: '리뷰 하나만 먼저 끝내 볼까요?', pet_id: mine.id },
        { text: '남의 펫으로 말하기', pet_id: (await defaultPet(other.id)).id },
        { text: '대표 펫이 말해요' },
      ],
    });
    const parsed = postPetNudgesOutput.parse(out.structured);
    expect(parsed.accepted).toBe(2);
    expect(parsed.rejected).toEqual([expect.objectContaining({ index: 1, reason: 'unknown_pet' })]);
    const rows = await handle.db.select().from(petNudges).where(eq(petNudges.userId, me.id));
    expect(rows.map((r) => [r.text, r.petId]).sort()).toEqual(
      [
        ['리뷰 하나만 먼저 끝내 볼까요?', mine.id],
        ['대표 펫이 말해요', null],
      ].sort(),
    );
  });
});
