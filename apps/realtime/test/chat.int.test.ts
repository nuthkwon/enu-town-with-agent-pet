import { chatMessageRecipients, chatMessages, dmReadState } from '@enu/db';
import type { ChatAckMsg, ChatMsg, DmMsg, DmUnreadMsg, EmoteMsg, PingedMsg } from '@enu/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { joinAs, makeUser, sleep, startHarness, waitFor, type Harness, type Joined } from './helpers/server';

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
  const spots = {
    a: { x: 9, y: 10 },
    b: { x: 11, y: 10 }, // 2 tiles from a
    c: { x: 20, y: 10 }, // 11 tiles from a
    d: { x: 2, y: 19 }, // meeting room
    e: { x: 8, y: 21 }, // meeting room, ~6.3 tiles from d
    f: { x: 9, y: 19 }, // aisle right outside the meeting room, ~2.2 tiles from e
  } as const;
  const users: Record<string, { id: string; name: string }> = {};
  const joined: Record<string, Joined> = {};
  for (const [k, at] of Object.entries(spots))
    users[k] = await makeUser(h, { name: `사람${k.toUpperCase()}`, at });
  for (const k of Object.keys(spots)) joined[k] = await joinAs(h, users[k]!.id);
  const all = Object.values(joined);
  await waitFor(() => all.every((j) => j.room.state.players.size === 6), { message: 'everyone visible' });
  return {
    u: users as Record<keyof typeof spots, { id: string; name: string }>,
    j: joined as Record<keyof typeof spots, Joined>,
  };
}

const got = (j: Joined, id: string) => j.inbox.of<ChatMsg>('chat:msg').some((m) => m.id === id);

