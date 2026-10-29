import { ActivityCode, CloseCodes, MSG, PROTOCOL_VERSION, PlateNote, SourceCode } from '@enu/protocol';
import type { RealtimeTicketDto } from '@enu/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REJOIN_MAX_ATTEMPTS, backoffMs, leaveAction, sdkWillAutoReconnect } from './closeCodes';
import {
  RealtimeSession,
  copyPet,
  TicketError,
  copyPlayer,
  type ClientLike,
  type RoomLike,
  type StateSink,
} from './RealtimeSession';
import type { PlayerSnap } from './types';

const SECRET_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret-ticket.sig';

class FakeRoom implements RoomLike {
  readonly sessionId = 'sess-1';
  readonly sent: Array<[string, unknown]> = [];
  readonly handlers = new Map<string, (p: never) => void>();
  private readonly leaveCbs: Array<(code: number) => void> = [];
  private readonly dropCbs: Array<(code: number) => void> = [];
  private readonly reconnectCbs: Array<() => void> = [];
  readonly leave = vi.fn(async (consented?: boolean) => {
    if (consented !== false) this.fireLeave(4000);
    return 4000;
  });

  send(type: string, payload?: unknown): void {
    this.sent.push([type, payload]);
  }
  onMessage(type: string, cb: (p: never) => void) {
    this.handlers.set(type, cb);
    return () => this.handlers.delete(type);
  }
  onLeave(cb: (code: number) => void) {
    this.leaveCbs.push(cb);
  }
  onDrop(cb: (code: number) => void) {
    this.dropCbs.push(cb);
  }
  onReconnect(cb: () => void) {
    this.reconnectCbs.push(cb);
  }
  onError() {}
  fireLeave(code: number) {
    for (const cb of this.leaveCbs) cb(code);
  }
  fireDrop(code: number) {
    for (const cb of this.dropCbs) cb(code);
  }
  fireReconnect() {
    for (const cb of this.reconnectCbs) cb();
  }
  message(type: string, payload: unknown) {
    this.handlers.get(type)?.(payload as never);
  }
}

