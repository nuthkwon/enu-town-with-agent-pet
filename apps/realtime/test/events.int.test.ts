import { desks, newId, notifyTown, petNudges, pets, profiles, user } from '@enu/db';
import { Anim, CloseCodes, Indicator, MSG, PetLink, type NoticeMsg, type PetChangedMsg } from '@enu/protocol';
import { TOWN_EVENTS_CHANNEL } from '@enu/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  joinAs,
  makeUser,
  officeRoom,
  serverRoom,
  sleep,
  startHarness,
  syncRoster,
  waitFor,
  type Harness,
} from './helpers/server';

const PORT = 3315;
let h: Harness;

beforeAll(async () => {
  h = await startHarness(PORT, { NUDGE_JOIN_DELAY_MS: '200' });
});
afterAll(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.reset();
});

describe('roster', () => {
  it('every roster member has an actor whether or not they are connected; joins change shown/online only', async () => {
    const a = await makeUser(h, { deskId: 'L1a' });
    const b = await makeUser(h, { deskId: 'R2b' });
    const c = await makeUser(h); // no desk
    const notOnboarded = await makeUser(h, { onboarded: false });
    const room = await officeRoom(h);
    expect(room.state.players.size).toBe(3);
    expect(room.state.pets.size).toBe(3);
    expect(room.state.players.has(notOnboarded.id)).toBe(false);
    for (const id of [a.id, b.id, c.id]) {
      expect(room.state.players.get(id)).toMatchObject({ shown: false, online: false });
    }
    const ja = await joinAs(h, a.id);
    expect(ja.room.state.players.size).toBe(3);
    await waitFor(() => ja.room.state.players.get(a.id)?.online === true, { message: 'a online' });
    expect(ja.room.state.players.get(b.id)).toMatchObject({ shown: false, online: false });
    await ja.room.leave();
    await waitFor(() => room.state.players.get(a.id)?.online === false, { message: 'a offline' });
    expect(room.state.players.size).toBe(3);
    // a user created later is picked up by the room's resync
    const d = await makeUser(h, { deskId: 'L5b' });
    await syncRoster(h);
    expect(room.state.players.has(d.id)).toBe(true);
  });
});

