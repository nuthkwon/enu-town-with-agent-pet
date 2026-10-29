import { Callbacks, Client } from '@colyseus/sdk';
import {
  MSG,
  PROTOCOL_VERSION,
  type ChatAckMsg,
  type ChatMsg,
  type DmMsg,
  type DmUnreadMsg,
  type EmoteMsg,
  type ErrorMsg,
  type JoinOptions,
  type NoticeMsg,
  type OfficeState,
  type PetChangedMsg,
  type PingedMsg,
  type StatusSetMsg,
} from '@enu/protocol';
import { OFFICE_ROOM_NAME, type RealtimeTicketDto } from '@enu/shared';
import { TypedEmitter } from '../game/emitter';
import { leaveAction, sdkWillAutoReconnect } from './closeCodes';
import type { ConnectionStatus, PetSnap, PlayerSnap, PresenceState, SessionEvents } from './types';

/* ----------------------------------------------------------------------------------------------
 * Minimal views of the Colyseus SDK (so tests can inject fakes without a server).
 * -------------------------------------------------------------------------------------------- */

type Unsubscribe = () => void;

export interface RoomLike {
  readonly sessionId: string;
  send(type: string, payload?: unknown): void;
  onMessage(type: string, cb: (payload: never) => void): Unsubscribe;
  onLeave(cb: (code: number, reason?: string) => void): unknown;
  onDrop(cb: (code: number, reason?: string) => void): unknown;
  onReconnect(cb: () => void): unknown;
  onError(cb: (code: number, message?: string) => void): unknown;
  leave(consented?: boolean): Promise<number>;
}

export interface ClientLike {
  auth: { token: string | undefined };
  /** Join only: the realtime server creates the one room itself and refuses client `create`/`joinOrCreate`. */
  join(roomName: string, options?: Record<string, unknown>): Promise<RoomLike>;
}

/** Receives the decoded room state as plain snapshots. */
export interface StateSink {
  playerUpsert(p: PlayerSnap): void;
  playerRemove(id: string): void;
  petUpsert(p: PetSnap): void;
  petRemove(ownerId: string): void;
  mapHash(hash: string): void;
  officeOpen(open: boolean): void;
}

/** Wires a joined room's state callbacks to a sink; returns an unbind function. */
export type StateBinder = (room: RoomLike, sink: StateSink) => Unsubscribe;

export class TicketError extends Error {
  constructor(
    readonly reason: 'unauthorized' | 'forbidden' | 'http' | 'network',
    readonly status: number,
  ) {
    super(`realtime ticket request failed (${reason}, ${status})`);
    this.name = 'TicketError';
  }
}

export interface RealtimeSessionOptions {
  userId: string;
  /** sha256 of the .tmj the client renders (sent on join and compared with state.mapHash). */
  mapHash?: string | null;
  fetchTicket?: () => Promise<RealtimeTicketDto>;
  createClient?: (wsUrl: string) => ClientLike;
  bindState?: StateBinder;
  navigate?: (url: string) => void;
  reload?: () => void;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
  newId?: () => string;
}

/* ----------------------------------------------------------------------------------------------
 * Defaults (browser)
 * -------------------------------------------------------------------------------------------- */