interface Harness {
  session: RealtimeSession;
  rooms: FakeRoom[];
  clients: Array<{ url: string; token: string | undefined; joins: Array<[string, unknown]> }>;
  sinks: StateSink[];
  timers: Array<{ fn: () => void; ms: number }>;
  navigate: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  fetchTicket: ReturnType<typeof vi.fn>;
}

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function harness(opts: { mapHash?: string; joinImpl?: (n: number) => Promise<FakeRoom> } = {}): Harness {
  const rooms: FakeRoom[] = [];
  const clients: Harness['clients'] = [];
  const sinks: StateSink[] = [];
  const timers: Harness['timers'] = [];
  let tickets = 0;
  const fetchTicket = vi.fn(async (): Promise<RealtimeTicketDto> => ({
    token: `${SECRET_TOKEN}-${++tickets}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    wsUrl: 'ws://localhost:2567',
  }));
  const navigate = vi.fn();
  const reload = vi.fn();
  const session = new RealtimeSession({
    userId: 'u-me',
    mapHash: opts.mapHash ?? 'hash-a',
    fetchTicket,
    createClient: (url) => {
      const rec = { url, token: undefined as string | undefined, joins: [] as Array<[string, unknown]> };
      clients.push(rec);
      const client: ClientLike = {
        auth: {
          get token() {
            return rec.token;
          },
          set token(v) {
            rec.token = v;
          },
        },
        join: async (name, options) => {
          rec.joins.push([name, options]);
          const room = opts.joinImpl ? await opts.joinImpl(rooms.length) : new FakeRoom();
          rooms.push(room);
          return room;
        },
      };
      return client;
    },
    bindState: (_room, sink) => {
      sinks.push(sink);
      return () => undefined;
    },
    navigate,
    reload,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
    now: () => 1_000_000,
    newId: () => 'client-msg-0001',
  });
  return { session, rooms, clients, sinks, timers, navigate, reload, fetchTicket };
}

const player = (over: Partial<PlayerSnap> = {}): PlayerSnap => ({
  id: 'u-other',
  name: '동료',
  avatar: 'av-m-short-black-sky-warm',
  deskId: 'L1a',
  x: 3,
  y: 5,
  dir: 0,
  anim: 0,
  statusText: '',
  shown: false,
  online: false,
  activity: ActivityCode.None,
  source: SourceCode.None,
  until: 0,
  note: PlateNote.None,
  groupId: '',
  logPulse: 0,
  ...over,
});

describe('closeCodes', () => {
  it('classifies the custom close codes', () => {
    expect(leaveAction(CloseCodes.SessionReplaced, 1)).toEqual({ kind: 'replaced' });
    expect(leaveAction(CloseCodes.Forbidden, 1)).toEqual({ kind: 'forbidden' });
    expect(leaveAction(CloseCodes.MapMismatch, 1)).toEqual({ kind: 'map_mismatch' });
    expect(leaveAction(CloseCodes.ProtocolMismatch, 1)).toEqual({ kind: 'protocol_mismatch' });
    expect(leaveAction(1006, 1, { consentedByUs: true })).toEqual({ kind: 'stopped' });
  });

  it('rejoins other closes with capped exponential backoff, rate limits wait longer', () => {
    const r = () => 0.5;
    expect(leaveAction(1006, 1, { random: r })).toEqual({
      kind: 'rejoin',
      delayMs: 1000,
      rateLimited: false,
    });
    expect(leaveAction(4002, 3, { random: r })).toEqual({
      kind: 'rejoin',
      delayMs: 4000,
      rateLimited: false,
    });
    expect(leaveAction(CloseCodes.RateLimited, 1, { random: r })).toEqual({
      kind: 'rejoin',
      delayMs: 10_000,
      rateLimited: true,
    });
    expect(backoffMs(20, r)).toBe(30_000);
    expect(leaveAction(1006, REJOIN_MAX_ATTEMPTS + 1)).toEqual({ kind: 'failed' });
  });

  it('knows which codes the SDK reconnects by itself', () => {
    expect([1001, 1005, 1006, 4010].every(sdkWillAutoReconnect)).toBe(true);
    expect([1000, 4000, 4002, CloseCodes.SessionReplaced].some(sdkWillAutoReconnect)).toBe(false);
  });
});

describe('RealtimeSession', () => {
  const logs: unknown[][] = [];
  beforeEach(() => {
    logs.length = 0;
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // The ticket must never reach any log line.
    expect(JSON.stringify(logs)).not.toContain('secret-ticket');
  });

  it('joins office-606 with a fresh ticket set as client.auth.token, the protocol version, and sends presence', async () => {
    const h = harness();
    h.session.start();
    await flush();
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]?.url).toBe('ws://localhost:2567');
    expect(h.clients[0]?.token).toBe(`${SECRET_TOKEN}-1`);
    expect(h.clients[0]?.joins).toEqual([['office-606', { mapHash: 'hash-a', protocol: PROTOCOL_VERSION }]]);
    expect(h.session.getStatus()).toEqual({ kind: 'connected' });
    expect(h.rooms[0]?.sent).toContainEqual([MSG.presence, { visible: true, uiBusy: false }]);
  });

  it('4101: shows "replaced" and does not rejoin until asked', async () => {
    const h = harness();
    h.session.start();
    await flush();
    h.rooms[0]?.fireLeave(CloseCodes.SessionReplaced);
    expect(h.session.getStatus()).toEqual({ kind: 'replaced' });
    expect(h.timers).toHaveLength(0);
    h.session.reconnectNow();
    await flush();
    expect(h.fetchTicket).toHaveBeenCalledTimes(2);
    expect(h.clients[1]?.token).toBe(`${SECRET_TOKEN}-2`);
    expect(h.session.getStatus()).toEqual({ kind: 'connected' });
  });

  it('4103: goes to /sign-in', async () => {
    const h = harness();
    h.session.start();
    await flush();
    h.rooms[0]?.fireLeave(CloseCodes.Forbidden);
    expect(h.session.getStatus()).toEqual({ kind: 'forbidden' });
    expect(h.navigate).toHaveBeenCalledWith('/sign-in');
  });

  it('4110: reloads the page', async () => {
    const h = harness();
    h.session.start();
    await flush();
    h.rooms[0]?.fireLeave(CloseCodes.MapMismatch);
    expect(h.session.getStatus()).toEqual({ kind: 'map_mismatch' });
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('4111: a protocol mismatch reloads once (guarded like the map mismatch)', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    try {
      const h = harness();
      h.session.start();
      await flush();
      h.rooms[0]?.fireLeave(CloseCodes.ProtocolMismatch);
      expect(h.session.getStatus()).toEqual({ kind: 'protocol_mismatch' });
      expect(h.reload).toHaveBeenCalledTimes(1);
      expect(h.timers).toHaveLength(0);
      // A second mismatch within the guard window (e.g. the reload still got an old bundle) does not loop.
      const again = harness();
      again.session.start();
      await flush();
      again.rooms[0]?.fireLeave(CloseCodes.ProtocolMismatch);
      expect(again.session.getStatus()).toEqual({ kind: 'protocol_mismatch' });
      expect(again.reload).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('4111 refused in matchmaking (onAuth) is handled the same way', async () => {
    const h = harness({
      joinImpl: async () =>
        Promise.reject(Object.assign(new Error('protocol_mismatch'), { code: CloseCodes.ProtocolMismatch })),
    });
    h.session.start();
    await flush();
    expect(h.session.getStatus()).toEqual({ kind: 'protocol_mismatch' });
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.timers).toHaveLength(0);
  });

  it('a notice_required join error goes to /welcome without retrying', async () => {
    const h = harness({
      joinImpl: async () => Promise.reject(Object.assign(new Error('notice_required'), { code: 4215 })),
    });
    h.session.start();
    await flush();
    expect(h.session.getStatus()).toEqual({ kind: 'notice_required' });
    expect(h.navigate).toHaveBeenCalledWith('/welcome');
    expect(h.timers).toHaveLength(0);
  });

  it('a different map hash in the state also reloads', async () => {
    const h = harness({ mapHash: 'hash-a' });
    h.session.start();
    await flush();
    h.sinks[0]?.mapHash('hash-a');
    expect(h.reload).not.toHaveBeenCalled();
    h.sinks[0]?.mapHash('hash-b');
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('network drop: waits for the SDK to reconnect the same seat', async () => {
    const h = harness();
    h.session.start();
    await flush();
    const room = h.rooms[0] as FakeRoom;
    room.fireDrop(1006);
    expect(h.session.getStatus()).toEqual({ kind: 'reconnecting' });
    expect(h.session.sendChat('hi')).toBeNull();
    room.fireReconnect();
    expect(h.session.getStatus()).toEqual({ kind: 'connected' });
    expect(room.sent.filter(([t]) => t === MSG.presence)).toHaveLength(2);
    expect(h.fetchTicket).toHaveBeenCalledTimes(1);
  });

  it('room ended (expired seat): fetches a NEW ticket and joins again after a backoff', async () => {
    const h = harness();
    h.session.start();
    await flush();
    h.rooms[0]?.fireLeave(1006);
    expect(h.session.getStatus()).toMatchObject({ kind: 'retrying', attempt: 2 });
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.ms).toBe(1000);
    h.timers[0]?.fn();
    await flush();
    expect(h.fetchTicket).toHaveBeenCalledTimes(2);
    expect(h.clients[1]?.token).toBe(`${SECRET_TOKEN}-2`);
    expect(h.session.getStatus()).toEqual({ kind: 'connected' });
  });

  it('gives up after repeated join failures and offers a manual retry', async () => {
    const h = harness({
      joinImpl: async () => Promise.reject(Object.assign(new Error('nope'), { code: 525 })),
    });
    h.session.start();
    await flush();
    for (let i = 0; i < REJOIN_MAX_ATTEMPTS; i++) {
      expect(h.session.getStatus().kind).toBe('retrying');
      h.timers.at(-1)?.fn();
      await flush();
    }
    expect(h.session.getStatus()).toEqual({ kind: 'failed' });
  });

  it('ticket 401 means signed out: go to /sign-in without retrying', async () => {
    const h = harness();
    h.fetchTicket.mockRejectedValueOnce(new TicketError('unauthorized', 401));
    h.session.start();
    await flush();
    expect(h.navigate).toHaveBeenCalledWith('/sign-in');
    expect(h.timers).toHaveLength(0);
  });

  it('stop() while joining leaves the late room instead of attaching it', async () => {
    let release: (r: FakeRoom) => void = () => undefined;
    const late = new FakeRoom();
    const h = harness({ joinImpl: () => new Promise<FakeRoom>((res) => (release = res)) });
    h.session.start();
    await flush();
    h.session.stop();
    release(late);
    await flush();
    expect(late.leave).toHaveBeenCalledWith(true);
    expect(h.session.getStatus()).toEqual({ kind: 'stopped' });
  });

  it('StrictMode start/stop/start ends with exactly one attached room', async () => {
    const h = harness();
    h.session.start();
    h.session.stop();
    h.session.start();
    await flush();
    expect(h.session.getStatus()).toEqual({ kind: 'connected' });
    const attached = h.rooms.filter((r) => r.leave.mock.calls.length === 0);
    expect(attached).toHaveLength(1);
  });

  it('mirrors players as snapshots; roster changes ignore pure movement', async () => {
    const h = harness();
    h.session.start();
    await flush();
    const sink = h.sinks[0] as StateSink;
    const onRoster = vi.fn();
    const onChange = vi.fn();
    h.session.on('roster', onRoster);
    h.session.on('player:change', onChange);
    sink.playerUpsert(player());
    expect(onRoster).toHaveBeenCalledTimes(1);
    sink.playerUpsert(player({ x: 4 }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onRoster).toHaveBeenCalledTimes(1);
    sink.playerUpsert(player({ x: 4, shown: true }));
    expect(onRoster).toHaveBeenCalledTimes(2);
    sink.playerUpsert(player({ x: 4, shown: true, online: true }));
    sink.playerUpsert(player({ x: 4, shown: true, online: true, activity: ActivityCode.Review }));
    sink.playerUpsert(
      player({ x: 4, shown: true, online: true, activity: ActivityCode.Review, logPulse: 1 }),
    );
    expect(onRoster).toHaveBeenCalledTimes(4);
    expect(h.session.getRoster()).toHaveLength(1);
    expect(h.session.getRoster()).toBe(h.session.getRoster());
    sink.playerRemove('u-other');
    expect(h.session.getRoster()).toHaveLength(0);
  });

  it('copies the protocol Player fields (and never the removed status/zoneId)', () => {
    const snap = copyPlayer(
      {
        id: 'u1',
        name: 'A',
        avatar: 'av',
        deskId: 'L1a',
        x: 3,
        y: 5,
        dir: 1,
        anim: 2,
        statusText: '오후 외근',
        shown: true,
        online: true,
        activity: ActivityCode.Meeting,
        source: SourceCode.Calendar,
        until: 1_700_000_000_000,
        note: PlateNote.None,
        groupId: 'gabc',
        logPulse: 7,
        status: 3,
        zoneId: 'meeting',
      },
      'u1',
    );
    expect(snap).toEqual({
      id: 'u1',
      name: 'A',
      avatar: 'av',
      deskId: 'L1a',
      x: 3,
      y: 5,
      dir: 1,
      anim: 2,
      statusText: '오후 외근',
      shown: true,
      online: true,
      activity: ActivityCode.Meeting,
      source: SourceCode.Calendar,
      until: 1_700_000_000_000,
      note: PlateNote.None,
      groupId: 'gabc',
      logPulse: 7,
    });
    expect(snap).not.toHaveProperty('status');
    expect(snap).not.toHaveProperty('zoneId');
    // Missing or malformed fields fall back to "hidden, nothing known".
    expect(copyPlayer({ shown: 'yes', online: 1, until: Number.NaN }, 'k')).toMatchObject({
      id: 'k',
      shown: false,
      online: false,
      until: 0,
      groupId: '',
    });
  });

  it('tracks officeOpen from the state (null until the first value)', async () => {
    const h = harness();
    h.session.start();
    await flush();
    const seen: boolean[] = [];
    h.session.on('office', (open) => seen.push(open));
    expect(h.session.getOfficeOpen()).toBeNull();
    h.sinks[0]?.officeOpen(false);
    h.sinks[0]?.officeOpen(false);
    h.sinks[0]?.officeOpen(true);
    expect(seen).toEqual([false, true]);
    expect(h.session.getOfficeOpen()).toBe(true);
  });

  it('never steers: no step/face senders; waves name a target; status:set carries status and duration', async () => {
    const h = harness();
    h.session.start();
    await flush();
    const room = h.rooms[0] as FakeRoom;
    expect('sendStep' in h.session).toBe(false);
    expect('sendFace' in h.session).toBe(false);
    expect(h.session.wave('')).toBe(false);
    expect(h.session.wave('u-other')).toBe(true);
    expect(h.session.sendStatus({ status: 'focus', duration: '30m', text: '집중' })).toBe(true);
    expect(h.session.sendStatus({ status: 'auto' })).toBe(true);
    expect(room.sent.filter(([t]) => t !== MSG.presence)).toEqual([
      [MSG.wave, { toUserId: 'u-other' }],
      [MSG.statusSet, { status: 'focus', duration: '30m', text: '집중' }],
      [MSG.statusSet, { status: 'auto' }],
    ]);
    expect(room.sent.some(([t]) => t === 'step' || t === 'face')).toBe(false);
  });

  it('sends room chat/dm with a clientMsgId and tracks DM unread counts', async () => {
    const h = harness();
    h.session.start();
    await flush();
    const room = h.rooms[0] as FakeRoom;
    expect(h.session.sendChat('안녕하세요')).toBe('client-msg-0001');
    expect(room.sent).toContainEqual([MSG.chatSend, { text: '안녕하세요', clientMsgId: 'client-msg-0001' }]);
    room.message(MSG.dmUnread, { total: 2, byPeer: { a: 2 } });
    room.message(MSG.dmMsg, {
      id: 'd1',
      fromUserId: 'b',
      fromName: 'B',
      toUserId: 'u-me',
      text: 'x',
      createdAt: '',
    });
    expect(h.session.getDmUnread()).toEqual({ total: 3, byPeer: { a: 2, b: 1 } });
    h.session.setActiveDmPeer('a');
    room.message(MSG.dmMsg, {
      id: 'd2',
      fromUserId: 'a',
      fromName: 'A',
      toUserId: 'u-me',
      text: 'y',
      createdAt: '',
    });
    expect(h.session.getDmUnread().byPeer.a).toBe(2);
    h.session.markDmRead('a', 'd2');
    expect(room.sent).toContainEqual([MSG.dmRead, { peerUserId: 'a', lastMessageId: 'd2' }]);
    expect(h.session.getDmUnread()).toEqual({ total: 1, byPeer: { b: 1 } });
  });

  it('keys pets by pet id and finds the pet that matters for an owner', async () => {
    const h = harness();
    h.session.start();
    await flush();
    const sink = h.sinks[0] as StateSink;
    const pet = (petId: string, slot: number, over: Record<string, unknown> = {}) =>
      copyPet(
        { petId, ownerId: 'u-me', slot, species: 'cat', tint: slot ? 'mint' : 'base', name: petId, ...over },
        petId,
      );
    sink.petUpsert(pet('p1', 1));
    sink.petUpsert(pet('p0', 0));
    sink.petUpsert(copyPet({ petId: 'q0', ownerId: 'u-other', slot: 0, species: 'fox', name: 'q' }, 'q0'));
    expect(h.session.petsOf('u-me').map((p) => p.petId)).toEqual(['p0', 'p1']);
    expect(h.session.getPet('u-me')?.petId).toBe('p0');
    expect(h.session.getPet('u-other')?.tint).toBe('base');
    // The pet carrying my bubble wins (only the owner ever decodes bubble fields).
    sink.petUpsert(pet('p1', 1, { bubbleId: 'b1', bubbleText: '리뷰 하나만 먼저!' }));
    expect(h.session.getPet('u-me')?.petId).toBe('p1');
    sink.petRemove('p1');
    expect(h.session.petsOf('u-me').map((p) => p.petId)).toEqual(['p0']);
    expect(h.session.getPetById('q0')?.ownerId).toBe('u-other');
  });

  it('passes the owner-only pet refetch signal on with ids only', async () => {
    const h = harness();
    const seen: unknown[] = [];
    h.session.on('pet:refetch', (m) => seen.push(m));
    h.session.start();
    await flush();
    const room = h.rooms[0] as FakeRoom;
    room.message(MSG.petChanged, { petId: 'p-1', text: 'ignored' });
    room.message(MSG.petChanged, { petId: null });
    room.message(MSG.petChanged, undefined);
    expect(seen).toEqual([{ petId: 'p-1' }, { petId: null }, { petId: null }]);
  });

  it('presence is sent only when it changes', async () => {
    const h = harness();
    h.session.start();
    await flush();
    const room = h.rooms[0] as FakeRoom;
    h.session.setPresence({ uiBusy: true });
    h.session.setPresence({ uiBusy: true });
    h.session.setPresence({ visible: false });
    expect(room.sent.filter(([t]) => t === MSG.presence).map(([, p]) => p)).toEqual([
      { visible: true, uiBusy: false },
      { visible: true, uiBusy: true },
      { visible: false, uiBusy: true },
    ]);
  });
});
