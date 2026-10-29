import { notifyTown, newId, nudgeDeliveries, petNudges, todos } from '@enu/db';
import { BubbleKind, Indicator } from '@enu/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { joinAs, kst, makeUser, sleep, startHarness, waitFor, type Harness } from './helpers/server';

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
  it('shows a linked owner their Claude text; others only see the indicator; the DB records the delivery', async () => {
    const owner = await makeUser(h, { linkState: 'linked', at: { x: 9, y: 10 } });
    const other = await makeUser(h, { linkState: 'linked', at: { x: 11, y: 10 } });
    const text = '오후 2시 SQA 검토 회의 자료를 미리 열어 두면 좋겠어요.';
    const nudgeId = await insertNudge(owner.id, text);
    const jo = await joinAs(h, owner.id);
    const jx = await joinAs(h, other.id);

    const ownPet = () => jo.room.state.pets.get(owner.id);
    await waitFor(() => ownPet()?.bubbleText === text, { message: 'owner bubble' });
    expect(ownPet().bubbleId).toBe(nudgeId);
    expect(ownPet().bubbleKind).toBe(BubbleKind.Nudge);
    expect(ownPet().bubbleDueAt).toBe(0);
    expect(ownPet().indicator).toBe(Indicator.Dots);
    expect(ownPet().bubbleUntil).toBeGreaterThan(h.clock.now().getTime());

    // StateView isolation: the other client sees the "..." indicator but never the text.
    const seenByOther = () => jx.room.state.pets.get(owner.id);
    await waitFor(() => seenByOther()?.indicator === Indicator.Dots, {
      message: 'indicator at other client',
    });
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
    expect(deliveries[0]).toMatchObject({ nudgeId, trigger: 'join', todoId: null });

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
    const owner = await makeUser(h, { linkState: 'not_linked', at: { x: 9, y: 10 } });
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
    const owner = await makeUser(h, { linkState: 'linked', at: { x: 9, y: 10 } });
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
    const owner = await makeUser(h, { linkState: 'linked', at: { x: 9, y: 10 } });
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
    expect(d).toMatchObject({ trigger: 'due', dueKey: `${todoId}:5` });

    await h.db.update(todos).set({ status: 'done', statusSource: 'user' }).where(eq(todos.id, todoId));
    await notifyTown(h.db, { v: 1, type: 'todos_changed', user_id: owner.id });
    await waitFor(() => pet().bubbleText === '', { message: 'due bubble cleared' });
  });

  it('a hidden tab postpones the bubble until the tab is visible again', async () => {
    const owner = await makeUser(h, { linkState: 'linked', at: { x: 9, y: 10 } });
    await insertNudge(owner.id, '탭이 보일 때만 말해요');
    const jo = await joinAs(h, owner.id);
    jo.room.send('presence', { visible: false, uiBusy: false });
    await sleep(900);
    expect(jo.room.state.pets.get(owner.id).bubbleText).toBe('');
    jo.room.send('presence', { visible: true, uiBusy: false });
    await waitFor(() => jo.room.state.pets.get(owner.id).bubbleText === '탭이 보일 때만 말해요');
  });
});
