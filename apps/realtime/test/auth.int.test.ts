import http from 'node:http';
import { matchMaker } from '@colyseus/core';
import { MatchMakeError } from '@colyseus/sdk';
import { privacyConsents } from '@enu/db';
import { CloseCodes, Dir, PROTOCOL_VERSION } from '@enu/protocol';
import { DESK_IDS, OFFICE_ROOM_NAME } from '@enu/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  joinAs,
  makeUser,
  mintTicket,
  officeRoom,
  sdkClient,
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

/** Fills every desk of 606호 with a roster member (the first one is returned separately). */
async function fullOffice(): Promise<{ id: string }[]> {
  const out: { id: string }[] = [];
  for (const deskId of DESK_IDS) out.push(await makeUser(h, { deskId }));
  return out;
}

describe('onAuth', () => {
  it('refuses a missing or different protocol version with 4111 before any state is sent', async () => {
    const u = await makeUser(h);
    const none = await rejection(joinAs(h, u.id, { options: {} }));
    expect(none.code).toBe(CloseCodes.ProtocolMismatch);
    expect(none.message).toBe('protocol_mismatch');
    const old = await rejection(
      joinAs(h, u.id, { options: { mapHash: 'x', protocol: PROTOCOL_VERSION - 1 } }),
    );
    expect(old.code).toBe(4111);
    // a refused client never became a session
    const room = await officeRoom(h);
    expect(room.clients.length).toBe(0);
    expect(room.connectedUserIds).toEqual([]);
    // without a ticket the ticket error comes first (nobody gets a seat without a ticket)
    const noTicket = await rejection(joinAs(h, u.id, { ticket: '', options: {} }));
    expect(noTicket.message).toBe('missing_ticket');
  });

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

  it('refuses notice_required without finished onboarding or a current, non-withdrawn notice consent', async () => {
    const fresh = await makeUser(h, { onboarded: false });
    expect((await rejection(joinAs(h, fresh.id))).message).toBe('notice_required');
    const noConsent = await makeUser(h, { noticeVersion: null });
    expect((await rejection(joinAs(h, noConsent.id))).message).toBe('notice_required');
    const oldNotice = await makeUser(h, { noticeVersion: '2026-10' });
    expect((await rejection(joinAs(h, oldNotice.id))).message).toBe('notice_required');
    const withdrawn = await makeUser(h);
    await h.db
      .update(privacyConsents)
      .set({ withdrawnAt: new Date() })
      .where(eq(privacyConsents.userId, withdrawn.id));
    expect((await rejection(joinAs(h, withdrawn.id))).message).toBe('notice_required');
  });

  it('rejects a foreign or missing Origin on matchmaking', async () => {
    const u = await makeUser(h);
    expect((await rejection(joinAs(h, u.id, { origin: 'https://evil.example' }))).message).toBe(
      'origin_not_allowed',
    );
    expect((await rejection(joinAs(h, u.id, { origin: null }))).message).toBe('origin_not_allowed');
  });

  it('a valid ticket joins: the actor keeps its director spot (own seat), only the own pet in view', async () => {
    const u = await makeUser(h, { name: '권테스트', deskId: 'L2a', linkState: 'linked' });
    const j = await joinAs(h, u.id);
    const me = await waitFor(() => j.room.state.players.get(u.id)?.shown && j.room.state.players.get(u.id));
    expect({ x: me.x, y: me.y, dir: me.dir }).toEqual({ x: 3, y: 8, dir: Dir.Up });
    expect(me.name).toBe('권테스트');
    expect(me.deskId).toBe('L2a');
    expect(me.avatar).toMatch(/^av-/);
    expect(me.online).toBe(true);
    const pet = j.room.state.pets.get(u.id);
    expect(pet).toBeDefined();
    expect(Math.abs(pet.x - 3) + Math.abs(pet.y - 8)).toBe(1);
    expect(pet.linkState).toBe(0);
    expect(j.room.state.mapId).toBe('office-606');
    expect(j.room.state.mapHash).toMatch(/^[0-9a-f]{64}$/);
    expect(j.room.state.officeOpen).toBe(true);
    const unread = await j.inbox.waitFor<{ total: number }>('dm:unread');
    expect(unread.total).toBe(0);
  });
});

