import http from 'node:http';
import { MatchMakeError } from '@colyseus/sdk';
import { CloseCodes, Dir } from '@enu/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  joinAs,
  makeUser,
  mintTicket,
  serverRoom,
  sleep,
  startHarness,
  waitFor,
  type Harness,
} from './helpers/server';

const PORT = 3311;
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

async function rejection(p: Promise<unknown>): Promise<MatchMakeError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(MatchMakeError);
    return err as MatchMakeError;
  }
  throw new Error('join unexpectedly succeeded');
}

describe('onAuth', () => {
  it('rejects a missing ticket', async () => {
    const u = await makeUser(h);
    const err = await rejection(joinAs(h, u.id, { ticket: '' }));
    expect(err.code).toBe(525);
    expect(err.message).toBe('missing_ticket');
  });

  it('rejects a bad signature, a wrong audience and an expired ticket', async () => {
    const u = await makeUser(h);
    const bad = await rejection(
      joinAs(h, u.id, { ticket: await mintTicket(u.id, { secret: 'another-secret-0123456789abcdef01234' }) }),
    );
    expect(bad.message).toBe('invalid_ticket');
    const aud = await rejection(
      joinAs(h, u.id, { ticket: await mintTicket(u.id, { aud: 'https://town.example/api/mcp' }) }),
    );
    expect(aud.message).toBe('invalid_ticket');
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = await rejection(
      joinAs(h, u.id, { ticket: await mintTicket(u.id, { iat: nowSec - 300, exp: nowSec - 200 }) }),
    );
    expect(expired.message).toBe('expired_ticket');
    // valid exp but minted too long ago (maxTokenAge 2m)
    const old = await rejection(
      joinAs(h, u.id, { ticket: await mintTicket(u.id, { iat: nowSec - 600, exp: nowSec + 600 }) }),
    );
    expect(old.message).toBe('expired_ticket');
  });

  it('re-checks the user in the DB: deactivated, unknown and foreign-domain users are rejected', async () => {
    const off = await makeUser(h, { status: 'deactivated' });
    expect((await rejection(joinAs(h, off.id))).message).toBe('user_inactive');
    expect((await rejection(joinAs(h, '0190ffff-0000-7000-8000-00000000dead'))).message).toBe('unknown_user');
    const gmail = await makeUser(h, { email: 'someone@gmail.com', hd: 'gmail.com' });
    expect((await rejection(joinAs(h, gmail.id))).message).toBe('domain_not_allowed');
  });

  it('rejects a foreign or missing Origin on matchmaking', async () => {
    const u = await makeUser(h);
    expect((await rejection(joinAs(h, u.id, { origin: 'https://evil.example' }))).message).toBe(
      'origin_not_allowed',
    );
    expect((await rejection(joinAs(h, u.id, { origin: null }))).message).toBe('origin_not_allowed');
  });

  it('a valid ticket joins at the own desk seat, facing the desk, with only the own pet in view', async () => {
    const u = await makeUser(h, { name: '권테스트', deskId: 'L2a', linkState: 'linked' });
    const j = await joinAs(h, u.id);
    const me = await waitFor(() => j.room.state.players.get(u.id));
    expect({ x: me.x, y: me.y, dir: me.dir }).toEqual({ x: 3, y: 8, dir: Dir.Up });
    expect(me.name).toBe('권테스트');
    expect(me.deskId).toBe('L2a');
    expect(me.avatar).toMatch(/^av-/);
    const pet = j.room.state.pets.get(u.id);
    expect(pet).toBeDefined();
    expect(Math.abs(pet.x - 3) + Math.abs(pet.y - 8)).toBe(1);
    expect(pet.linkState).toBe(0);
    expect(j.room.state.mapId).toBe('office-606');
    expect(j.room.state.mapHash).toMatch(/^[0-9a-f]{64}$/);
    const unread = await j.inbox.waitFor<{ total: number }>('dm:unread');
    expect(unread.total).toBe(0);
  });
});

describe('sessions', () => {
  it('a second session of the same user replaces the first with 4101 and no reconnection', async () => {
    const u = await makeUser(h, { deskId: 'L1a' });
    const first = await joinAs(h, u.id);
    const room = serverRoom(h, first);
    const second = await joinAs(h, u.id);
    expect(await first.leaveCode).toBe(CloseCodes.SessionReplaced);
    await sleep(600);
    expect(room.clients.length).toBe(1);
    expect(room.connectedUserIds).toEqual([u.id]);
    expect(room.state.players.size).toBe(1);
    expect(second.room.state.players.get(u.id)).toBeDefined();
    expect(second.room.connection.isOpen).toBe(true);
    expect(first.room.connection.isOpen).toBe(false);
    // the replaced session's onLeave must not remove the new avatar
    await sleep(300);
    expect(room.state.players.get(u.id)).toBeDefined();
  });

  it('a dropped connection keeps the avatar and can reconnect within the grace period', async () => {
    const u = await makeUser(h, { deskId: 'L1b', linkState: 'linked' });
    const j = await joinAs(h, u.id);
    const room = serverRoom(h, j);
    const token = j.room.reconnectionToken;
    j.room.reconnection.enabled = false;
    await j.room.leave(false);
    await sleep(300);
    expect(room.state.players.has(u.id)).toBe(true);
    expect(room.clients.length).toBe(0);
    const back = await j.client.reconnect(token);
    await waitFor(() => back.state.players?.get(u.id));
    expect(back.sessionId).toBe(j.room.sessionId);
    expect(room.clients.length).toBe(1);
    // the owner's StateView survived the reconnect
    expect(back.state.pets.get(u.id).bubbleText).toBe('');
    back.send('step', { seq: 1, dir: Dir.Up });
    await waitFor(() => back.state.players.get(u.id).y === 4);
  });

  it('a consented leave removes the avatar and stores the last position', async () => {
    const u = await makeUser(h, { at: { x: 9, y: 10, dir: Dir.Left } });
    const j = await joinAs(h, u.id);
    const room = serverRoom(h, j);
    expect(j.room.state.players.get(u.id).x).toBe(9);
    await j.room.leave();
    await waitFor(() => !room.state.players.has(u.id));
    const again = await joinAs(h, u.id);
    const me = again.room.state.players.get(u.id);
    expect({ x: me.x, y: me.y, dir: me.dir }).toEqual({ x: 9, y: 10, dir: Dir.Left });
  });
});

describe('HTTP + WebSocket guards', () => {
  it('serves /healthz and only allow-listed CORS origins', async () => {
    const ok = await fetch(`http://127.0.0.1:${PORT}/healthz`, { headers: { Origin: ORIGIN } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const evil = await fetch(`http://127.0.0.1:${PORT}/healthz`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBe('null');
  });

  it('beforeUpgrade refuses WebSocket upgrades from foreign origins', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: PORT,
        path: '/someprocess/someroom?sessionId=x',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
          Origin: 'https://evil.example',
        },
      });
      req.on('response', (res) => resolve(res.statusCode ?? 0));
      req.on('upgrade', () => resolve(101));
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