describe(`LISTEN ${TOWN_EVENTS_CHANNEL}`, () => {
  it('link_state_changed wakes the pet (and puts it back to sleep, hiding any bubble)', async () => {
    const u = await makeUser(h, { linkState: 'not_linked', deskId: 'L2b' });
    const j = await joinAs(h, u.id);
    const pet = () => j.room.state.pets.get(u.id);
    expect(pet().linkState).toBe(PetLink.NotLinked);
    expect(pet().anim).toBe(Anim.Sleep);

    const now = h.clock.now();
    await h.db.insert(petNudges).values({
      id: newId(),
      userId: u.id,
      text: '이제 연결됐어요',
      showAfter: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    await h.db.update(profiles).set({ linkState: 'linked' }).where(eq(profiles.userId, u.id));
    await notifyTown(h.db, { v: 1, type: 'link_state_changed', user_id: u.id, state: 'linked' });
    await waitFor(() => pet().linkState === PetLink.Linked, { message: 'linked' });
    await waitFor(() => pet().anim === Anim.Idle, { message: 'awake' });
    await waitFor(() => pet().bubbleText === '이제 연결됐어요', { message: 'bubble after linking' });
    expect(pet().indicator).toBe(Indicator.None); // shared: never `…`

    await h.db.update(profiles).set({ linkState: 'not_linked' }).where(eq(profiles.userId, u.id));
    await notifyTown(h.db, { v: 1, type: 'link_state_changed', user_id: u.id, state: 'not_linked' });
    await waitFor(() => pet().linkState === PetLink.NotLinked && pet().anim === Anim.Sleep, {
      message: 'asleep',
    });
    expect(pet().bubbleText).toBe('');
    expect(pet().indicator).toBe(Indicator.None);
  });

  it('link_state_changed also reaches the pet of someone who is not connected', async () => {
    const u = await makeUser(h, { linkState: 'not_linked', deskId: 'L3a' });
    const watcher = await makeUser(h, { deskId: 'L3b' });
    const j = await joinAs(h, watcher.id);
    await h.db.update(profiles).set({ linkState: 'linked' }).where(eq(profiles.userId, u.id));
    await notifyTown(h.db, { v: 1, type: 'link_state_changed', user_id: u.id, state: 'linked' });
    await waitFor(() => j.room.state.pets.get(u.id)?.linkState === PetLink.Linked, { message: 'linked' });
  });

  it('user_deactivated disconnects the user with 4103 and removes the actor', async () => {
    const u = await makeUser(h, { deskId: 'L1a' });
    const other = await makeUser(h, { deskId: 'L1b' });
    const j = await joinAs(h, u.id);
    const jo = await joinAs(h, other.id);
    const room = serverRoom(h, j);
    await h.db.update(user).set({ status: 'deactivated' }).where(eq(user.id, u.id));
    await notifyTown(h.db, { v: 1, type: 'user_deactivated', user_id: u.id });
    expect(await j.leaveCode).toBe(CloseCodes.Forbidden);
    await waitFor(() => !jo.room.state.players.has(u.id), { message: 'actor removed' });
    expect(jo.room.state.pets.has(u.id)).toBe(false);
    await sleep(300);
    expect(room.connectedUserIds).toEqual([other.id]);
  });

  it('work_log_changed (company, created) sends the owner a system notice', async () => {
    const u = await makeUser(h, { deskId: 'L4a' });
    const j = await joinAs(h, u.id);
    const logId = newId();
    const base = { v: 1, type: 'work_log_changed', user_id: u.id, log_id: logId, by: 'claude' } as const;
    await notifyTown(h.db, { ...base, visibility: 'private', created: true });
    await notifyTown(h.db, { ...base, visibility: 'company', created: false });
    await notifyTown(h.db, { ...base, visibility: 'company', created: true });
    const notice = await j.inbox.waitFor<NoticeMsg>('notice');
    expect(notice).toEqual({ kind: 'work_log_published', text: '새 업무 로그가 전사 공개되었어요', logId });
    await sleep(200);
    expect(j.inbox.of('notice')).toHaveLength(1);
  });

  it('pet_thread_changed and pets_changed reach only the owner, as ids', async () => {
    const owner = await makeUser(h, { deskId: 'L4b' });
    const colleague = await makeUser(h, { deskId: 'L5a' });
    const jo = await joinAs(h, owner.id);
    const jc = await joinAs(h, colleague.id);
    const [pet] = await h.db.select().from(pets).where(eq(pets.userId, owner.id));
    await notifyTown(h.db, { v: 1, type: 'pet_thread_changed', user_id: owner.id, pet_id: pet!.id });
    expect(await jo.inbox.waitFor<PetChangedMsg>(MSG.petChanged)).toEqual({ petId: pet!.id });
    await h.db.update(pets).set({ name: '새펫' }).where(eq(pets.id, pet!.id));
    await notifyTown(h.db, { v: 1, type: 'pets_changed', user_id: owner.id });
    await waitFor(() => jo.inbox.of(MSG.petChanged).length === 2, { message: 'pets_changed' });
    expect(jo.inbox.of(MSG.petChanged)[1]).toEqual({ petId: null });
    // pets_changed also refreshes the pet everyone sees in the town.
    await waitFor(() => jc.room.state.pets.get(owner.id)?.name === '새펫', { message: 'renamed pet' });
    await sleep(200);
    expect(jc.inbox.of(MSG.petChanged)).toEqual([]);
  });

  it('profile_changed and desks_changed refresh the synced player and pet in place', async () => {
    const u = await makeUser(h, { name: '옛이름', deskId: 'L1a' });
    const j = await joinAs(h, u.id);
    const room = serverRoom(h, j);
    const player = room.state.players.get(u.id);
    const pet = room.state.pets.get(u.id);
    await h.db.update(profiles).set({ displayName: '새이름' }).where(eq(profiles.userId, u.id));
    await h.db
      .update(pets)
      .set({ name: '모찌', species: 'bunny' })
      .where(and(eq(pets.userId, u.id), eq(pets.isDefault, true)));
    await notifyTown(h.db, { v: 1, type: 'profile_changed', user_id: u.id });
    await waitFor(() => j.room.state.players.get(u.id).name === '새이름', { message: 'renamed' });
    expect(j.room.state.pets.get(u.id).name).toBe('모찌');
    expect(j.room.state.pets.get(u.id).species).toBe('bunny');

    await h.db.update(desks).set({ userId: null }).where(eq(desks.userId, u.id));
    await h.db.insert(desks).values({ deskId: 'L3b', userId: u.id });
    await notifyTown(h.db, { v: 1, type: 'desks_changed' });
    await waitFor(() => j.room.state.players.get(u.id).deskId === 'L3b', { message: 'desk assigned' });
    // the director walks them to the new seat
    await waitFor(() => j.room.state.players.get(u.id).x === 6 && j.room.state.players.get(u.id).y === 10, {
      timeoutMs: 8000,
      message: 'at the new seat',
    });
    expect(room.state.players.get(u.id)).toBe(player);
    expect(room.state.pets.get(u.id)).toBe(pet);
  });

  it('reconnects the LISTEN connection after it is killed', async () => {
    const u = await makeUser(h, { linkState: 'not_linked', deskId: 'L2a' });
    const j = await joinAs(h, u.id);
    const killed = await h.handle.pool.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where application_name = 'enu-den-realtime-listen' and datname = current_database()`,
    );
    expect(killed.rowCount).toBeGreaterThanOrEqual(1);
    await waitFor(
      async () =>
        (
          await h.handle.pool.query(
            `select 1 from pg_stat_activity where application_name = 'enu-den-realtime-listen' and datname = current_database()`,
          )
        ).rowCount === 1,
      { timeoutMs: 8000, message: 'LISTEN reconnected' },
    );
    await h.db.update(profiles).set({ linkState: 'linked' }).where(eq(profiles.userId, u.id));
    await notifyTown(h.db, { v: 1, type: 'link_state_changed', user_id: u.id, state: 'linked' });
    await waitFor(() => j.room.state.pets.get(u.id).linkState === PetLink.Linked, {
      message: 'event after reconnect',
    });
  });

  it('ignores malformed payloads on the channel', async () => {
    const u = await makeUser(h, { deskId: 'L2a' });
    const j = await joinAs(h, u.id);
    await h.handle.pool.query('select pg_notify($1, $2)', [TOWN_EVENTS_CHANNEL, 'not json']);
    await h.handle.pool.query('select pg_notify($1, $2)', [TOWN_EVENTS_CHANNEL, '{"v":1,"type":"nope"}']);
    await sleep(200);
    expect(j.room.connection.isOpen).toBe(true);
  });
});