describe('nearby and room chat', () => {
  it('nearby chat reaches people within the radius only and records the recipients', async () => {
    const { u, j } = await people();
    const clientMsgId = cid();
    j.a.room.send('chat:send', { channel: 'nearby', text: '  안녕하세요\n근처 분들  ', clientMsgId });
    const ack = await j.a.inbox.waitFor<ChatAckMsg>('chat:ack');
    expect(ack.clientMsgId).toBe(clientMsgId);
    expect(ack.id).toBeTruthy();
    const msg = await j.b.inbox.waitFor<ChatMsg>('chat:msg');
    expect(msg).toMatchObject({
      id: ack.id,
      kind: 'nearby',
      fromUserId: u.a.id,
      fromName: '사람A',
      text: '안녕하세요 근처 분들',
      zoneId: null,
    });
    expect(got(j.a, ack.id!)).toBe(true);
    await sleep(200);
    for (const k of ['c', 'd', 'e', 'f'] as const) expect(got(j[k], ack.id!)).toBe(false);

    const [row] = await h.db.select().from(chatMessages).where(eq(chatMessages.id, ack.id!));
    expect(row).toMatchObject({
      kind: 'nearby',
      senderId: u.a.id,
      body: '안녕하세요 근처 분들',
      clientMsgId,
      zoneId: null,
    });
    const recips = await h.db
      .select()
      .from(chatMessageRecipients)
      .where(eq(chatMessageRecipients.messageId, ack.id!));
    expect(recips.map((r) => r.userId).sort()).toEqual([u.a.id, u.b.id].sort());
  });

  it('the meeting room is isolated: everyone inside hears each other, nobody outside', async () => {
    const { u, j } = await people();
    j.e.room.send('chat:send', { channel: 'nearby', text: '회의 시작할게요', clientMsgId: cid() });
    const ack = await j.e.inbox.waitFor<ChatAckMsg>('chat:ack');
    const msg = await j.d.inbox.waitFor<ChatMsg>('chat:msg');
    expect(msg).toMatchObject({ id: ack.id, zoneId: 'meeting' });
    await sleep(200);
    expect(got(j.f, ack.id!)).toBe(false);
    expect(got(j.a, ack.id!)).toBe(false);
    const recips = await h.db
      .select()
      .from(chatMessageRecipients)
      .where(eq(chatMessageRecipients.messageId, ack.id!));
    expect(recips.map((r) => r.userId).sort()).toEqual([u.d.id, u.e.id].sort());

    j.f.room.send('chat:send', { channel: 'nearby', text: '밖에서 말하기', clientMsgId: cid() });
    const outside = await j.f.inbox.waitFor<ChatAckMsg>('chat:ack');
    await sleep(200);
    expect(got(j.e, outside.id!)).toBe(false);
    expect(got(j.d, outside.id!)).toBe(false);
  });

  it('room chat is broadcast to everyone and persisted', async () => {
    const { u, j } = await people();
    j.c.room.send('chat:send', { channel: 'room', text: '전체 공지입니다', clientMsgId: cid() });
    const ack = await j.c.inbox.waitFor<ChatAckMsg>('chat:ack');
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      await waitFor(() => got(j[k], ack.id!), { message: `room chat at ${k}` });
    }
    const [row] = await h.db.select().from(chatMessages).where(eq(chatMessages.id, ack.id!));
    expect(row).toMatchObject({ kind: 'room', senderId: u.c.id, zoneId: null });
  });

  it('is idempotent on clientMsgId and rejects empty / over-long text', async () => {
    const { u, j } = await people();
    const clientMsgId = cid();
    j.a.room.send('chat:send', { channel: 'room', text: '한 번만', clientMsgId });
    const first = await j.a.inbox.waitFor<ChatAckMsg>('chat:ack');
    j.a.room.send('chat:send', { channel: 'room', text: '한 번만', clientMsgId });
    await waitFor(() => j.a.inbox.of('chat:ack').length === 2);
    const acks = j.a.inbox.of<ChatAckMsg>('chat:ack');
    expect(acks[1]).toEqual({ clientMsgId, id: first.id });
    await sleep(200);
    expect(j.b.inbox.of<ChatMsg>('chat:msg').filter((m) => m.id === first.id)).toHaveLength(1);
    const rows = await h.db.select().from(chatMessages).where(eq(chatMessages.senderId, u.a.id));
    expect(rows).toHaveLength(1);

    const zw = String.fromCharCode(0x200b);
    const emptyId = cid();
    j.a.room.send('chat:send', { channel: 'room', text: `${zw} ${zw}`, clientMsgId: emptyId });
    expect(await j.a.inbox.waitFor<ChatAckMsg>('chat:ack', (m) => m.clientMsgId === emptyId)).toEqual({
      clientMsgId: emptyId,
      id: null,
      error: 'EMPTY',
    });
    const longId = cid();
    j.a.room.send('chat:send', { channel: 'room', text: '가'.repeat(501), clientMsgId: longId });
    expect(await j.a.inbox.waitFor<ChatAckMsg>('chat:ack', (m) => m.clientMsgId === longId)).toMatchObject({
      id: null,
      error: 'TOO_LONG',
    });
  });

  it('limits chat to 5 messages per 10 seconds', async () => {
    const { j } = await people();
    const ids = Array.from({ length: 6 }, () => cid());
    for (const clientMsgId of ids)
      j.b.room.send('chat:send', { channel: 'nearby', text: '도배', clientMsgId });
    await waitFor(() => j.b.inbox.of('chat:ack').length === 6);
    const acks = j.b.inbox.of<ChatAckMsg>('chat:ack');
    expect(acks.filter((a) => a.error === 'RATE_LIMITED')).toHaveLength(1);
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
    const a = await makeUser(h, { at: { x: 9, y: 10 } });
    const g = await makeUser(h, { name: '오프라인' });
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
  it('wave reaches nearby people; ping reaches its target once per 30 s', async () => {
    const { u, j } = await people();
    j.a.room.send('social:wave', {});
    expect(await j.b.inbox.waitFor<EmoteMsg>('emote')).toEqual({ fromUserId: u.a.id, kind: 'wave' });
    await j.a.inbox.waitFor<EmoteMsg>('emote');
    await sleep(150);
    expect(j.c.inbox.of('emote')).toHaveLength(0);

    j.a.room.send('social:ping', { toUserId: u.c.id });
    expect(await j.c.inbox.waitFor<PingedMsg>('social:pinged')).toEqual({
      fromUserId: u.a.id,
      fromName: '사람A',
    });
    j.a.room.send('social:ping', { toUserId: u.c.id });
    expect(await j.a.inbox.waitFor('error')).toEqual({ code: 'RATE_LIMITED', type: 'social:ping' });
    expect(j.c.inbox.of('social:pinged')).toHaveLength(1);
  });
});
