import { CloseCode, ErrorCode, Room, ServerError, type AuthContext, type Client, type Deferred } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { profiles } from '@enu/db';
import { DEFAULT_TIMING, type PolicyTiming } from '@enu/domain';
import { nearbyRecipients, type OfficeWorld, type Point, type ProximityPlayer } from '@enu/map';
import {
  Anim,
  C2S,
  CloseCodes,
  Dir,
  MSG,
  OfficeState,
  Pet,
  Player,
  STEP_MS,
  Status,
  linkStateToCode,
  type ChatAckMsg,
  type ChatMsg,
  type DmMsg,
  type EmoteMsg,
  type MoveCorrectMsg,
  type NoticeMsg,
  type PingedMsg,
} from '@enu/protocol';
import {
  LIMITS,
  OFFICE_ROOM_NAME,
  ZONE_LABEL_KO,
  graphemeLength,
  normalizeLine,
  type LinkState,
  type TownEvent,
  type ZoneId,
} from '@enu/shared';
import { eq } from 'drizzle-orm';
import { TicketError, isOriginAllowed, verifyTicket, type AuthData } from '../auth/verifyTicket';
import { ChatService, prepareChatText } from '../chat/ChatService';
import { monotonicMs } from '../clock';
import { getRealtimeContext, type RealtimeContext } from '../context';
import { DbEvents } from '../infra/DbEvents';
import { loadRecentPresence, savePresence } from '../infra/presence';
import { loadUserSnapshot } from '../infra/profiles';
import { BubblePresenter, createDbDeliveryStore } from '../pet/BubblePresenter';
import { CandidateLoader } from '../pet/CandidateLoader';
import { NudgeScheduler } from '../pet/NudgeScheduler';
import { loadOfficeMap } from '../world/loadMap';
import { chooseSpawn, adjacentWalkable, stepTarget } from '../world/Movement';
import { PetFollower } from '../world/PetFollower';
import type { ErrorMsg } from './errors';
import { createClientLimits, type ClientLimits } from './limits';

export interface OfficeUserData {
  userId: string;
}

export type OfficeClient = Client<{ auth: AuthData; userData: OfficeUserData }>;

/** Seconds a dropped connection keeps its seat (and avatar) for an automatic reconnect. */
export const RECONNECT_SECONDS = 20;
export const RESYNC_INTERVAL_MS = 5 * 60 * 1000;
export const ISOLATED_ZONES: readonly string[] = ['meeting'];
/** Zones whose label is shown as status text when the user has no custom text. */
const AUTO_TEXT_ZONES: readonly ZoneId[] = ['pantry', 'balcony'];
const WALK_SETTLE_MS = Math.round(STEP_MS * 1.6);

/** Close codes after which a seat is never held for reconnection. */
const NO_RECONNECT_CODES: ReadonlySet<number> = new Set<number>([
  ...Object.values(CloseCodes),
  CloseCode.WITH_ERROR,
  CloseCode.SERVER_SHUTDOWN,
]);

const WORK_LOG_PUBLISHED_TEXT = '새 업무 로그가 전사 공개되었어요';

interface Session {
  userId: string;
  sessionId: string;
  client: OfficeClient;
  auth: AuthData;
  player: Player;
  pet: Pet;
  follower: PetFollower;
  limits: ClientLimits;
  /** Status the user chose (the meeting zone may override it while inside). */
  baseStatus: Status;
  customStatusText: string;
  lastStepAt: number;
  reconnection: Deferred<Client> | null;
  /** Another connection of the same user took over (or the user was kicked). */
  ended: boolean;
}

/** The part of a zod schema the room uses (zod itself is a dependency of @enu/protocol only). */
interface SafeParser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}
type Handler<T> = (session: Session, msg: T) => void | Promise<void>;

/**
 * The one office room (`office-606`). Server-authoritative grid movement, pets, chat and the
 * owner-only pet bubbles. Players and pets are keyed by user id: one live session per user.
 */
export class OfficeRoom extends Room<{ state: OfficeState; client: OfficeClient }> {
  override maxClients = 30;
  override autoDispose = false;
  override patchRate = 50;
  override maxMessagesPerSecond = 40;
  override state = new OfficeState();

