import { chatMessages, dmReadState } from '@enu/db';
import type { ChatAckMsg, ChatMsg, DmMsg, DmUnreadMsg, EmoteMsg, PingedMsg } from '@enu/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AFTER_HOURS,
  joinAs,
  makeUser,
  serverRoom,
  sleep,
  startHarness,
  waitFor,
  type Harness,
  type Joined,
} from './helpers/server';

const PORT = 3313;
let h: Harness;

beforeAll(async () => {
  h = await startHarness(PORT);
});
afterAll(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.reset();
});

let n = 0;
const cid = () => `client-msg-${Date.now()}-${++n}`;

async function people() {
  const seats = { a: 'L1a', b: 'L1b', c: 'R2a', d: 'L4a', e: 'L4b', f: 'R3b' } as const;
  const users: Record<string, { id: string; name: string }> = {};
  const joined: Record<string, Joined> = {};
  for (const [k, deskId] of Object.entries(seats))
    users[k] = await makeUser(h, { name: `사람${k.toUpperCase()}`, deskId });
  for (const k of Object.keys(seats)) joined[k] = await joinAs(h, users[k]!.id);
  const all = Object.values(joined);
  await waitFor(
    () =>
      all.every((j) => Object.values(users).every((u) => j.room.state.players.get(u.id)?.online === true)),
    { message: 'everyone shown and online' },
  );
  return {
    u: users as Record<keyof typeof seats, { id: string; name: string }>,
    j: joined as Record<keyof typeof seats, Joined>,
  };
}

const got = (j: Joined, id: string) => j.inbox.of<ChatMsg>('chat:msg').some((m) => m.id === id);

describe('room chat', () => {
  it('room chat is broadcast to everyone and persisted (an old `channel` key is ignored)', async () => {
    const { u, j } = await people();
    j.c.room.send('chat:send', { text: '  전체 공지입니다\n둘째 줄  ', clientMsgId: cid() });
    const ack = await j.c.inbox.waitFor<ChatAckMsg>('chat:ack');
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      await waitFor(() => got(j[k], ack.id!), { message: `room chat at ${k}` });
    }
    const msg = j.a.inbox.of<ChatMsg>('chat:msg').find((m) => m.id === ack.id)!;
    expect(msg).toEqual({
      id: ack.id,
      kind: 'room',
      fromUserId: u.c.id,
      fromName: '사람C',
      text: '전체 공지입니다 둘째 줄',
      createdAt: expect.any(String),
    });
    const [row] = await h.db.select().from(chatMessages).where(eq(chatMessages.id, ack.id!));
    expect(row).toMatchObject({ kind: 'room', senderId: u.c.id, body: '전체 공지입니다 둘째 줄' });

    j.a.room.send('chat:send', { channel: 'nearby', text: '근처는 이제 없어요', clientMsgId: cid() });
    const ack2 = await j.a.inbox.waitFor<ChatAckMsg>('chat:ack');
    await waitFor(() => got(j.f, ack2.id!), { message: 'still a room message' });
    const [row2] = await h.db.select().from(chatMessages).where(eq(chatMessages.id, ack2.id!));
    expect(row2?.kind).toBe('room');
  });

  it('is idempotent on clientMsgId and rejects empty / over-long text', async () => {
    const { u, j } = await people();
    const clientMsgId = cid();
    j.a.room.send('chat:send', { text: '한 번만', clientMsgId });
    const first = await j.a.inbox.waitFor<ChatAckMsg>('chat:ack');
    j.a.room.send('chat:send', { text: '한 번만', clientMsgId });
    await waitFor(() => j.a.inbox.of('chat:ack').length === 2);
    const acks = j.a.inbox.of<ChatAckMsg>('chat:ack');
    expect(acks[1]).toEqual({ clientMsgId, id: first.id });
    await sleep(200);
    expect(j.b.inbox.of<ChatMsg>('chat:msg').filter((m) => m.id === first.id)).toHaveLength(1);
    const rows = await h.db.select().from(chatMessages).where(eq(chatMessages.senderId, u.a.id));
    expect(rows).toHaveLength(1);

    const zw = String.fromCharCode(0x200b);
    const emptyId = cid();
    j.a.room.send('chat:send', { text: `${zw} ${zw}`, clientMsgId: emptyId });
    expect(await j.a.inbox.waitFor<ChatAckMsg>('chat:ack', (m) => m.clientMsgId === emptyId)).toEqual({
      clientMsgId: emptyId,
      id: null,
      error: 'EMPTY',
    });
    const longId = cid();
    j.a.room.send('chat:send', { text: '가'.repeat(501), clientMsgId: longId });
    expect(await j.a.inbox.waitFor<ChatAckMsg>('chat:ack', (m) => m.clientMsgId === longId)).toMatchObject({
      id: null,
      error: 'TOO_LONG',
    });
  });

  it('limits chat to 5 messages per 10 seconds', async () => {
    const { j } = await people();
    const ids = Array.from({ length: 6 }, () => cid());
    for (const clientMsgId of ids) j.b.room.send('chat:send', { text: '도배', clientMsgId });
    await waitFor(() => j.b.inbox.of('chat:ack').length === 6);
    const acks = j.b.inbox.of<ChatAckMsg>('chat:ack');
    expect(acks.filter((a) => a.error === 'RATE_LIMITED')).toHaveLength(1);
  });

  it('room chat keeps working after office hours', async () => {
    const { u, j } = await people();
    h.clock.set(AFTER_HOURS);
    serverRoom(h, j.a).evaluateNow();
    await waitFor(() => j.a.room.state.officeOpen === false, { message: 'office closed' });
    j.a.room.send('chat:send', { text: '퇴근합니다', clientMsgId: cid() });
    const ack = await j.a.inbox.waitFor<ChatAckMsg>('chat:ack');
    await waitFor(() => got(j.b, ack.id!), { message: 'after-hours chat' });
    expect(j.b.room.state.players.get(u.a.id).shown).toBe(false);
  });
});

