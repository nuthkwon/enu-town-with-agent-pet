import { notifyTown, newId, nudgeDeliveries, petNudges, profiles, todos } from '@enu/db';
import { BubbleKind, Indicator } from '@enu/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  joinAs,
  kst,
  makeUser,
  serverRoom,
  sleep,
  startHarness,
  waitFor,
  type Harness,
} from './helpers/server';

const PORT = 3314;
const MIN = 60_000;
let h: Harness;

beforeAll(async () => {
  h = await startHarness(PORT, { NUDGE_JOIN_DELAY_MS: '300', NUDGE_TICK_MS: '100' });
});
afterAll(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.reset();
});

async function insertNudge(
  userId: string,
  text: string,
  over: Partial<typeof petNudges.$inferInsert> = {},
): Promise<string> {
  const now = h.clock.now();
  const id = newId();
  await h.db.insert(petNudges).values({
    id,
    userId,
    text,
    kind: 'reminder',
    priority: 2,
    showAfter: new Date(now.getTime() - MIN),
    expiresAt: new Date(now.getTime() + 2 * 60 * MIN),
    ...over,
  });
  return id;
}

describe('pet bubbles (nudges)', () => {
  it('shows a linked owner their Claude text; others see nothing; the DB records the delivery (no trigger)', async () => {
    const owner = await makeUser(h, { linkState: 'linked', deskId: 'L1a' });
    const other = await makeUser(h, { linkState: 'linked', deskId: 'L1b' });
    const text = '오후 2시 SQA 검토 회의 자료를 미리 열어 두면 좋겠어요.';
    const nudgeId = await insertNudge(owner.id, text);
    const jo = await joinAs(h, owner.id);
    const jx = await joinAs(h, other.id);

    const ownPet = () => jo.room.state.pets.get(owner.id);
    await waitFor(() => ownPet()?.bubbleText === text, { message: 'owner bubble' });
    expect(ownPet().bubbleId).toBe(nudgeId);
    expect(ownPet().bubbleKind).toBe(BubbleKind.Nudge);
    expect(ownPet().bubbleDueAt).toBe(0);
    expect(ownPet().indicator).toBe(Indicator.None); // shared: never `…`
    expect(ownPet().bubbleUntil).toBeGreaterThan(h.clock.now().getTime());

    // StateView isolation: the other client gets neither the text nor any sign that a bubble is up.
    const seenByOther = () => jx.room.state.pets.get(owner.id);
    await sleep(300);
    expect(seenByOther().indicator).toBe(Indicator.None);
    expect(seenByOther().bubbleText ?? '').toBe('');
    expect(seenByOther().bubbleId ?? '').toBe('');
    expect(seenByOther().bubbleText).toBeUndefined();
    // ...and the owner does not see the other's (empty) private fields either way
    expect(jo.room.state.pets.get(other.id).bubbleText).toBeUndefined();

    await waitFor(
      async () => {
        const [n] = await h.db.select().from(petNudges).where(eq(petNudges.id, nudgeId));
        return n?.showCount === 1 && n.status === 'shown' && n.lastShownAt !== null;
      },
      { message: 'pet_nudges updated' },
    );
    const deliveries = await h.db.select().from(nudgeDeliveries).where(eq(nudgeDeliveries.userId, owner.id));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ nudgeId, todoId: null, dueKey: null });
    // No trigger is stored: join / glance rows would say when the owner opened the town or came back to it.
    expect(deliveries[0]).not.toHaveProperty('trigger');

    // Acked via REST elsewhere -> NOTIFY -> the bubble is taken down.
    await h.db
      .update(petNudges)
      .set({ status: 'acked', ackedAt: new Date() })
      .where(eq(petNudges.id, nudgeId));
    await notifyTown(h.db, { v: 1, type: 'nudges_changed', user_id: owner.id });
    await waitFor(() => ownPet().bubbleText === '' && ownPet().indicator === Indicator.None, {
      message: 'bubble cleared',
    });
    await waitFor(() => seenByOther().indicator === Indicator.None, { message: 'indicator cleared' });
    expect(ownPet().bubbleId).toBe('');
    expect(ownPet().bubbleUntil).toBe(0);
  });

  it('never shows anything for a pet that is not linked', async () => {
    const owner = await makeUser(h, { linkState: 'not_linked', deskId: 'L2a' });
    await insertNudge(owner.id, '연결 안 된 펫은 말하지 않아요');
    const jo = await joinAs(h, owner.id);
    await sleep(1200);
    const pet = jo.room.state.pets.get(owner.id);
    expect(pet.bubbleText).toBe('');
    expect(pet.indicator).toBe(Indicator.None);
    expect(
      await h.db.select().from(nudgeDeliveries).where(eq(nudgeDeliveries.userId, owner.id)),
    ).toHaveLength(0);
  });

  it('respects quiet hours (fake clock) and shows the bubble once work hours start', async () => {
    h.clock.set(kst(2026, 10, 28, 21, 0));
    const owner = await makeUser(h, { linkState: 'linked', deskId: 'L2b' });
    const text = '내일 아침에 다시 알려 드릴게요';
    await insertNudge(owner.id, text, { expiresAt: kst(2026, 10, 29, 19, 0) });
    const jo = await joinAs(h, owner.id);
    await sleep(1200);
    expect(jo.room.state.pets.get(owner.id).bubbleText).toBe('');
    h.clock.set(kst(2026, 10, 29, 9, 0));
    await waitFor(() => jo.room.state.pets.get(owner.id).bubbleText === text, {
      message: 'bubble after quiet hours',
    });
  });

  it('a to-do entering its due window shows the to-do title with the due time outside the text', async () => {
    const owner = await makeUser(h, { linkState: 'linked', deskId: 'L3a' });
    const dueAt = new Date(h.clock.now().getTime() + 4 * MIN);
    const todoId = newId();
    await h.db.insert(todos).values({
      id: todoId,
      userId: owner.id,
      externalRef: 'jira:SQA-1',
      title: 'V&V 보고서 제출',
      dueAt,
      priority: 1,
    });
    const jo = await joinAs(h, owner.id);
    const pet = () => jo.room.state.pets.get(owner.id);
    await waitFor(() => pet().bubbleText === 'V&V 보고서 제출', { message: 'due bubble' });
    expect(pet().bubbleKind).toBe(BubbleKind.TodoDue);
    expect(pet().bubbleDueAt).toBe(dueAt.getTime());
    await waitFor(
      async () =>
        (await h.db.select().from(nudgeDeliveries).where(eq(nudgeDeliveries.todoId, todoId))).length === 1,
    );
    const [d] = await h.db.select().from(nudgeDeliveries).where(eq(nudgeDeliveries.todoId, todoId));
    expect(d).toMatchObject({ dueKey: `${todoId}:5` });

    await h.db.update(todos).set({ status: 'done', statusSource: 'user' }).where(eq(todos.id, todoId));
    await notifyTown(h.db, { v: 1, type: 'todos_changed', user_id: owner.id });
    await waitFor(() => pet().bubbleText === '', { message: 'due bubble cleared' });
  });

  it('a hidden tab postpones the bubble until the tab is visible again', async () => {
    const owner = await makeUser(h, { linkState: 'linked', deskId: 'L3b' });
    await insertNudge(owner.id, '탭이 보일 때만 말해요');
    const jo = await joinAs(h, owner.id);
    jo.room.send('presence', { visible: false, uiBusy: false });
    await sleep(900);
    expect(jo.room.state.pets.get(owner.id).bubbleText).toBe('');
    jo.room.send('presence', { visible: true, uiBusy: false });
    await waitFor(() => jo.room.state.pets.get(owner.id).bubbleText === '탭이 보일 때만 말해요');
  });
  for (const how of ['leave', 'second tab'] as const) {
    it(`a bubble on screen when the owner's session ends (${how}) is taken down, also after an ack`, async () => {
      const owner = await makeUser(h, { linkState: 'linked', deskId: 'L4a' });
      const other = await makeUser(h, { linkState: 'linked', deskId: 'L4b' });
      // A manual status keeps the owner shown after the session ends (the long-lived Pet stays drawn).
      await h.db
        .update(profiles)
        .set({ manualStatus: 'available', manualStatusUntil: new Date(h.clock.now().getTime() + 120 * MIN) })
        .where(eq(profiles.userId, owner.id));
      const text = `세션이 끝나도 남으면 안 되는 말풍선 (${how})`;
      const nudgeId = await insertNudge(owner.id, text);
      const jx = await joinAs(h, other.id);
      const jo = await joinAs(h, owner.id);
      await waitFor(() => jo.room.state.pets.get(owner.id)?.bubbleText === text, { message: 'owner bubble' });
      const room = serverRoom(h, jo);
      const serverPet = () => room.townDirector.pet(owner.id)!;
      expect(serverPet().bubbleId).toBe(nudgeId);

      let rejoined: Awaited<ReturnType<typeof joinAs>> | null = null;
      if (how === 'leave') {
        await jo.room.leave();
        await waitFor(() => !room.connectedUserIds.includes(owner.id), { message: 'owner left' });
      } else {
        rejoined = await joinAs(h, owner.id);
        expect(await jo.leaveCode).toBe(4101); // SessionReplaced
      }
      expect(serverPet()).toMatchObject({
        bubbleId: '',
        bubbleText: '',
        bubbleUntil: 0,
        indicator: Indicator.None,
      });
      expect(room.townDirector.player(owner.id)?.shown).toBe(true);

      await h.db
        .update(petNudges)
        .set({ status: 'acked', ackedAt: new Date() })
        .where(eq(petNudges.id, nudgeId));
      await notifyTown(h.db, { v: 1, type: 'nudges_changed', user_id: owner.id });
      await sleep(400);
      expect(serverPet()).toMatchObject({ bubbleId: '', bubbleText: '', indicator: Indicator.None });
      expect(jx.room.state.pets.get(owner.id).indicator).toBe(Indicator.None);
      if (rejoined) {
        // (c) the new tab never got the old (now acked) text
        const pet = rejoined.room.state.pets.get(owner.id);
        expect(pet.bubbleText).toBe('');
        expect(pet.bubbleId).toBe('');
      }
    });
  }
});