  private ctx!: RealtimeContext;
  private world!: OfficeWorld;
  private chat!: ChatService;
  private presenter!: BubblePresenter;
  private loader!: CandidateLoader;
  private scheduler!: NudgeScheduler;
  private events: DbEvents | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly byUser = new Map<string, Session>();

  /**
   * Runs on the HTTP matchmake request only (not on the WebSocket connect or on reconnect):
   * ticket required, Origin allow-list, then the DB re-check in verifyTicket.
   */
  static override async onAuth(token: string, _options: unknown, context: AuthContext): Promise<AuthData> {
    const ctx = getRealtimeContext();
    if (!token) throw new ServerError(ErrorCode.AUTH_FAILED, 'missing_ticket');
    const origin = context.headers.get('origin');
    if (!isOriginAllowed(origin, ctx.env.ALLOWED_ORIGINS)) {
      ctx.logger.warn({ origin, ip: context.ip }, 'join rejected: origin not allowed');
      throw new ServerError(ErrorCode.AUTH_FAILED, 'origin_not_allowed');
    }
    try {
      return await verifyTicket(token, {
        secret: ctx.env.REALTIME_TICKET_SECRET,
        allowedHd: ctx.env.ALLOWED_GOOGLE_HD,
        db: ctx.db,
      });
    } catch (err) {
      if (err instanceof TicketError) {
        ctx.logger.info({ reason: err.reason, ip: context.ip }, 'join rejected');
        throw new ServerError(ErrorCode.AUTH_FAILED, err.reason);
      }
      ctx.logger.error({ err }, 'ticket verification failed');
      throw new ServerError(ErrorCode.AUTH_FAILED, 'auth_unavailable');
    }
  }

  override async onCreate(): Promise<void> {
    this.ctx = getRealtimeContext();
    const { env, db, logger, clock } = this.ctx;
    const map = loadOfficeMap(env.MAPS_DIR);
    if (map.metaHash && map.metaHash !== map.mapHash) {
      logger.warn({ mapHash: map.mapHash, metaHash: map.metaHash }, 'map file differs from its meta.json (run pnpm map:check)');
    }
    this.world = map.world;
    this.state.mapId = map.mapId;
    this.state.mapHash = map.mapHash;

    const timing: PolicyTiming = {
      ...DEFAULT_TIMING,
      joinDelayMs: env.NUDGE_JOIN_DELAY_MS ?? DEFAULT_TIMING.joinDelayMs,
    };
    this.chat = new ChatService(db);
    this.loader = new CandidateLoader({ db, clock, timing, minIntervalOverrideMin: env.NUDGE_MIN_INTERVAL_MIN });
    this.presenter = new BubblePresenter({ store: createDbDeliveryStore(db), clock, logger });
    this.scheduler = new NudgeScheduler({
      loader: this.loader,
      presenter: this.presenter,
      clock,
      timing,
      logger,
      hooks: {
        pet: (userId) => this.byUser.get(userId)?.pet ?? null,
        doNotDisturb: (userId) => {
          const s = this.byUser.get(userId);
          if (!s) return true;
          const st = s.player.status;
          return st === Status.Focus || st === Status.Meeting || ISOLATED_ZONES.includes(s.player.zoneId);
        },
      },
    });

    this.registerMessages();
    this.setTimestep(() => this.fastTick(), 50);
    this.clock.setInterval(() => void this.scheduler.tick(), env.NUDGE_TICK_MS);
    this.clock.setInterval(() => void this.resyncAll(), RESYNC_INTERVAL_MS);

    this.events = new DbEvents({
      connectionString: env.DATABASE_URL,
      logger,
      onEvent: (event) => void this.handleTownEvent(event),
      onReconnect: () => void this.resyncAll(),
    });
    await this.events.start();
    logger.info({ room: OFFICE_ROOM_NAME, roomId: this.roomId, mapHash: map.mapHash }, 'office room created');
  }

  override async onDispose(): Promise<void> {
    await this.events?.stop();
    this.events = null;
  }

  override onUncaughtException(error: Error, methodName: string): void {
    this.ctx?.logger.error({ err: error, methodName }, 'uncaught room exception');
  }