describe('direct messages', () => {
  it('persists, delivers to the target and echoes to the sender; unread counts follow dm:read', async () => {
    const { u, j } = await people();
    const clientMsgId = cid();
    j.a.room.send('dm:send', { toUserId: u.c.id, text: '안녕하세요\n두 줄 DM', clientMsgId });
    const ack = await j.a.inbox.waitFor<ChatAckMsg>('chat:ack');
    expect(ack.id).toBeTruthy();
    const atC = await j.c.inbox.waitFor<DmMsg>('dm:msg');
    expect(atC).toMatchObject({
      id: ack.id,
      fromUserId: u.a.id,
      toUserId: u.c.id,
      text: '안녕하세요\n두 줄 DM',
      fromName: '사람A',
    });
    await j.a.inbox.waitFor<DmMsg>('dm:msg', (m) => m.id === ack.id);
    await sleep(150);
    expect(j.b.inbox.of('dm:msg')).toHaveLength(0);

    const [row] = await h.db.select().from(chatMessages).where(eq(chatMessages.id, ack.id!));
    const [lo, hi] = [u.a.id, u.c.id].sort();
    expect(row).toMatchObject({ kind: 'dm', dmLow: lo, dmHigh: hi, senderId: u.a.id });

    j.c.room.send('dm:read', { peerUserId: u.a.id, lastMessageId: ack.id! });
    const unread = await j.c.inbox.waitFor<DmUnreadMsg>(
      'dm:unread',
      (m) => m.total === 0 && j.c.inbox.of('dm:unread').length >= 2,
    );
    expect(unread).toEqual({ total: 0, byPeer: {} });
    const [state] = await h.db.select().from(dmReadState).where(eq(dmReadState.userId, u.c.id));
    expect(state?.peerId).toBe(u.a.id);
    expect(state?.lastReadAt.getTime()).toBe(row!.createdAt.getTime());
  });

  it('DMs to offline users are stored and counted as unread when they join; unknown targets are refused', async () => {
    const a = await makeUser(h, { deskId: 'L2a' });
    const g = await makeUser(h, { name: '오프라인', deskId: 'L2b' });
    const ja = await joinAs(h, a.id);
    for (const text of ['첫 번째', '두 번째']) {
      ja.room.send('dm:send', { toUserId: g.id, text, clientMsgId: cid() });
      await sleep(50);
    }
    await waitFor(() => ja.inbox.of<ChatAckMsg>('chat:ack').filter((x) => x.id).length === 2);
    const missing = cid();
    ja.room.send('dm:send', {
      toUserId: '0190ffff-0000-7000-8000-00000000dead',
      text: '누구세요',
      clientMsgId: missing,
    });
    expect(await ja.inbox.waitFor<ChatAckMsg>('chat:ack', (m) => m.clientMsgId === missing)).toEqual({
      clientMsgId: missing,
      id: null,
      error: 'NOT_FOUND',
    });
    const jg = await joinAs(h, g.id);
    const unread = await jg.inbox.waitFor<DmUnreadMsg>('dm:unread');
    expect(unread).toEqual({ total: 2, byPeer: { [a.id]: 2 } });
  });
});

describe('social', () => {
  it('a wave is broadcast to everyone; a ping reaches its target once per 30 s', async () => {
    const { u, j } = await people();
    j.a.room.send('social:wave', { toUserId: u.c.id });
    const wave = { fromUserId: u.a.id, toUserId: u.c.id, kind: 'wave' };
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const)
      expect(await j[k].inbox.waitFor<EmoteMsg>('emote')).toEqual(wave);
    j.a.room.send('social:wave', { toUserId: u.c.id });
    expect(await j.a.inbox.waitFor('error')).toEqual({ code: 'RATE_LIMITED', type: 'social:wave' });

    j.a.room.send('social:ping', { toUserId: u.c.id });
    expect(await j.c.inbox.waitFor<PingedMsg>('social:pinged')).toEqual({
      fromUserId: u.a.id,
      fromName: '사람A',
    });
    j.a.room.send('social:ping', { toUserId: u.c.id });
    expect(await j.a.inbox.waitFor('error', (e: { type: string }) => e.type === 'social:ping')).toEqual({
      code: 'RATE_LIMITED',
      type: 'social:ping',
    });
    expect(j.c.inbox.of('social:pinged')).toHaveLength(1);
    // pings are participant-only
    await sleep(150);
    expect(j.b.inbox.of('social:pinged')).toHaveLength(0);
  });
});
