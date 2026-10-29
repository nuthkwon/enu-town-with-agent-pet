import { desks, newId, notifyTown, petNudges, profiles, user, workLogs } from '@enu/db';
import { ActivityCode, PlateNote, SourceCode, type ErrorMsg } from '@enu/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AFTER_HOURS,
  joinAs,
  kst,
  makeUser,
  officeRoom,
  refHash,
  serverRoom,
  setReport,
  setWorkLog,
  sleep,
  startHarness,
  waitFor,
  type Harness,
} from './helpers/server';

const PORT = 3312;
const MIN = 60_000;
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

/** The 12 meeting chairs of 606호: (3–6, 18), (2, 19–20), (7, 19–20), (3–6, 21). */
const meetingSeat = (x: number, y: number) =>
  (x >= 3 && x <= 6 && (y === 18 || y === 21)) || ((x === 2 || x === 7) && (y === 19 || y === 20));

describe('director (real room)', () => {
  it('with nobody connected, a company log with a worked task labels the hidden plate; connecting shows the person', async () => {
    const a = await makeUser(h, { deskId: 'L1a', shareActivity: true });
    const b = await makeUser(h, { deskId: 'L1b', shareActivity: true });
    await setWorkLog(h, a.id, { statuses: ['planned', 'in_progress'] });
    await setWorkLog(h, b.id, { statuses: [] });
    const room = await officeRoom(h);
    expect(room.clients.length).toBe(0);
    expect(room.state.players.get(a.id)).toMatchObject({
      shown: false,
      note: PlateNote.None,
      activity: ActivityCode.Today,
      source: SourceCode.WorkLog,
    });
    expect(room.state.players.get(b.id)).toMatchObject({ shown: false, activity: ActivityCode.None });

    const j = await joinAs(h, a.id);
    await waitFor(() => j.room.state.players.get(a.id)?.shown === true, { message: 'shown once connected' });
    expect(j.room.state.players.get(a.id)).toMatchObject({
      online: true,
      activity: ActivityCode.Today,
      source: SourceCode.WorkLog,
      x: 3,
      y: 5,
    });
  });

  it('three seeded reports with the same meeting ref put three people on meeting chairs at block start', async () => {
    h.clock.set(kst(2026, 10, 28, 9, 59));
    const start = kst(2026, 10, 28, 10, 0);
    const end = kst(2026, 10, 28, 11, 0);
    const people = [];
    for (const deskId of ['L1a', 'L3b', 'R2b']) {
      const u = await makeUser(h, { deskId, shareActivity: true });
      await setReport(h, u.id, { schedule: [{ start, end, kind: 'meeting', refHash: refHash('meet') }] });
      people.push(u);
    }
    const loner = await makeUser(h, { deskId: 'L5a', shareActivity: true });
    await setReport(h, loner.id, { schedule: [{ start, end, kind: 'meeting', refHash: refHash('other') }] });
    const room = await officeRoom(h);
    for (const u of people) expect(room.state.players.get(u.id)?.shown).toBe(false);

    h.clock.set(start);
    room.evaluateNow();
    const gid = room.state.players.get(people[0]!.id)!.groupId;
    expect(gid).toMatch(/^g/);
    for (const u of people) {
      const p = room.state.players.get(u.id)!;
      expect(p).toMatchObject({
        shown: true,
        activity: ActivityCode.Meeting,
        source: SourceCode.Calendar,
        until: end.getTime(),
        groupId: gid,
      });
      expect(meetingSeat(p.x, p.y)).toBe(true);
    }
    // a meeting nobody else reported stays at the desk with a headset
    expect(room.state.players.get(loner.id)).toMatchObject({
      shown: true,
      activity: ActivityCode.Meeting,
      groupId: '',
      x: 3,
      y: 15,
    });
  });

  it('status:set away hides at once and survives a room restart; auto clears it and keeps 상태 문구', async () => {
    const u = await makeUser(h, { deskId: 'L2a' });
    const watcher = await makeUser(h, { deskId: 'L2b' });
    const j = await joinAs(h, u.id);
    const w = await joinAs(h, watcher.id);
    await waitFor(() => w.room.state.players.get(u.id)?.shown === true);
    j.room.send('status:set', { status: 'away', duration: '30m', text: '  점심 식사  ' });
    await waitFor(() => w.room.state.players.get(u.id)?.shown === false, { message: 'hidden' });
    const until = h.clock.now().getTime() + 30 * MIN;
    const seen = w.room.state.players.get(u.id);
    expect(seen).toMatchObject({
      note: PlateNote.Away,
      source: SourceCode.Manual,
      statusText: '점심 식사',
      online: false,
    });
    expect(Math.abs(seen.until - until)).toBeLessThan(2000);
    const [row] = await h.db.select().from(profiles).where(eq(profiles.userId, u.id));
    expect(row).toMatchObject({ manualStatus: 'away', statusText: '점심 식사' });
    expect(Math.abs(row!.manualStatusUntil!.getTime() - until)).toBeLessThan(2000);

    // restart: a new room reads the stored status
    await h.colyseus.cleanup();
    const fresh = await officeRoom(h);
    expect(fresh.state.players.get(u.id)).toMatchObject({
      shown: false,
      note: PlateNote.Away,
      statusText: '점심 식사',
    });
    const again = await joinAs(h, u.id);
    await sleep(300);
    expect(again.room.state.players.get(u.id)).toMatchObject({ shown: false, note: PlateNote.Away });

    again.room.send('status:set', { status: 'auto' });
    await waitFor(() => again.room.state.players.get(u.id)?.shown === true, { message: 'shown again' });
    expect(again.room.state.players.get(u.id)).toMatchObject({
      note: PlateNote.None,
      source: SourceCode.Town,
      statusText: '점심 식사',
      online: true,
    });
    const [after] = await h.db.select().from(profiles).where(eq(profiles.userId, u.id));
    expect(after).toMatchObject({ manualStatus: null, manualStatusUntil: null, statusText: '점심 식사' });

    // a status with a duration: 집중 모드 · 직접 설정, default 1h
    again.room.send('status:set', { status: 'focus' });
    await waitFor(() => again.room.state.players.get(u.id)?.activity === ActivityCode.Focus);
    expect(again.room.state.players.get(u.id).source).toBe(SourceCode.Manual);
    expect(
      Math.abs(again.room.state.players.get(u.id).until - (h.clock.now().getTime() + 60 * MIN)),
    ).toBeLessThan(2000);
  });

  it('activity_changed re-reads the report: a Claude `now` labels the shown avatar', async () => {
    const u = await makeUser(h, { deskId: 'L3a', shareActivity: true });
    const j = await joinAs(h, u.id);
    await waitFor(() => j.room.state.players.get(u.id)?.source === SourceCode.Town);
    const until = new Date(h.clock.now().getTime() + 90 * MIN);
    await setReport(h, u.id, { now: { kind: 'review', until } });
    await notifyTown(h.db, { v: 1, type: 'activity_changed', user_id: u.id });
    await waitFor(() => j.room.state.players.get(u.id)?.activity === ActivityCode.Review, {
      message: 'label',
    });
    expect(j.room.state.players.get(u.id)).toMatchObject({
      source: SourceCode.Claude,
      until: until.getTime(),
      shown: true,
    });
    // sharing turned off (PATCH deletes today's row and notifies both events)
    await h.db.update(profiles).set({ shareActivity: false }).where(eq(profiles.userId, u.id));
    await notifyTown(h.db, { v: 1, type: 'profile_changed', user_id: u.id });
    await notifyTown(h.db, { v: 1, type: 'activity_changed', user_id: u.id });
    await waitFor(() => j.room.state.players.get(u.id)?.activity === ActivityCode.None, {
      message: 'label gone',
    });
    expect(j.room.state.players.get(u.id)).toMatchObject({ source: SourceCode.Town, shown: true });
  });

  it('work_log_changed {by:claude} bumps logPulse only for a shown, sharing owner with a company log, in office hours', async () => {
    const a = await makeUser(h, { deskId: 'L4a', shareActivity: true });
    const p = await makeUser(h, { deskId: 'L4b', shareActivity: true });
    const n = await makeUser(h, { deskId: 'L5b', shareActivity: false });
    const ja = await joinAs(h, a.id);
    await joinAs(h, p.id);
    await joinAs(h, n.id);
    const logA = await setWorkLog(h, a.id, { visibility: 'company' });
    const logP = await setWorkLog(h, p.id, { visibility: 'private' });
    const logN = await setWorkLog(h, n.id, { visibility: 'company' });
    const event = (userId: string, logId: string, visibility: 'company' | 'private', by: 'claude' | 'user') =>
      notifyTown(h.db, {
        v: 1,
        type: 'work_log_changed',
        user_id: userId,
        log_id: logId,
        visibility,
        created: false,
        by,
      });
    const pulse = (id: string) => ja.room.state.players.get(id)?.logPulse;

    await event(a.id, logA, 'company', 'claude');
    // Only a change matters (a random step: the value never counts writes).
    await waitFor(() => pulse(a.id) !== 0, { message: 'sparkle' });
    const pulsed = pulse(a.id);
    await event(a.id, logA, 'company', 'user');
    await event(p.id, logP, 'private', 'claude');
    await event(n.id, logN, 'company', 'claude');
    await sleep(400);
    expect(pulse(a.id)).toBe(pulsed);
    expect(pulse(p.id)).toBe(0);
    expect(pulse(n.id)).toBe(0);

    // a deleted log never sparkles
    await h.db.update(workLogs).set({ deletedAt: new Date() }).where(eq(workLogs.id, logA));
    await event(a.id, logA, 'company', 'claude');
    await sleep(400);
    expect(pulse(a.id)).toBe(pulsed);

    // after hours: the shared state is neutral and nothing sparkles
    await h.db.update(workLogs).set({ deletedAt: null }).where(eq(workLogs.id, logA));
    h.clock.set(AFTER_HOURS);
    serverRoom(h, ja).evaluateNow();
    await waitFor(() => ja.room.state.officeOpen === false);
    await waitFor(() => pulse(a.id) === 0, { message: 'pulse reset at closing' }); // no value survives the night
    await event(a.id, logA, 'company', 'claude');
    await sleep(400);
    expect(pulse(a.id)).toBe(0);
  });

  it('desks_changed during an active bubble: the owner still decodes bubbleText (same Pet instance)', async () => {
    const u = await makeUser(h, { deskId: 'L1a', linkState: 'linked' });
    const text = '자리를 옮겨도 말풍선은 그대로예요';
    const now = h.clock.now();
    await h.db.insert(petNudges).values({
      id: newId(),
      userId: u.id,
      text,
      showAfter: new Date(now.getTime() - MIN),
      expiresAt: new Date(now.getTime() + 60 * MIN),
    });
    const j = await joinAs(h, u.id);
    const room = serverRoom(h, j);
    const pet = room.townDirector.pet(u.id);
    await waitFor(() => j.room.state.pets.get(u.id)?.bubbleText === text, { message: 'bubble' });
    await h.db.update(desks).set({ userId: null }).where(eq(desks.userId, u.id));
    await h.db.insert(desks).values({ deskId: 'R1', userId: u.id });
    await notifyTown(h.db, { v: 1, type: 'desks_changed' });
    await waitFor(() => j.room.state.players.get(u.id)?.deskId === 'R1', { message: 'moved desk' });
    expect(room.townDirector.pet(u.id)).toBe(pet);
    expect(room.state.pets.get(u.id)).toBe(pet);
    expect(j.room.state.pets.get(u.id).bubbleText).toBe(text);
  });

  it('user_deactivated removes the actor of someone who is not connected', async () => {
    const u = await makeUser(h, { deskId: 'L2a' });
    const watcher = await makeUser(h, { deskId: 'L2b' });
    const w = await joinAs(h, watcher.id);
    expect(w.room.state.players.has(u.id)).toBe(true);
    await h.db.update(user).set({ status: 'deactivated' }).where(eq(user.id, u.id));
    await notifyTown(h.db, { v: 1, type: 'user_deactivated', user_id: u.id });
    await waitFor(() => !w.room.state.players.has(u.id), { message: 'removed' });
    expect(w.room.state.pets.has(u.id)).toBe(false);
  });

  it('steering messages are gone: step / face answer UNKNOWN_MESSAGE and move nobody', async () => {
    const u = await makeUser(h, { deskId: 'L1b' });
    const j = await joinAs(h, u.id);
    await waitFor(() => j.room.state.players.get(u.id)?.shown === true);
    j.room.send('step', { seq: 1, dir: 3 });
    expect(await j.inbox.waitFor<ErrorMsg>('error')).toEqual({ code: 'UNKNOWN_MESSAGE', type: 'step' });
    j.room.send('face', { dir: 1 });
    expect(await j.inbox.waitFor<ErrorMsg>('error', (e) => e.type === 'face')).toEqual({
      code: 'UNKNOWN_MESSAGE',
      type: 'face',
    });
    await sleep(300);
    expect({ x: j.room.state.players.get(u.id).x, y: j.room.state.players.get(u.id).y }).toEqual({
      x: 6,
      y: 5,
    });
    j.room.send('status:set', { status: 'nap' });
    expect(await j.inbox.waitFor<ErrorMsg>('error', (e) => e.type === 'status:set')).toEqual({
      code: 'INVALID_PAYLOAD',
      type: 'status:set',
    });
    expect(j.room.connection.isOpen).toBe(true);
  });

  it('a join without `protocol` fails in matchmaking with 4111', async () => {
    const u = await makeUser(h, { deskId: 'L1a' });
    await expect(joinAs(h, u.id, { options: { mapHash: 'abc' } })).rejects.toMatchObject({
      code: 4111,
      message: 'protocol_mismatch',
    });
  });
});