  // ---------------------------------------------------------------------------------------------
  // lifecycle

  override async onJoin(client: OfficeClient): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new ServerError(ErrorCode.AUTH_FAILED, 'unauthenticated');
    const { db, clock, logger } = this.ctx;
    const userId = auth.userId;
    client.userData = { userId };

    const lastPresence = auth.deskId ? null : await loadRecentPresence(db, userId, clock.now());

    // Everything below up to the replacement is synchronous, so concurrent joins of one user
    // always end with exactly one live session.
    const occupied = [...this.byUser.values()].filter((s) => s.userId !== userId).map((s) => s.player);
    const spawn = chooseSpawn(this.world, { deskId: auth.deskId, lastPresence, occupied });
    const linked = auth.linkState !== 'not_linked';
    const player = new Player({
      id: userId,
      name: auth.displayName,
      avatar: auth.avatarKey,
      deskId: auth.deskId ?? '',
      x: spawn.x,
      y: spawn.y,
      dir: spawn.dir,
      anim: Anim.Idle,
      status: Status.Available,
      statusText: '',
      zoneId: '',
    });
    const pet = new Pet({
      ownerId: userId,
      species: auth.petSpecies,
      name: auth.petName,
      x: spawn.x,
      y: spawn.y,
      dir: spawn.dir,
      anim: linked ? Anim.Idle : Anim.Sleep,
      linkState: linkStateToCode(auth.linkState),
    });
    const follower = new PetFollower(pet, this.world, { linked });
    follower.placeNear(spawn, spawn.dir, monotonicMs());
    const session: Session = {
      userId,
      sessionId: client.sessionId,
      client,
      auth,
      player,
      pet,
      follower,
      limits: createClientLimits(),
      baseStatus: Status.Available,
      customStatusText: auth.statusText,
      lastStepAt: Number.NEGATIVE_INFINITY,
      reconnection: null,
      ended: false,
    };

    const previous = this.byUser.get(userId);
    this.sessions.set(client.sessionId, session);
    this.byUser.set(userId, session);
    this.state.players.set(userId, player);
    this.state.pets.set(userId, pet);
    this.refreshZone(session);
    player.anim = this.restAnim(session);
    client.view = new StateView();
    client.view.add(pet);
    if (previous) this.endSession(previous, CloseCodes.SessionReplaced);

    logger.info({ userId, spawn: spawn.source, replaced: !!previous }, 'player joined');