describe('sessions', () => {
  it('a second session of the same user replaces the first with 4101: 14 roster actors, 1 session', async () => {
    const [u] = await fullOffice();
    const first = await joinAs(h, u!.id);
    const room = serverRoom(h, first);
    const second = await joinAs(h, u!.id);
    expect(await first.leaveCode).toBe(CloseCodes.SessionReplaced);
    await sleep(600);
    expect(room.clients.length).toBe(1);
    expect(room.connectedUserIds).toEqual([u!.id]);
    expect(room.state.players.size).toBe(14);
    expect(second.room.state.players.size).toBe(14);
    expect(second.room.state.players.get(u!.id)).toMatchObject({ shown: true, online: true });
    expect(second.room.connection.isOpen).toBe(true);
    expect(first.room.connection.isOpen).toBe(false);
    // the replaced session's onLeave must not end the new session
    await sleep(300);
    expect(room.state.players.get(u!.id)).toMatchObject({ shown: true, online: true });
  });

  it('a dropped connection stays live but not online, and can reconnect within the hold', async () => {
    const u = await makeUser(h, { deskId: 'L1b', linkState: 'linked' });
    const j = await joinAs(h, u.id);
    const room = serverRoom(h, j);
    const token = j.room.reconnectionToken;
    j.room.reconnection.enabled = false;
    await j.room.leave(false);
    await waitFor(() => room.state.players.get(u.id)?.online === false, { message: 'not online while held' });
    expect(room.state.players.get(u.id)).toMatchObject({ shown: true, x: 6, y: 5 });
    expect(room.clients.length).toBe(0);
    const back = await j.client.reconnect(token);
    await waitFor(() => back.state.players?.get(u.id));
    expect(back.sessionId).toBe(j.room.sessionId);
    expect(room.clients.length).toBe(1);
    await waitFor(() => back.state.players.get(u.id).online === true, { message: 'online again' });
    // the owner's StateView survived the reconnect
    expect(back.state.pets.get(u.id).bubbleText).toBe('');
  });

  it('a consented leave keeps the actor: offline at once, shown through the 60 s grace, then hidden', async () => {
    const u = await makeUser(h, { deskId: 'L3b' });
    const other = await makeUser(h, { deskId: 'L4b' });
    const j = await joinAs(h, u.id);
    const watcher = await joinAs(h, other.id);
    const room = serverRoom(h, j);
    await j.room.leave();
    await waitFor(() => watcher.room.state.players.get(u.id)?.online === false, { message: 'offline' });
    expect(watcher.room.state.players.get(u.id)).toMatchObject({ shown: true, x: 6, y: 10 });
    h.clock.set(new Date(h.clock.now().getTime() + 61_000));
    room.evaluateNow();
    await waitFor(() => watcher.room.state.players.get(u.id)?.shown === false, {
      message: 'hidden after grace',
    });
    expect(room.state.players.has(u.id)).toBe(true);
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

describe('one persistent room', () => {
  it('clients can only join: create / joinOrCreate are refused and no second room ever exists', async () => {
    const u = await makeUser(h, { deskId: 'L1a' });
    const room = await officeRoom(h);
    for (const method of ['create', 'joinOrCreate'] as const) {
      const client = sdkClient(PORT);
      client.auth.token = await mintTicket(u.id);
      const err = await rejection(client[method](OFFICE_ROOM_NAME, { protocol: PROTOCOL_VERSION }));
      expect(err.message).toContain('invalid method');
    }
    // The raw matchmake route, as a script on the /town page would call it.
    const raw = await fetch(`http://127.0.0.1:${PORT}/matchmake/create/${OFFICE_ROOM_NAME}`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await mintTicket(u.id)}`,
      },
      body: JSON.stringify({ protocol: PROTOCOL_VERSION }),
    });
    expect(raw.ok).toBe(false);
    // Server side, a second OfficeRoom refuses itself before doing any work (no LISTEN, no timers).
    await expect(matchMaker.createRoom(OFFICE_ROOM_NAME, {})).rejects.toThrow('office_room_exists');
    expect(await matchMaker.query({ name: OFFICE_ROOM_NAME })).toHaveLength(1);
    // Joining still lands in the one room.
    const j = await joinAs(h, u.id);
    expect(serverRoom(h, j)).toBe(room);
    expect(await matchMaker.query({ name: OFFICE_ROOM_NAME })).toHaveLength(1);
  });
});
