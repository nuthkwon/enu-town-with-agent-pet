import { newId, newOpaqueId, notifyTown, petNudges, pets, profiles, todos } from '@enu/db';
import { Indicator, PlateNote, SourceCode, type ErrorMsg } from '@enu/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AFTER_HOURS,
  joinAs,
  kst,
  makeUser,
  serverRoom,
  setReport,
  sleep,
  startHarness,
  waitFor,
  type Harness,
  type Joined,
  petOf,
} from './helpers/server';

const PORT = 3316;
const MIN = 60_000;
let h: Harness;

beforeAll(async () => {
  h = await startHarness(PORT, { NUDGE_JOIN_DELAY_MS: '200', NUDGE_IGNORE_QUIET_HOURS: 'true' });
});
afterAll(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.reset();
});

async function nudgeFor(userId: string, text: string): Promise<void> {
  const now = h.clock.now();
  await h.db.insert(petNudges).values({
    id: newId(),
    userId,
    text,
    priority: 2,
    showAfter: new Date(now.getTime() - MIN),
    expiresAt: new Date(now.getTime() + 2 * 60 * MIN),
  });
}

/** Records every decoded value of `pets[ownerId].indicator` after each state patch. */
function watchIndicator(j: Joined, ownerId: string): number[] {
  const seen: number[] = [];
  j.room.onStateChange((state: { pets: Map<string, { ownerId?: string; indicator?: number }> }) => {
    // Every pet of the owner (keyed by pet id since protocol 3).
    state.pets.forEach((pet) => {
      if (pet.ownerId === ownerId && pet.indicator !== undefined) seen.push(pet.indicator);
    });
  });
  return seen;
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let k = 0; k < needle.length; k++) if (haystack[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

const NEUTRAL = {
  shown: false,
  online: false,
  activity: 0,
  source: 0,
  until: 0,
  note: 0,
  groupId: '',
  statusText: '',
};

describe('pet bubbles stay owner-only', () => {
  it("B decodes no bubble fields of A's pet (not even `…`), and A's text bytes never appear in B's frames", async () => {
    const a = await makeUser(h, { deskId: 'L1a', linkState: 'linked' });
    const b = await makeUser(h, { deskId: 'L1b' });
    const text = '비밀 넛지 문구 SQA-4242 확인';
    await nudgeFor(a.id, text);
    const bFrames: Uint8Array[] = [];
    const aFrames: Uint8Array[] = [];
    const jb = await joinAs(h, b.id, { frames: bFrames });
    const seen = watchIndicator(jb, a.id);
    const ja = await joinAs(h, a.id, { frames: aFrames });
    await waitFor(() => petOf(ja.room.state, a.id)?.bubbleText === text, { message: 'owner bubble' });
    await sleep(400);
    const otherPet = petOf(jb.room.state, a.id);
    expect(otherPet.bubbleText ?? '').toBe('');
    expect(otherPet.bubbleId ?? '').toBe('');
    expect(otherPet.bubbleUntil ?? 0).toBe(0);
    const bytes = new TextEncoder().encode('SQA-4242');
    expect(aFrames.some((f) => contains(f, bytes))).toBe(true); // control: the owner did receive it
    expect(bFrames.length).toBeGreaterThan(0);
    expect(bFrames.some((f) => contains(f, bytes))).toBe(false);
    // The shared indicator never moves: a bubble starts only while A's tab is visible (ADR 0004 D2).
    expect(seen.length).toBeGreaterThan(0); // control: the recorder sees A's pet
    expect(seen).not.toContain(Indicator.Dots);
  });

  it('A with 접속 표시 off and a manual 대화 가능: B never decodes `…`, so B cannot tell A has the town open', async () => {
    const a = await makeUser(h, { deskId: 'L1a', linkState: 'linked', showLive: false });
    const b = await makeUser(h, { deskId: 'L1b' });
    await h.db
      .update(profiles)
      .set({ manualStatus: 'available', manualStatusUntil: new Date(h.clock.now().getTime() + 120 * MIN) })
      .where(eq(profiles.userId, a.id));
    const text = '접속 표시를 끈 사람의 넛지';
    await nudgeFor(a.id, text);
    const jb = await joinAs(h, b.id);
    const seen = watchIndicator(jb, a.id);
    const ja = await joinAs(h, a.id);
    await waitFor(() => petOf(ja.room.state, a.id)?.bubbleText === text, { message: 'owner bubble' });
    await sleep(600);
    expect(jb.room.state.players.get(a.id)).toMatchObject({ shown: true, online: false });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(Indicator.Dots);
  });

  it('A leaves while a bubble is up (manual 대화 가능 keeps A shown): no `…` afterwards, and no old text at 20:00', async () => {
    const a = await makeUser(h, { deskId: 'L2a', linkState: 'linked' });
    const b = await makeUser(h, { deskId: 'L2b' });
    await h.db
      .update(profiles)
      .set({ manualStatus: 'available', manualStatusUntil: new Date(h.clock.now().getTime() + 120 * MIN) })
      .where(eq(profiles.userId, a.id));
    const text = '떠난 뒤에 남으면 안 되는 넛지';
    await nudgeFor(a.id, text);
    const jb = await joinAs(h, b.id);
    const ja = await joinAs(h, a.id);
    await waitFor(() => petOf(ja.room.state, a.id)?.bubbleText === text, { message: 'owner bubble' });
    const seen = watchIndicator(jb, a.id);
    const room = serverRoom(h, jb);
    await ja.room.leave();
    await waitFor(() => !room.connectedUserIds.includes(a.id), { message: 'A left' });
    room.evaluateNow();
    await sleep(600);
    expect(jb.room.state.players.get(a.id).shown).toBe(true); // still drawn through the manual status
    expect(seen).not.toContain(Indicator.Dots);
    expect(room.townDirector.pet(a.id)).toMatchObject({
      bubbleId: '',
      bubbleText: '',
      indicator: Indicator.None,
    });

    h.clock.set(AFTER_HOURS);
    room.evaluateNow();
    const again = await joinAs(h, a.id);
    await sleep(400);
    const pet = petOf(again.room.state, a.id);
    expect(pet.bubbleText).toBe('');
    expect(pet.bubbleId).toBe('');
    expect(pet.bubbleUntil).toBe(0);
  });

  for (const [label, prepare] of [
    [
      'calendar away',
      async (id: string) => {
        await setReport(h, id, {
          schedule: [
            { start: kst(2026, 10, 28, 9, 0), end: kst(2026, 10, 28, 18, 0), kind: 'away', refHash: null },
          ],
        });
      },
    ],
    [
      'manual away',
      async (id: string) => {
        await h.db
          .update(profiles)
          .set({ manualStatus: 'away', manualStatusUntil: new Date(h.clock.now().getTime() + 60 * MIN) })
          .where(eq(profiles.userId, id));
      },
    ],
    [
      'show_live=false',
      async (id: string) => {
        await h.db.update(profiles).set({ showLive: false }).where(eq(profiles.userId, id));
      },
    ],
  ] as const) {
    it(`B never decodes A's indicator = Dots while A is hidden (${label}), even while A sees a bubble`, async () => {
      const a = await makeUser(h, { deskId: 'L2a', linkState: 'linked', shareActivity: true });
      const b = await makeUser(h, { deskId: 'L2b' });
      await prepare(a.id);
      const text = `숨어 있을 때의 넛지 (${label})`;
      await nudgeFor(a.id, text);
      const jb = await joinAs(h, b.id);
      const seen = watchIndicator(jb, a.id);
      const ja = await joinAs(h, a.id);
      await waitFor(() => petOf(ja.room.state, a.id)?.bubbleText === text, { message: 'owner bubble' });
      expect(ja.room.state.players.get(a.id).shown).toBe(false);
      await sleep(600);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen).not.toContain(Indicator.Dots);
      expect(petOf(jb.room.state, a.id).indicator).toBe(Indicator.None);
      expect(jb.room.state.players.get(a.id)).toMatchObject({ shown: false, online: false });
    });
  }

  it('at fake 20:00 every Player is neutral for both clients and a due to-do shows no bubble (forced quiet)', async () => {
    h.clock.set(AFTER_HOURS);
    const a = await makeUser(h, { deskId: 'L3a', linkState: 'linked', shareActivity: true });
    const b = await makeUser(h, { deskId: 'L3b' });
    await h.db
      .update(profiles)
      .set({
        manualStatus: 'available',
        manualStatusUntil: new Date(h.clock.now().getTime() + 60 * MIN),
        statusText: '야근 중',
      })
      .where(eq(profiles.userId, a.id));
    await h.db.insert(todos).values({
      id: newId(),
      userId: a.id,
      externalRef: 'jira:SQA-9',
      title: '마감 임박 할 일',
      dueAt: new Date(h.clock.now().getTime() + 4 * MIN),
      priority: 1,
    });
    await nudgeFor(a.id, '밤에는 조용히');
    const jb = await joinAs(h, b.id);
    const seen = watchIndicator(jb, a.id);
    const ja = await joinAs(h, a.id);
    await sleep(1500);
    for (const j of [ja, jb]) {
      expect(j.room.state.officeOpen).toBe(false);
      for (const id of [a.id, b.id]) expect(j.room.state.players.get(id)).toMatchObject(NEUTRAL);
    }
    expect(petOf(ja.room.state, a.id).bubbleText).toBe('');
    expect(seen).not.toContain(Indicator.Dots);
    // waves need the office open; pings need someone online
    ja.room.send('social:wave', { toUserId: b.id });
    expect(await ja.inbox.waitFor<ErrorMsg>('error')).toEqual({ code: 'NOT_SHOWN', type: 'social:wave' });
  });

  it('a calendar away block: B decodes 부재 with until=0 and source=None', async () => {
    const a = await makeUser(h, { deskId: 'L4a', shareActivity: true });
    const b = await makeUser(h, { deskId: 'L4b' });
    await setReport(h, a.id, {
      schedule: [
        { start: kst(2026, 10, 28, 9, 0), end: kst(2026, 10, 28, 15, 0), kind: 'away', refHash: null },
      ],
    });
    await joinAs(h, a.id);
    const jb = await joinAs(h, b.id);
    await sleep(300);
    expect(jb.room.state.players.get(a.id)).toMatchObject({
      shown: false,
      online: false,
      note: PlateNote.Absent,
      until: 0,
      source: SourceCode.None,
      activity: 0,
      statusText: '',
    });
  });
});

describe('interactions never leak who is connected or who talks to whom', () => {
  it('ping parity: hidden-but-connected, disconnected, unknown and in-grace targets all answer the same NOT_ONLINE', async () => {
    const sender = await makeUser(h, { deskId: 'L1a', name: '보내는 사람' });
    const hidden = await makeUser(h, { deskId: 'L1b' });
    const noLive = await makeUser(h, { deskId: 'L2a', showLive: false });
    const offline = await makeUser(h, { deskId: 'L2b' });
    const grace = await makeUser(h, { deskId: 'L3a' });
    const online = await makeUser(h, { deskId: 'L3b' });
    await h.db
      .update(profiles)
      .set({ manualStatus: 'away', manualStatusUntil: new Date(h.clock.now().getTime() + 60 * MIN) })
      .where(eq(profiles.userId, hidden.id));
    const js = await joinAs(h, sender.id);
    const jh = await joinAs(h, hidden.id);
    const jn = await joinAs(h, noLive.id);
    const jg = await joinAs(h, grace.id);
    const jo = await joinAs(h, online.id);
    await waitFor(() => js.room.state.players.get(grace.id)?.online === true, { message: 'grace online' });
    await waitFor(() => js.room.state.players.get(online.id)?.online === true, { message: 'online' });
    await jg.room.leave();
    await waitFor(() => js.room.state.players.get(grace.id)?.online === false, { message: 'grace' });
    expect(js.room.state.players.get(grace.id).shown).toBe(true);

    const targets = [
      hidden.id,
      noLive.id,
      offline.id,
      '0190ffff-0000-7000-8000-00000000dead',
      grace.id,
      sender.id,
    ];
    for (const toUserId of targets) js.room.send('social:ping', { toUserId });
    await waitFor(() => js.inbox.of<ErrorMsg>('error').length === targets.length, { message: 'answers' });
    const answers = js.inbox.of<ErrorMsg>('error');
    for (const a of answers) expect(a).toEqual({ code: 'NOT_ONLINE', type: 'social:ping' });
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    await sleep(200);
    expect(jh.inbox.of('social:pinged')).toHaveLength(0);
    expect(jn.inbox.of('social:pinged')).toHaveLength(0);

    js.room.send('social:ping', { toUserId: online.id });
    expect(await jo.inbox.waitFor('social:pinged')).toEqual({
      fromUserId: sender.id,
      fromName: '보내는 사람',
    });
  });

  it('a wave to (or from) someone hidden answers NOT_SHOWN and reaches nobody', async () => {
    const a = await makeUser(h, { deskId: 'R2a' });
    const b = await makeUser(h, { deskId: 'R2b' });
    const away = await makeUser(h, { deskId: 'R3b' });
    await h.db
      .update(profiles)
      .set({ manualStatus: 'away', manualStatusUntil: new Date(h.clock.now().getTime() + 60 * MIN) })
      .where(eq(profiles.userId, away.id));
    const ja = await joinAs(h, a.id);
    const jb = await joinAs(h, b.id);
    const jw = await joinAs(h, away.id);
    ja.room.send('social:wave', { toUserId: away.id });
    expect(await ja.inbox.waitFor<ErrorMsg>('error')).toEqual({ code: 'NOT_SHOWN', type: 'social:wave' });
    jw.room.send('social:wave', { toUserId: a.id });
    expect(await jw.inbox.waitFor<ErrorMsg>('error')).toEqual({ code: 'NOT_SHOWN', type: 'social:wave' });
    await sleep(200);
    for (const j of [ja, jb, jw]) expect(j.inbox.of('emote')).toHaveLength(0);
    expect(serverRoom(h, ja).connectedUserIds).toHaveLength(3);
  });

  it('a DM produces no message at a third client', async () => {
    const a = await makeUser(h, { deskId: 'L5a' });
    const b = await makeUser(h, { deskId: 'L5b' });
    const c = await makeUser(h, { deskId: 'R1' });
    const ja = await joinAs(h, a.id);
    const jb = await joinAs(h, b.id);
    const jc = await joinAs(h, c.id);
    ja.room.send('dm:send', { toUserId: b.id, text: '업무 요청 드려요', clientMsgId: `dm-${Date.now()}-1` });
    await jb.inbox.waitFor('dm:msg');
    await ja.inbox.waitFor('dm:msg');
    await sleep(300);
    expect(jc.inbox.of('dm:msg')).toHaveLength(0);
    expect(jc.inbox.all.filter((m) => m.type !== 'dm:unread')).toHaveLength(0);
  });
});

describe('several pets per person', () => {
  /** Every pet of `ownerId` in a decoded or server state, by slot. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const petsOf = (state: any, ownerId: string): any[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.pets.forEach((p: any) => p.ownerId === ownerId && out.push(p));
    return out.sort((x, y) => x.slot - y.slot);
  };

  it('shows a nudge on the pet it names, only to the owner, and pets added later reach both views', async () => {
    const a = await makeUser(h, { deskId: 'L3a', linkState: 'linked' });
    const b = await makeUser(h, { deskId: 'L3b' });
    const second = newOpaqueId();
    await h.db.insert(pets).values({
      id: second,
      userId: a.id,
      name: '리뷰봇',
      species: 'owl',
      tint: 'mint',
      isDefault: false,
      sortOrder: 1,
    });
    const text = '리뷰봇이 알려 주는 넛지';
    const now = h.clock.now();
    await h.db.insert(petNudges).values({
      id: newId(),
      userId: a.id,
      petId: second,
      text,
      priority: 2,
      showAfter: new Date(now.getTime() - MIN),
      expiresAt: new Date(now.getTime() + 2 * 60 * MIN),
    });
    const bFrames: Uint8Array[] = [];
    const jb = await joinAs(h, b.id, { frames: bFrames });
    const ja = await joinAs(h, a.id);
    await waitFor(() => petsOf(ja.room.state, a.id)[1]?.bubbleText === text, {
      message: 'bubble on the second pet',
    });
    const [lead, owl] = petsOf(ja.room.state, a.id);
    expect(lead.bubbleText ?? '').toBe('');
    expect(owl).toMatchObject({ petId: second, slot: 1, species: 'owl', tint: 'mint', name: '리뷰봇' });
    const seenByB = petsOf(jb.room.state, a.id);
    expect(seenByB.map((p) => p.petId)).toEqual([lead.petId, second]);
    for (const p of seenByB) expect(p.bubbleText ?? '').toBe('');
    expect(bFrames.some((f) => contains(f, new TextEncoder().encode(text)))).toBe(false);

    const third = newOpaqueId();
    await h.db.insert(pets).values({
      id: third,
      userId: a.id,
      name: '셋째',
      species: 'frog',
      tint: 'sky',
      isDefault: false,
      sortOrder: 2,
    });
    await notifyTown(h.db, { v: 1, type: 'pets_changed', user_id: a.id });
    await waitFor(() => petsOf(jb.room.state, a.id).length === 3, { message: 'colleague sees the new pet' });
    await waitFor(() => petsOf(ja.room.state, a.id).length === 3, { message: 'owner sees the new pet' });
    await h.db.delete(pets).where(eq(pets.id, second));
    await notifyTown(h.db, { v: 1, type: 'pets_changed', user_id: a.id });
    await waitFor(() => petsOf(jb.room.state, a.id).length === 2, { message: 'removed pet leaves' });
    expect(petsOf(jb.room.state, a.id).map((p) => p.slot)).toEqual([0, 1]);
  });
});