    await Promise.all([
      this.scheduler
        .join(userId, { linkState: auth.linkState })
        .catch((err: unknown) => logger.error({ err, userId }, 'loading pet bubble candidates failed')),
      this.chat
        .unreadCounts(userId)
        .then((unread) => client.send(MSG.dmUnread, unread))
        .catch((err: unknown) => logger.error({ err, userId }, 'loading DM unread counts failed')),
    ]);
  }

  override async onDrop(client: OfficeClient, code?: number): Promise<void> {
    const s = this.sessions.get(client.sessionId);
    if (!s || s.ended || (code !== undefined && NO_RECONNECT_CODES.has(code))) return;
    try {
      const reconnection = this.allowReconnection(client, RECONNECT_SECONDS);
      s.reconnection = reconnection;
      await reconnection;
    } catch {
      // expired / rejected: Colyseus calls onLeave next
    } finally {
      s.reconnection = null;
    }
  }

  override onReconnect(client: OfficeClient): void {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    s.client = client;
    this.scheduler.noteActivity(s.userId);
  }

  override async onLeave(client: OfficeClient): Promise<void> {
    const s = this.sessions.get(client.sessionId);
    client.view?.dispose();
    if (!s) return;
    this.sessions.delete(client.sessionId);
    if (this.byUser.get(s.userId) !== s) return; // replaced by a newer connection
    this.byUser.delete(s.userId);
    this.scheduler.leave(s.userId);
    const p = s.player;
    this.state.players.delete(s.userId);
    this.state.pets.delete(s.userId);
    try {
      await savePresence(this.ctx.db, s.userId, { x: p.x, y: p.y, dir: p.dir, zoneId: p.zoneId || null }, this.ctx.clock.now());
    } catch (err) {
      this.ctx.logger.error({ err, userId: s.userId }, 'saving presence failed');
    }
    this.ctx.logger.info({ userId: s.userId }, 'player left');
  }

  /** Disconnects a session for good (no reconnection), e.g. replaced by a new tab or deactivated. */
  private endSession(s: Session, code: number): void {
    s.ended = true;
    const pending = s.reconnection;
    s.reconnection = null;
    // allowReconnection() returns a plain rejected promise for clients that never fully joined.
    if (pending && typeof pending.reject === 'function') pending.reject(new Error('session ended'));
    s.client.leave(code);
  }

  /** Kicks a user (deactivated, ...). */
  kickUser(userId: string, code: number): boolean {
    const s = this.byUser.get(userId);
    if (!s) return false;
    this.endSession(s, code);
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // loops

  private fastTick(): void {
    const nowMs = monotonicMs();
    for (const s of this.byUser.values()) {
      const p = s.player;
      if (p.anim === Anim.Walk && nowMs - s.lastStepAt >= WALK_SETTLE_MS) p.anim = this.restAnim(s);
      s.follower.update(nowMs, { x: p.x, y: p.y }, p.dir as Dir);
    }
    this.scheduler.expire();
  }

  private restAnim(s: Session): Anim {
    const desk = s.player.deskId ? this.world.deskById(s.player.deskId) : null;
    return desk && desk.seatX === s.player.x && desk.seatY === s.player.y ? Anim.Sit : Anim.Idle;
  }

  // ---------------------------------------------------------------------------------------------
  // messages

  private registerMessages(): void {
    this.on(MSG.step, C2S.step, (s, m) => this.handleStep(s, m.seq, m.dir as Dir));
    this.on(MSG.face, C2S.face, (s, m) => {
      if (!s.limits.face.take(monotonicMs())) return this.sendError(s, MSG.face, 'RATE_LIMITED');
      s.player.dir = m.dir;
    });
    this.on(MSG.presence, C2S.presence, (s, m) => {
      if (!s.limits.presence.take(monotonicMs())) return this.sendError(s, MSG.presence, 'RATE_LIMITED');
      this.scheduler.setPresence(s.userId, m.visible, m.uiBusy);
    });
    this.on(MSG.statusSet, C2S.statusSet, (s, m) => this.handleStatus(s, m.status as Status, m.text));
    this.on(MSG.chatSend, C2S.chatSend, (s, m) => this.handleChat(s, m.channel, m.text, m.clientMsgId));
    this.on(MSG.dmSend, C2S.dmSend, (s, m) => this.handleDm(s, m.toUserId, m.text, m.clientMsgId));
    this.on(MSG.dmRead, C2S.dmRead, (s, m) => this.handleDmRead(s, m.peerUserId, m.lastMessageId));
    this.on(MSG.wave, C2S.wave, (s) => this.handleWave(s));
    this.on(MSG.ping, C2S.ping, (s, m) => this.handlePing(s, m.toUserId));
    this.on(MSG.bubbleSeen, C2S.bubbleSeen, (s, m) => {
      if (!s.limits.bubbleSeen.take(monotonicMs())) return;
      this.scheduler.seen(s.userId, m.bubbleId);
    });
    this.onMessage('*', (client, type) => {
      (client as OfficeClient).send(MSG.error, { code: 'UNKNOWN_MESSAGE', type: String(type) } satisfies ErrorMsg);
    });
  }

  /** Validates with the shared zod schema; invalid payloads get an `error` reply (no kick). */
  private on<T>(type: string, schema: SafeParser<T>, handler: Handler<T>): void {
    this.onMessage(type, (client: OfficeClient, payload: unknown) => {
      const s = this.sessions.get(client.sessionId);
      if (!s || s.ended || this.byUser.get(s.userId) !== s) return;
      const parsed = schema.safeParse(payload ?? {});
      if (!parsed.success) return this.sendError(s, type, 'INVALID_PAYLOAD');
      try {
        const r = handler(s, parsed.data);
        if (r instanceof Promise) {
          r.catch((err: unknown) => {
            this.ctx.logger.error({ err, type, userId: s.userId }, 'message handler failed');
            this.sendError(s, type, 'INTERNAL');
          });
        }
      } catch (err) {
        this.ctx.logger.error({ err, type, userId: s.userId }, 'message handler failed');
        this.sendError(s, type, 'INTERNAL');
      }
    });
  }

  private sendError(s: Session, type: string, code: ErrorMsg['code']): void {
    s.client.send(MSG.error, { code, type } satisfies ErrorMsg);
  }

  private handleStep(s: Session, seq: number, dir: Dir): void {
    const p = s.player;
    const nowMs = monotonicMs();
    const correct = () => s.client.send(MSG.moveCorrect, { seq, x: p.x, y: p.y } satisfies MoveCorrectMsg);
    // Both buckets must have a token (no short-circuit refund needed: a rejected step costs one).
    const cadenceOk = s.limits.step.take(nowMs);
    const floodOk = s.limits.stepFlood.take(nowMs);
    if (!cadenceOk || !floodOk) return correct();
    p.dir = dir;
    const from = { x: p.x, y: p.y };
    const to = stepTarget(from, dir);
    if (!this.world.isWalkable(to.x, to.y)) return correct();
    p.x = to.x;
    p.y = to.y;
    p.anim = Anim.Walk;
    s.lastStepAt = nowMs;
    s.follower.ownerMoved(from, to, dir, nowMs);
    this.refreshZone(s);
    this.scheduler.noteActivity(s.userId);
  }

  /** Moves a player server-side (seat changes, admin tools, tests). Long jumps teleport the pet. */
  relocate(userId: string, x: number, y: number, dir?: Dir): boolean {
    const s = this.byUser.get(userId);
    if (!s || !this.world.isWalkable(x, y)) return false;
    const p = s.player;
    const from = { x: p.x, y: p.y };
    p.x = x;
    p.y = y;
    if (dir !== undefined) p.dir = dir;
    s.follower.ownerMoved(from, { x, y }, p.dir as Dir, monotonicMs());
    this.refreshZone(s);
    p.anim = this.restAnim(s);
    return true;
  }

  private handleStatus(s: Session, status: Status, text: string | undefined): void {
    if (!s.limits.status.take(monotonicMs())) return this.sendError(s, MSG.statusSet, 'RATE_LIMITED');
    s.baseStatus = status;
    if (text !== undefined) {
      const clean = normalizeLine(text);
      if (graphemeLength(clean) > LIMITS.statusTextMax) return this.sendError(s, MSG.statusSet, 'INVALID_PAYLOAD');
      s.customStatusText = clean;
      void this.ctx.db
        .update(profiles)
        .set({ statusText: clean || null })
        .where(eq(profiles.userId, s.userId))
        .catch((err: unknown) => this.ctx.logger.error({ err, userId: s.userId }, 'saving status text failed'));
    }
    this.applyStatus(s);
  }

  /** zoneId + automatic status: the meeting zone shows Meeting unless the user chose Focus. */
  private refreshZone(s: Session): void {
    const zone = this.world.zoneAt(s.player.x, s.player.y)?.zoneId ?? '';
    if (zone !== s.player.zoneId) s.player.zoneId = zone;
    this.applyStatus(s);
  }

  private applyStatus(s: Session): void {
    const p = s.player;
    const inMeeting = ISOLATED_ZONES.includes(p.zoneId);
    const status = inMeeting && s.baseStatus !== Status.Focus ? Status.Meeting : s.baseStatus;
    if (p.status !== status) p.status = status;
    const zone = p.zoneId as ZoneId;
    const auto = AUTO_TEXT_ZONES.includes(zone) ? ZONE_LABEL_KO[zone] : '';
    const text = s.customStatusText || auto;
    if (p.statusText !== text) p.statusText = text;
  }

  private proximityList(): ProximityPlayer[] {
    return [...this.byUser.values()].map((s) => ({
      id: s.userId,
      x: s.player.x,
      y: s.player.y,
      zoneId: s.player.zoneId || null,
    }));
  }

  private nearbyOf(s: Session): string[] {
    const me: ProximityPlayer = { id: s.userId, x: s.player.x, y: s.player.y, zoneId: s.player.zoneId || null };
    return nearbyRecipients(me, this.proximityList(), LIMITS.nearbyRadiusTiles, ISOLATED_ZONES);
  }

  private async handleChat(s: Session, channel: 'nearby' | 'room', raw: string, clientMsgId: string): Promise<void> {
    const ack = (msg: Omit<ChatAckMsg, 'clientMsgId'>) => s.client.send(MSG.chatAck, { clientMsgId, ...msg } satisfies ChatAckMsg);
    if (!s.limits.chat.take(monotonicMs())) return ack({ id: null, error: 'RATE_LIMITED' });
    const prepared = prepareChatText(raw, { multiline: false });
    if (!prepared.ok) return ack({ id: null, error: prepared.error });
    this.scheduler.noteActivity(s.userId);

    const zoneId = s.player.zoneId || null;
    const recipients = channel === 'nearby' ? [s.userId, ...this.nearbyOf(s)] : [];
    const stored = await this.chat.storeChannelMessage({
      kind: channel,
      senderId: s.userId,
      body: prepared.text,
      clientMsgId,
      zoneId: channel === 'nearby' ? zoneId : null,
      recipients,
    });
    if (!stored.duplicate) {
      const msg: ChatMsg = {
        id: stored.id,
        kind: channel,
        fromUserId: s.userId,
        fromName: s.player.name,
        text: prepared.text,
        createdAt: stored.createdAt.toISOString(),
        zoneId: channel === 'nearby' ? zoneId : null,
      };
      if (channel === 'room') this.broadcast(MSG.chatMsg, msg);
      else for (const id of recipients) this.byUser.get(id)?.client.send(MSG.chatMsg, msg);
    }
    ack({ id: stored.id });
  }

  private async handleDm(s: Session, toUserId: string, raw: string, clientMsgId: string): Promise<void> {
    const ack = (msg: Omit<ChatAckMsg, 'clientMsgId'>) => s.client.send(MSG.chatAck, { clientMsgId, ...msg } satisfies ChatAckMsg);
    if (!s.limits.dm.take(monotonicMs())) return ack({ id: null, error: 'RATE_LIMITED' });
    const prepared = prepareChatText(raw, { multiline: true });
    if (!prepared.ok) return ack({ id: null, error: prepared.error });
    if (toUserId === s.userId || !(await this.chat.findActiveUser(toUserId))) return ack({ id: null, error: 'NOT_FOUND' });
    this.scheduler.noteActivity(s.userId);

    const stored = await this.chat.storeDm({ senderId: s.userId, toUserId, body: prepared.text, clientMsgId });
    if (!stored.duplicate) {
      const msg: DmMsg = {
        id: stored.id,
        fromUserId: s.userId,
        fromName: s.player.name,
        toUserId,
        text: prepared.text,
        createdAt: stored.createdAt.toISOString(),
      };
      this.byUser.get(toUserId)?.client.send(MSG.dmMsg, msg);
      s.client.send(MSG.dmMsg, msg);
    }
    ack({ id: stored.id });
  }

  private async handleDmRead(s: Session, peerUserId: string, lastMessageId: string): Promise<void> {
    if (!s.limits.dmRead.take(monotonicMs())) return this.sendError(s, MSG.dmRead, 'RATE_LIMITED');
    const ok = await this.chat.markDmRead(s.userId, peerUserId, lastMessageId, this.ctx.clock.now());
    if (!ok) return this.sendError(s, MSG.dmRead, 'NOT_FOUND');
    s.client.send(MSG.dmUnread, await this.chat.unreadCounts(s.userId));
  }

  private handleWave(s: Session): void {
    if (!s.limits.wave.take(monotonicMs())) return this.sendError(s, MSG.wave, 'RATE_LIMITED');
    const msg: EmoteMsg = { fromUserId: s.userId, kind: 'wave' };
    for (const id of [s.userId, ...this.nearbyOf(s)]) this.byUser.get(id)?.client.send(MSG.emote, msg);
  }

  private handlePing(s: Session, toUserId: string): void {
    const nowMs = monotonicMs();
    const target = this.byUser.get(toUserId);
    if (!target || toUserId === s.userId) return this.sendError(s, MSG.ping, 'NOT_ONLINE');
    if (!s.limits.ping.take(nowMs) || !s.limits.pingTarget.take(toUserId, nowMs)) {
      return this.sendError(s, MSG.ping, 'RATE_LIMITED');
    }
    target.client.send(MSG.pinged, { fromUserId: s.userId, fromName: s.player.name } satisfies PingedMsg);
  }

  // ---------------------------------------------------------------------------------------------
  // DB events (LISTEN) and resync

  async handleTownEvent(event: TownEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'nudges_changed':
        case 'todos_changed':
          if (this.byUser.has(event.user_id)) await this.scheduler.reload(event.user_id);
          return;
        case 'link_state_changed':
          this.applyLinkState(event.user_id, event.state);
          if (event.state !== 'not_linked' && this.byUser.has(event.user_id)) await this.scheduler.reload(event.user_id);
          return;
        case 'profile_changed':
          await this.reloadProfile(event.user_id);
          return;
        case 'user_deactivated':
          if (this.kickUser(event.user_id, CloseCodes.Forbidden)) {
            this.ctx.logger.info({ userId: event.user_id }, 'deactivated user disconnected');
          }
          return;
        case 'desks_changed':
          await Promise.all([...this.byUser.keys()].map((id) => this.reloadProfile(id)));
          return;
        case 'work_log_changed': {
          if (event.visibility !== 'company' || !event.created) return;
          const s = this.byUser.get(event.user_id);
          const notice: NoticeMsg = { kind: 'work_log_published', text: WORK_LOG_PUBLISHED_TEXT, logId: event.log_id };
          s?.client.send(MSG.notice, notice);
          return;
        }
      }
    } catch (err) {
      this.ctx.logger.error({ err, type: event.type }, 'town event handling failed');
    }
  }

  private applyLinkState(userId: string, linkState: LinkState): void {
    const s = this.byUser.get(userId);
    if (!s) return;
    s.auth = { ...s.auth, linkState };
    s.pet.linkState = linkStateToCode(linkState);
    s.follower.setLinked(linkState !== 'not_linked');
    this.scheduler.setLinkState(userId, linkState);
  }

  /** Re-reads name/avatar/pet/desk/link state/prefs; deactivated users are disconnected. */
  async reloadProfile(userId: string): Promise<void> {
    const s = this.byUser.get(userId);
    if (!s) return;
    const snap = await loadUserSnapshot(this.ctx.db, userId);
    if (this.byUser.get(userId) !== s) return;
    if (!snap || snap.status !== 'active') {
      this.kickUser(userId, CloseCodes.Forbidden);
      return;
    }
    const { status: _status, ...auth } = snap;
    s.auth = auth;
    const p = s.player;
    if (p.name !== snap.displayName) p.name = snap.displayName;
    if (p.avatar !== snap.avatarKey) p.avatar = snap.avatarKey;
    if (p.deskId !== (snap.deskId ?? '')) p.deskId = snap.deskId ?? '';
    if (s.pet.species !== snap.petSpecies) s.pet.species = snap.petSpecies;
    if (s.pet.name !== snap.petName) s.pet.name = snap.petName;
    s.customStatusText = snap.statusText;
    this.applyStatus(s);
    if (s.pet.linkState !== linkStateToCode(snap.linkState)) this.applyLinkState(userId, snap.linkState);
    await this.scheduler.reload(userId);
  }

  /** Every 5 minutes (and after a LISTEN reconnect): candidates, link state, profile. */
  async resyncAll(): Promise<void> {
    for (const userId of [...this.byUser.keys()]) {
      try {
        await this.reloadProfile(userId);
      } catch (err) {
        this.ctx.logger.error({ err, userId }, 'resync failed');
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // introspection (tests, health)

  get connectedUserIds(): string[] {
    return [...this.byUser.keys()];
  }

  get nudgeScheduler(): NudgeScheduler {
    return this.scheduler;
  }

  /** Walkable tile next to a user, e.g. to place someone beside them. */
  tileNextTo(userId: string): Point | null {
    const s = this.byUser.get(userId);
    return s ? adjacentWalkable(this.world, s.player, s.player.dir as Dir) : null;
  }
}
