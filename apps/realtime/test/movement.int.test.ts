import { Anim, Dir, Status, type MoveCorrectMsg } from '@enu/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  joinAs,
  makeUser,
  serverRoom,
  sleep,
  startHarness,
  waitFor,
  walk,
  type Harness,
} from './helpers/server';

const PORT = 3312;
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

describe('movement', () => {
  it('steps into a desk or wall are corrected; free tiles are accepted', async () => {
    const u = await makeUser(h, { deskId: 'L1a' }); // seat (3,5) facing down at the desk
    const j = await joinAs(h, u.id);
    j.room.send('step', { seq: 1, dir: Dir.Down });
    const c = await j.inbox.waitFor<MoveCorrectMsg>('move:correct', (m) => m.seq === 1);
    expect(c).toEqual({ seq: 1, x: 3, y: 5 });
    await sleep(170);
    j.room.send('step', { seq: 2, dir: Dir.Up });
    await waitFor(() => j.room.state.players.get(u.id).y === 4);
    const me = j.room.state.players.get(u.id);
    expect({ x: me.x, y: me.y, dir: me.dir }).toEqual({ x: 3, y: 4, dir: Dir.Up });
    await sleep(170);
    j.room.send('step', { seq: 3, dir: Dir.Up }); // (3,3) is the window wall
    expect(await j.inbox.waitFor<MoveCorrectMsg>('move:correct', (m) => m.seq === 3)).toEqual({
      seq: 3,
      x: 3,
      y: 4,
    });
  });

  it('rejects steps that come faster than the cadence allows', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 9 } });
    const j = await joinAs(h, u.id);
    for (let seq = 1; seq <= 8; seq++) j.room.send('step', { seq, dir: Dir.Down });
    await waitFor(() => j.inbox.of('move:correct').length >= 4);
    await sleep(200);
    const me = j.room.state.players.get(u.id);
    // burst of 3 accepted, the rest corrected back to the server position
    expect(me.y - 9).toBeGreaterThanOrEqual(3);
    expect(me.y - 9).toBeLessThanOrEqual(4);
    const corrections = j.inbox.of<MoveCorrectMsg>('move:correct');
    expect(corrections.length).toBe(8 - (me.y - 9));
    expect(corrections.every((m) => m.x === 9)).toBe(true);
  });

  it('invalid payloads get an error reply and the connection stays open', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 9 } });
    const j = await joinAs(h, u.id);
    j.room.send('step', { seq: -1, dir: 7 });
    expect(await j.inbox.waitFor('error')).toEqual({ code: 'INVALID_PAYLOAD', type: 'step' });
    j.room.send('no-such-message', {});
    expect(await j.inbox.waitFor<{ code: string }>('error', (e) => e.code === 'UNKNOWN_MESSAGE')).toEqual({
      code: 'UNKNOWN_MESSAGE',
      type: 'no-such-message',
    });
    await sleep(100);
    expect(j.room.connection.isOpen).toBe(true);
    j.room.send('step', { seq: 1, dir: Dir.Down });
    await waitFor(() => j.room.state.players.get(u.id).y === 10);
  });

  it('zone changes update zoneId and set Meeting in the meeting room (Focus is kept)', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 18 } }); // aisle, next to the meeting area (x1-8, y18-21)
    const j = await joinAs(h, u.id);
    const me = () => j.room.state.players.get(u.id);
    expect(me().zoneId).toBe('');
    await walk(j, [Dir.Left], 1);
    await waitFor(() => me().zoneId === 'meeting');
    expect(me().status).toBe(Status.Meeting);
    await walk(j, [Dir.Right], 2);
    await waitFor(() => me().zoneId === '');
    expect(me().status).toBe(Status.Available);

    j.room.send('status:set', { status: Status.Focus, text: '문서 작업 중' });
    await waitFor(() => me().status === Status.Focus);
    expect(me().statusText).toBe('문서 작업 중');
    await walk(j, [Dir.Left], 3);
    await waitFor(() => me().zoneId === 'meeting');
    await sleep(100);
    expect(me().status).toBe(Status.Focus);
  });

  it('the pantry shows its label as status text when there is no custom text', async () => {
    const u = await makeUser(h, { at: { x: 12, y: 15 } });
    const j = await joinAs(h, u.id);
    const me = () => j.room.state.players.get(u.id);
    await walk(j, [Dir.Right], 1);
    await waitFor(() => me().zoneId === 'pantry');
    expect(me().statusText).toBe('탕비실');
  });
});

describe('pet', () => {
  it('follows the owner with a lag and ends up one tile behind', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 10, dir: Dir.Right }, linkState: 'linked' });
    const j = await joinAs(h, u.id);
    const pet = () => j.room.state.pets.get(u.id);
    await waitFor(() => pet());
    expect({ x: pet().x, y: pet().y }).toEqual({ x: 8, y: 10 });
    let seq = 1;
    const lags: number[] = [];
    for (let i = 0; i < 6; i++) {
      j.room.send('step', { seq: seq++, dir: Dir.Right });
      await sleep(165);
      lags.push(j.room.state.players.get(u.id).x - pet().x);
    }
    expect(Math.max(...lags)).toBeGreaterThanOrEqual(1);
    expect(lags.every((l) => l >= 1 && l <= 3)).toBe(true);
    expect(pet().anim).toBe(Anim.Walk);
    await waitFor(() => pet().x === 14 && pet().y === 10, { message: 'pet one tile behind' });
    expect(j.room.state.players.get(u.id).x).toBe(15);
    expect(pet().dir).toBe(Dir.Right);
    await waitFor(() => pet().anim === Anim.Idle, { timeoutMs: 3000 });
  });

  it('teleports next to the owner when the owner jumps', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 10 }, linkState: 'linked' });
    const j = await joinAs(h, u.id);
    const room = serverRoom(h, j);
    expect(room.relocate(u.id, 10, 20, Dir.Up)).toBe(true);
    await waitFor(() => j.room.state.players.get(u.id).y === 20);
    const pet = j.room.state.pets.get(u.id);
    await waitFor(() => Math.abs(pet.x - 10) + Math.abs(pet.y - 20) === 1);
    expect({ x: pet.x, y: pet.y }).toEqual({ x: 10, y: 21 });
  });

  it('a pet that is not linked sleeps', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 10 }, linkState: 'not_linked' });
    const j = await joinAs(h, u.id);
    const pet = j.room.state.pets.get(u.id);
    expect(pet.anim).toBe(Anim.Sleep);
    expect(pet.linkState).toBe(1);
  });
});