export async function fetchRealtimeTicket(): Promise<RealtimeTicketDto> {
  let res: Response;
  try {
    res = await fetch('/api/realtime-ticket', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new TicketError('network', 0);
  }
  if (res.status === 401) throw new TicketError('unauthorized', 401);
  if (res.status === 403) throw new TicketError('forbidden', 403);
  if (!res.ok) throw new TicketError('http', res.status);
  return (await res.json()) as RealtimeTicketDto;
}

function createSdkClient(wsUrl: string): ClientLike {
  return new Client(wsUrl) as unknown as ClientLike;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const bool = (v: unknown): boolean => v === true;

/** Copies exactly the protocol's Player fields (anything else on the instance is ignored). */
export function copyPlayer(p: Record<string, unknown>, key: string): PlayerSnap {
  return {
    id: str(p.id) || key,
    name: str(p.name),
    avatar: str(p.avatar),
    deskId: str(p.deskId),
    x: num(p.x),
    y: num(p.y),
    dir: num(p.dir),
    anim: num(p.anim),
    statusText: str(p.statusText),
    shown: bool(p.shown),
    online: bool(p.online),
    activity: num(p.activity),
    source: num(p.source),
    until: num(p.until),
    note: num(p.note),
    groupId: str(p.groupId),
    logPulse: num(p.logPulse),
  };
}

export function copyPet(p: Record<string, unknown>, key: string): PetSnap {
  return {
    ownerId: str(p.ownerId) || key,
    species: str(p.species),
    name: str(p.name),
    x: num(p.x),
    y: num(p.y),
    dir: num(p.dir),
    anim: num(p.anim),
    linkState: num(p.linkState),
    indicator: num(p.indicator),
    bubbleId: str(p.bubbleId),
    bubbleKind: num(p.bubbleKind),
    bubbleText: str(p.bubbleText),
    bubbleDueAt: num(p.bubbleDueAt),
    bubbleUntil: num(p.bubbleUntil),
  };
}

/** Default binder: Colyseus schema callbacks -> plain snapshots. */
export const bindColyseusState: StateBinder = (room, sink) => {
  const cb = Callbacks.get(room as unknown as Parameters<typeof Callbacks.get<OfficeState>>[0]);
  const offs: Unsubscribe[] = [];
  offs.push(
    cb.onAdd('players', (player, key) => {
      const push = () =>
        sink.playerUpsert(copyPlayer(player as unknown as Record<string, unknown>, String(key)));
      push();
      offs.push(cb.onChange(player, push));
    }),
  );
  offs.push(cb.onRemove('players', (_player, key) => sink.playerRemove(String(key))));
  offs.push(
    cb.onAdd('pets', (pet, key) => {
      const push = () => sink.petUpsert(copyPet(pet as unknown as Record<string, unknown>, String(key)));
      push();
      offs.push(cb.onChange(pet, push));
    }),
  );
  offs.push(cb.onRemove('pets', (_pet, key) => sink.petRemove(String(key))));
  offs.push(
    cb.listen('mapHash', (value) => {
      if (typeof value === 'string' && value) sink.mapHash(value);
    }),
  );
  offs.push(cb.listen('officeOpen', (value) => sink.officeOpen(value === true)));
  return () => {
    for (const off of offs.splice(0)) {
      try {
        off();
      } catch {
        /* room already disposed */
      }
    }
  };
};

/** Fields that change what lists, menus and counts show (positions and logPulse do not). */
const ROSTER_PLAYER_FIELDS = [
  'name',
  'avatar',
  'deskId',
  'statusText',
  'shown',
  'online',
  'activity',
  'source',
  'until',
  'note',
  'groupId',
] as const satisfies readonly (keyof PlayerSnap)[];
const ROSTER_PET_FIELDS = [
  'species',
  'name',
  'linkState',
  'indicator',
  'bubbleId',
  'bubbleText',
  'bubbleDueAt',
  'bubbleUntil',
] as const;

const MAP_RELOAD_KEY = 'enu-den:map-reload-at';
const PROTOCOL_RELOAD_KEY = 'enu-den:protocol-reload-at';
const RELOAD_GUARD_MS = 60_000;
/** Join error message (onAuth) for a user who has not accepted the current privacy notice yet. */
export const NOTICE_REQUIRED = 'notice_required';

/**
 * One realtime connection to `office-606` for the signed-in user.
 *
 * - ticket (GET /api/realtime-ticket) -> new Client(wsUrl) -> client.auth.token -> join (never create:
 *   while the server is still booting, "no rooms found" is retried with the backoff below).
 * - Network drops: the SDK re-establishes the same seat by itself (status 'reconnecting').
 * - When the room really ends (expired seat, server restart, errors) we fetch a NEW ticket and
 *   join again with exponential backoff. 4101 / 4103 / 4110 / 4111 are terminal (see closeCodes.ts);
 *   a `notice_required` join error sends the user to /welcome.
 * - Nothing here ever moves an avatar: the server director places everyone.
 * - start()/stop() can be called repeatedly (React StrictMode): every start bumps a generation and
 *   stale async continuations are dropped.
 *
 * The ticket is never logged or stored anywhere but `client.auth.token`.
 */
export class RealtimeSession extends TypedEmitter<SessionEvents> {
  readonly userId: string;
  private readonly opts: Required<Omit<RealtimeSessionOptions, 'mapHash' | 'userId'>>;
  private expectedMapHash: string | null;

  private generation = 0;
  private room: RoomLike | null = null;
  private unbind: Unsubscribe | null = null;
  private offMessages: Unsubscribe[] = [];
  private retryTimer: unknown = null;
  private failures = 0;
  private leavingByUs = false;
  private running = false;

  private status: ConnectionStatus = { kind: 'idle' };
  private readonly players = new Map<string, PlayerSnap>();
  private readonly pets = new Map<string, PetSnap>();
  private rosterVersion = 0;
  private rosterCache: { version: number; players: PlayerSnap[] } | null = null;
  private presence: PresenceState = { visible: true, uiBusy: false };
  private sentPresence: string | null = null;
  private dmUnread: DmUnreadMsg = { total: 0, byPeer: {} };
  private activeDmPeer: string | null = null;
  private serverMapHash: string | null = null;
  private officeOpen: boolean | null = null;

  constructor(options: RealtimeSessionOptions) {
    super();
    this.userId = options.userId;
    this.expectedMapHash = options.mapHash ?? null;
    this.opts = {
      fetchTicket: options.fetchTicket ?? fetchRealtimeTicket,
      createClient: options.createClient ?? createSdkClient,
      bindState: options.bindState ?? bindColyseusState,
      navigate: options.navigate ?? ((url) => window.location.assign(url)),
      reload: options.reload ?? (() => window.location.reload()),
      random: options.random ?? Math.random,
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      now: options.now ?? (() => Date.now()),
      newId:
        options.newId ??
        (() =>
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`),
    };
  }

  /* ------------------------------------------------------------------ lifecycle */

  setMapHash(hash: string | null): void {
    this.expectedMapHash = hash;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.failures = 0;
    const gen = ++this.generation;
    void this.connect(gen, 1);
  }

  /** Consented leave; safe to call while connecting. */
  stop(): void {
    this.running = false;
    this.generation++;
    this.clearRetry();
    const room = this.room;
    this.detachRoom();
    if (room) {
      this.leavingByUs = true;
      room.leave(true).catch(() => undefined);
    }
    this.setStatus({ kind: 'stopped' });
  }

  /** Manual retry (banner button after 4101 or after giving up). */
  reconnectNow(): void {
    this.clearRetry();
    const room = this.room;
    this.detachRoom();
    if (room) room.leave(true).catch(() => undefined);
    this.running = true;
    this.failures = 0;
    const gen = ++this.generation;
    void this.connect(gen, 1);
  }

  dispose(): void {
    this.stop();
    this.clear();
  }

  private async connect(gen: number, attempt: number): Promise<void> {
    this.setStatus({ kind: 'connecting', attempt });
    let room: RoomLike;
    try {
      const ticket = await this.opts.fetchTicket();
      if (gen !== this.generation) return;
      const client = this.opts.createClient(ticket.wsUrl);
      client.auth.token = ticket.token;
      const options: JoinOptions = { protocol: PROTOCOL_VERSION };
      if (this.expectedMapHash) options.mapHash = this.expectedMapHash;
      room = await client.join(OFFICE_ROOM_NAME, { ...options });
    } catch (err) {
      if (gen !== this.generation) return;
      if (err instanceof TicketError && (err.reason === 'unauthorized' || err.reason === 'forbidden')) {
        this.goForbidden();
        return;
      }
      if (joinErrorMessage(err) === NOTICE_REQUIRED) {
        this.goNoticeRequired();
        return;
      }
      const code = joinErrorCode(err);
      if (code !== null && code >= 4100) {
        this.handleLeaveCode(gen, code);
        return;
      }
      this.scheduleRejoin(gen);
      return;
    }
    if (gen !== this.generation) {
      room.leave(true).catch(() => undefined);
      return;
    }
    this.attachRoom(room, gen);
  }

  private attachRoom(room: RoomLike, gen: number): void {
    this.room = room;
    this.leavingByUs = false;
    this.players.clear();
    this.pets.clear();
    this.serverMapHash = null;
    this.officeOpen = null;
    this.sentPresence = null;
    this.bumpRoster();
    this.emit('reset');

    this.unbind = this.opts.bindState(room, {
      playerUpsert: (p) => this.upsertPlayer(p),
      playerRemove: (id) => this.removePlayer(id),
      petUpsert: (p) => this.upsertPet(p),
      petRemove: (id) => this.removePet(id),
      mapHash: (h) => this.onMapHash(h),
      officeOpen: (open) => this.onOfficeOpen(open),
    });

    const on = <T>(type: string, fn: (payload: T) => void) => {
      this.offMessages.push(room.onMessage(type, fn as (payload: never) => void));
    };
    on<ChatMsg>(MSG.chatMsg, (m) => this.emit('chat:msg', m));
    on<ChatAckMsg>(MSG.chatAck, (m) => this.emit('chat:ack', m));
    on<DmMsg>(MSG.dmMsg, (m) => this.onDm(m));
    on<DmUnreadMsg>(MSG.dmUnread, (m) => {
      this.dmUnread = { total: num(m?.total), byPeer: { ...(m?.byPeer ?? {}) } };
      if (this.activeDmPeer) this.zeroPeer(this.activeDmPeer);
      this.emit('dm:unread', this.dmUnread);
    });
    on<EmoteMsg>(MSG.emote, (m) => this.emit('emote', m));
    on<PingedMsg>(MSG.pinged, (m) => this.emit('pinged', m));
    on<NoticeMsg>(MSG.notice, (m) => this.emit('notice', m));
    on<PetChangedMsg>(MSG.petChanged, (m) => {
      this.emit('pet:refetch', { petId: typeof m?.petId === 'string' ? m.petId : null });
    });
    on<ErrorMsg>(MSG.error, (m) => {
      if (m) this.emit('server:error', m);
    });

    room.onDrop((code) => {
      if (gen !== this.generation) return;
      if (sdkWillAutoReconnect(code)) this.setStatus({ kind: 'reconnecting' });
    });
    room.onReconnect(() => {
      if (gen !== this.generation) return;
      this.sentPresence = null;
      this.setStatus({ kind: 'connected' });
      this.flushPresence();
    });
    room.onLeave((code) => {
      if (gen !== this.generation) return;
      const byUs = this.leavingByUs;
      this.detachRoom();
      if (byUs) {
        this.setStatus({ kind: 'stopped' });
        return;
      }
      this.handleLeaveCode(gen, code);
    });
    room.onError(() => {
      /* surfaced through onLeave; never log payloads (they may echo request data) */
    });

    this.failures = 0;
    this.setStatus({ kind: 'connected' });
    this.flushPresence();
  }

  private detachRoom(): void {
    for (const off of this.offMessages.splice(0)) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.unbind?.();
    this.unbind = null;
    this.room = null;
  }

  private handleLeaveCode(gen: number, code: number): void {
    const action = leaveAction(code, this.failures + 1, { random: this.opts.random });
    switch (action.kind) {
      case 'replaced':
        this.running = false;
        this.setStatus({ kind: 'replaced' });
        return;
      case 'forbidden':
        this.goForbidden();
        return;
      case 'map_mismatch':
        this.goMapMismatch();
        return;
      case 'protocol_mismatch':
        this.goProtocolMismatch();
        return;
      case 'stopped':
        this.setStatus({ kind: 'stopped' });
        return;
      case 'failed':
        this.running = false;
        this.setStatus({ kind: 'failed' });
        return;
      case 'rejoin':
        this.failures++;
        this.armRetry(gen, action.delayMs);
        return;
    }
  }

  private scheduleRejoin(gen: number): void {
    this.handleLeaveCode(gen, -1);
  }

  private armRetry(gen: number, delayMs: number): void {
    this.clearRetry();
    const attempt = this.failures + 1;
    this.setStatus({ kind: 'retrying', attempt, retryAt: this.opts.now() + delayMs });
    this.retryTimer = this.opts.setTimer(() => {
      this.retryTimer = null;
      if (gen !== this.generation) return;
      void this.connect(gen, attempt);
    }, delayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      this.opts.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private goForbidden(): void {
    this.running = false;
    this.generation++;
    this.clearRetry();
    this.setStatus({ kind: 'forbidden' });
    this.opts.navigate('/sign-in');
  }

  private goNoticeRequired(): void {
    this.running = false;
    this.generation++;
    this.clearRetry();
    this.setStatus({ kind: 'notice_required' });
    this.opts.navigate('/welcome');
  }

  private goMapMismatch(): void {
    this.stopForReload({ kind: 'map_mismatch' }, MAP_RELOAD_KEY);
  }

  /** The server speaks another protocol version (a deploy happened): reload once to get the new client. */
  private goProtocolMismatch(): void {
    this.stopForReload({ kind: 'protocol_mismatch' }, PROTOCOL_RELOAD_KEY);
  }

  /** Terminal state + at most one automatic reload per minute (a reload loop would hide the banner). */
  private stopForReload(status: ConnectionStatus, guardKey: string): void {
    this.running = false;
    this.generation++;
    this.clearRetry();
    const room = this.room;
    this.detachRoom();
    if (room) room.leave(true).catch(() => undefined);
    this.setStatus(status);
    let allowed = true;
    try {
      const last = Number(window.sessionStorage.getItem(guardKey) ?? '0');
      allowed = !(last > 0 && this.opts.now() - last < RELOAD_GUARD_MS);
      if (allowed) window.sessionStorage.setItem(guardKey, String(this.opts.now()));
    } catch {
      /* storage unavailable: reload once anyway */
    }
    if (allowed) this.opts.reload();
  }

  private onMapHash(hash: string): void {
    this.serverMapHash = hash;
    this.emit('map:hash', hash);
    if (this.expectedMapHash && hash !== this.expectedMapHash) this.goMapMismatch();
  }

  private onOfficeOpen(open: boolean): void {
    if (this.officeOpen === open) return;
    this.officeOpen = open;
    this.emit('office', open);
  }

  /* ------------------------------------------------------------------ state */

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.emit('status', s);
  }

  private bumpRoster(): void {
    this.rosterVersion++;
    this.emit('roster');
  }

  private upsertPlayer(p: PlayerSnap): void {
    const prev = this.players.get(p.id);
    this.players.set(p.id, p);
    if (!prev) {
      this.emit('player:add', p);
      this.bumpRoster();
      return;
    }
    this.emit('player:change', { player: p, prev });
    if (ROSTER_PLAYER_FIELDS.some((k) => prev[k] !== p[k])) this.bumpRoster();
  }

  private removePlayer(id: string): void {
    const prev = this.players.get(id);
    if (!prev) return;
    this.players.delete(id);
    this.emit('player:remove', prev);
    this.bumpRoster();
  }

  private upsertPet(p: PetSnap): void {
    const prev = this.pets.get(p.ownerId);
    this.pets.set(p.ownerId, p);
    if (!prev) {
      this.emit('pet:add', p);
      this.bumpRoster();
      return;
    }
    this.emit('pet:change', { pet: p, prev });
    if (ROSTER_PET_FIELDS.some((k) => prev[k] !== p[k])) this.bumpRoster();
  }

  private removePet(ownerId: string): void {
    const prev = this.pets.get(ownerId);
    if (!prev) return;
    this.pets.delete(ownerId);
    this.emit('pet:remove', prev);
    this.bumpRoster();
  }

  private onDm(m: DmMsg): void {
    if (
      m &&
      m.toUserId === this.userId &&
      m.fromUserId !== this.userId &&
      m.fromUserId !== this.activeDmPeer
    ) {
      const byPeer = {
        ...this.dmUnread.byPeer,
        [m.fromUserId]: (this.dmUnread.byPeer[m.fromUserId] ?? 0) + 1,
      };
      this.dmUnread = { total: this.dmUnread.total + 1, byPeer };
      this.emit('dm:unread', this.dmUnread);
    }
    this.emit('dm:msg', m);
  }

  private zeroPeer(peer: string): void {
    const n = this.dmUnread.byPeer[peer] ?? 0;
    if (n === 0) return;
    const byPeer = { ...this.dmUnread.byPeer };
    delete byPeer[peer];
    this.dmUnread = { total: Math.max(0, this.dmUnread.total - n), byPeer };
  }

  /* ------------------------------------------------------------------ getters (stable snapshots) */

  getStatus(): ConnectionStatus {
    return this.status;
  }

  get connected(): boolean {
    return this.status.kind === 'connected' && this.room !== null;
  }

  getPlayer(id: string): PlayerSnap | undefined {
    return this.players.get(id);
  }

  getPet(ownerId: string): PetSnap | undefined {
    return this.pets.get(ownerId);
  }

  allPlayers(): IterableIterator<PlayerSnap> {
    return this.players.values();
  }

  allPets(): IterableIterator<PetSnap> {
    return this.pets.values();
  }

  getRosterVersion(): number {
    return this.rosterVersion;
  }

  /** Stable array (same reference until the roster changes) for useSyncExternalStore. */
  getRoster(): PlayerSnap[] {
    if (!this.rosterCache || this.rosterCache.version !== this.rosterVersion) {
      this.rosterCache = { version: this.rosterVersion, players: [...this.players.values()] };
    }
    return this.rosterCache.players;
  }

  getDmUnread(): DmUnreadMsg {
    return this.dmUnread;
  }

  getServerMapHash(): string | null {
    return this.serverMapHash;
  }

  /** `OfficeState.officeOpen` (null until the first state arrives, e.g. while connecting). */
  getOfficeOpen(): boolean | null {
    return this.officeOpen;
  }

  /* ------------------------------------------------------------------ sending */

  private send(type: string, payload: unknown): boolean {
    const room = this.room;
    if (!room || this.status.kind !== 'connected') return false;
    try {
      room.send(type, payload);
      return true;
    } catch {
      return false;
    }
  }

  /** Room (전체) chat. Returns the clientMsgId, or null when not connected. */
  sendChat(text: string): string | null {
    const clientMsgId = this.opts.newId();
    return this.send(MSG.chatSend, { text, clientMsgId }) ? clientMsgId : null;
  }

  sendDm(toUserId: string, text: string): string | null {
    const clientMsgId = this.opts.newId();
    return this.send(MSG.dmSend, { toUserId, text, clientMsgId }) ? clientMsgId : null;
  }

  /** Marks a DM conversation read (server + local badge). */
  markDmRead(peerUserId: string, lastMessageId: string | null): void {
    if (lastMessageId) this.send(MSG.dmRead, { peerUserId, lastMessageId });
    const before = this.dmUnread.total;
    this.zeroPeer(peerUserId);
    if (this.dmUnread.total !== before) this.emit('dm:unread', this.dmUnread);
  }

  /** The DM conversation currently on screen (its incoming messages do not count as unread). */
  setActiveDmPeer(peerUserId: string | null): void {
    this.activeDmPeer = peerUserId;
  }

  /** A public wave at a colleague (everyone sees the arc; the server checks both are shown). */
  wave(toUserId: string): boolean {
    return toUserId ? this.send(MSG.wave, { toUserId }) : false;
  }

  ping(toUserId: string): boolean {
    return this.send(MSG.ping, { toUserId });
  }

  /** `status:set`: `auto` clears the manual status (상태 문구 stays); `text`, when sent, is written for any status. */
  sendStatus(msg: StatusSetMsg): boolean {
    return this.send(MSG.statusSet, msg);
  }

  bubbleSeen(bubbleId: string): boolean {
    return bubbleId ? this.send(MSG.bubbleSeen, { bubbleId }) : false;
  }

  setPresence(patch: Partial<PresenceState>): void {
    this.presence = { ...this.presence, ...patch };
    this.flushPresence();
  }

  getPresence(): PresenceState {
    return this.presence;
  }

  private flushPresence(): void {
    const key = `${this.presence.visible ? 1 : 0}${this.presence.uiBusy ? 1 : 0}`;
    if (key === this.sentPresence) return;
    if (this.send(MSG.presence, { visible: this.presence.visible, uiBusy: this.presence.uiBusy })) {
      this.sentPresence = key;
    }
  }
}

/** Extracts a numeric close/error code from a join failure (MatchMakeError / ServerError). */
function joinErrorCode(err: unknown): number | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code: unknown }).code;
    if (typeof c === 'number') return c;
  }
  return null;
}

/** The reason string the server put into a join failure (`ServerError(code, reason)` in onAuth). */
function joinErrorMessage(err: unknown): string | null {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return null;
}
