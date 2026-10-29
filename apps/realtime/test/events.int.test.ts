import { desks, newId, notifyTown, petNudges, profiles, user } from '@enu/db';
import { Anim, CloseCodes, Indicator, PetLink, type NoticeMsg } from '@enu/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { joinAs, makeUser, serverRoom, sleep, startHarness, waitFor, type Harness } from './helpers/server';

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

describe('LISTEN enu_town_events', () => {
  it('link_state_changed wakes the pet (and puts it back to sleep, hiding any bubble)', async () => {
    const u = await makeUser(h, { linkState: 'not_linked', at: { x: 9, y: 10 } });
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

    await h.db.update(profiles).set({ linkState: 'not_linked' }).where(eq(profiles.userId, u.id));
    await notifyTown(h.db, { v: 1, type: 'link_state_changed', user_id: u.id, state: 'not_linked' });
    await waitFor(() => pet().linkState === PetLink.NotLinked && pet().anim === Anim.Sleep, {
      message: 'asleep',
    });
    expect(pet().bubbleText).toBe('');
    expect(pet().indicator).toBe(Indicator.None);
  });

  it('user_deactivated disconnects the user with 4103 and no reconnection', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 10 } });
    const other = await makeUser(h, { at: { x: 11, y: 10 } });
    const j = await joinAs(h, u.id);
    const jo = await joinAs(h, other.id);
    const room = serverRoom(h, j);
    await h.db.update(user).set({ status: 'deactivated' }).where(eq(user.id, u.id));
    await notifyTown(h.db, { v: 1, type: 'user_deactivated', user_id: u.id });
    expect(await j.leaveCode).toBe(CloseCodes.Forbidden);
    await waitFor(() => !jo.room.state.players.has(u.id), { message: 'avatar removed' });
    await sleep(300);
    expect(room.connectedUserIds).toEqual([other.id]);
  });

  it('work_log_changed (company, created) sends the owner a system notice', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 10 } });
    const j = await joinAs(h, u.id);
    const logId = newId();
    await notifyTown(h.db, {
      v: 1,
      type: 'work_log_changed',
      user_id: u.id,
      log_id: logId,
      visibility: 'private',
      created: true,
    });
    await notifyTown(h.db, {
      v: 1,
      type: 'work_log_changed',
      user_id: u.id,
      log_id: logId,
      visibility: 'company',
      created: false,
    });
    await notifyTown(h.db, {
      v: 1,
      type: 'work_log_changed',
      user_id: u.id,
      log_id: logId,
      visibility: 'company',
      created: true,
    });
    const notice = await j.inbox.waitFor<NoticeMsg>('notice');
    expect(notice).toEqual({ kind: 'work_log_published', text: '새 업무 로그가 전사 공개되었어요', logId });
    await sleep(200);
    expect(j.inbox.of('notice')).toHaveLength(1);
  });

  it('profile_changed and desks_changed refresh the synced player and pet', async () => {
    const u = await makeUser(h, { name: '옛이름', at: { x: 9, y: 10 } });
    const j = await joinAs(h, u.id);
    await h.db
      .update(profiles)
      .set({ displayName: '새이름', petName: '모찌', petSpecies: 'bunny' })
      .where(eq(profiles.userId, u.id));
    await notifyTown(h.db, { v: 1, type: 'profile_changed', user_id: u.id });
    await waitFor(() => j.room.state.players.get(u.id).name === '새이름', { message: 'renamed' });
    expect(j.room.state.pets.get(u.id).name).toBe('모찌');
    expect(j.room.state.pets.get(u.id).species).toBe('bunny');

    await h.db.insert(desks).values({ deskId: 'L3b', userId: u.id });
    await notifyTown(h.db, { v: 1, type: 'desks_changed' });
    await waitFor(() => j.room.state.players.get(u.id).deskId === 'L3b', { message: 'desk assigned' });
  });

  it('reconnects the LISTEN connection after it is killed', async () => {
    const u = await makeUser(h, { linkState: 'not_linked', at: { x: 9, y: 10 } });
    const j = await joinAs(h, u.id);
    const killed = await h.handle.pool.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where application_name = 'enu-town-realtime-listen' and datname = current_database()`,
    );
    expect(killed.rowCount).toBeGreaterThanOrEqual(1);
    await waitFor(
      async () =>
        (
          await h.handle.pool.query(
            `select 1 from pg_stat_activity where application_name = 'enu-town-realtime-listen' and datname = current_database()`,
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
    const u = await makeUser(h, { at: { x: 9, y: 10 } });
    const j = await joinAs(h, u.id);
    await h.handle.pool.query(`select pg_notify('enu_town_events', 'not json')`);
    await h.handle.pool.query(`select pg_notify('enu_town_events', '{"v":1,"type":"nope"}')`);
    await sleep(200);
    expect(j.room.connection.isOpen).toBe(true);
  });
});
