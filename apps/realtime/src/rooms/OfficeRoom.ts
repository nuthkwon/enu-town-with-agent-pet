import {
  CloseCode,
  ErrorCode,
  Room,
  ServerError,
  type AuthContext,
  type Client,
  type Deferred,
} from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { loadHolidays, profiles } from '@enu/db';
import { DEFAULT_TIMING, manualStatusUntil, type PolicyTiming } from '@enu/domain';
import {
  C2S,
  CloseCodes,
  MSG,
  OfficeState,
  isCurrentProtocol,
  type ChatAckMsg,
  type ChatMsg,
  type DmMsg,
  type EmoteMsg,
  type ErrorMsg,
  type NoticeMsg,
  type PingedMsg,
  type StatusSetMsg,
} from '@enu/protocol';
import {
  LIMITS,
  OFFICE_ROOM_NAME,
  TOWN_TIMING,
  graphemeLength,
  localDateKey,
  normalizeLine,
  type LinkState,
  type TownEvent,
} from '@enu/shared';
import { eq } from 'drizzle-orm';
import { TicketError, isOriginAllowed, verifyTicket, type AuthData } from '../auth/verifyTicket';
import { ChatService, prepareChatText } from '../chat/ChatService';
import { monotonicMs } from '../clock';
import { getRealtimeContext, type RealtimeContext } from '../context';
import { Director, NO_SIGNALS, bubbleHooks, type ManualIn } from '../director/Director';
import { DbEvents } from '../infra/DbEvents';
import { loadRoster, loadRosterMember, loadSignals } from '../infra/roster';
import { BubblePresenter, createDbDeliveryStore } from '../pet/BubblePresenter';
import { CandidateLoader } from '../pet/CandidateLoader';
import { NudgeScheduler } from '../pet/NudgeScheduler';
import { loadOfficeMap } from '../world/loadMap';
import { createClientLimits, type ClientLimits } from './limits';

export interface OfficeUserData {
  userId: string;
}

/** What onAuth hands to onJoin: the verified person plus whether the client speaks PROTOCOL_VERSION. */
export interface OfficeAuth extends AuthData {
  protocolOk: boolean;
}

export type OfficeClient = Client<{ auth: OfficeAuth; userData: OfficeUserData }>;

/** Seconds a dropped connection keeps its seat (and stays live) for an automatic reconnect. */
export const RECONNECT_SECONDS = 20;
export const RESYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Close codes after which a seat is never held for reconnection. */
const NO_RECONNECT_CODES: ReadonlySet<number> = new Set<number>([
  ...Object.values(CloseCodes),
  CloseCode.WITH_ERROR,
  CloseCode.SERVER_SHUTDOWN,
]);

const WORK_LOG_PUBLISHED_TEXT = '새 업무 로그가 전사 공개되었어요';

/** A connection of one roster member. The avatar itself belongs to the director, not to the session. */
interface Session {
  userId: string;
  sessionId: string;
  client: OfficeClient;
  limits: ClientLimits;
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
 * The one office room (`office-606`): a live visualization of the teams at work. The server director
 * places every roster member from their own signals (nobody steers an avatar); the room adds
 * sessions, chat and DMs, waves and pings, and the owner-only pet bubbles.
 * Players and pets are keyed by user id: one actor per roster member, one live session per user.
 * Logs never carry per-user connection lines (join/leave/replace log only the session count).
 */
export class OfficeRoom extends Room<{ state: OfficeState; client: OfficeClient }> {
  override maxClients = 30;
  override autoDispose = false;
  /** Nothing is predicted client-side any more, so 10 patches per second are plenty. */
  override patchRate = 100;
  override maxMessagesPerSecond = 40;
  override state = new OfficeState();

  private ctx!: RealtimeContext;
  private director!: Director;
  private chat!: ChatService;
  private presenter!: BubblePresenter;
  private loader!: CandidateLoader;
  private scheduler!: NudgeScheduler;
  private events: DbEvents | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly byUser = new Map<string, Session>();
  /** Office date the loaded signals belong to (APP_TIMEZONE). */
  private signalsDay = '';
  private dayReload: Promise<void> | null = null;
  /** Per-key load sequence, so a slow, stale load never overwrites a newer one. */
  private readonly seqs = new Map<string, number>();

  /**
   * Runs on the HTTP matchmake request only (not on the WebSocket connect or on reconnect):
   * ticket required, Origin allow-list, then the DB re-check in verifyTicket. The `protocol` join
   * option is read here too, but a mismatch is refused at the start of onJoin: Colyseus turns an
   * onAuth error code into the HTTP status (4111 is not one), while an onJoin error reaches the client
   * with its code intact, before any state is sent.
   */
  static override async onAuth(token: string, options: unknown, context: AuthContext): Promise<OfficeAuth> {
    const ctx = getRealtimeContext();
    const protocolOk = isCurrentProtocol(options);
    if (!token) throw new ServerError(ErrorCode.AUTH_FAILED, 'missing_ticket');
    const origin = context.headers.get('origin');
    if (!isOriginAllowed(origin, ctx.env.ALLOWED_ORIGINS)) {
      ctx.logger.warn({ origin, ip: context.ip }, 'join rejected: origin not allowed');
      throw new ServerError(ErrorCode.AUTH_FAILED, 'origin_not_allowed');
    }
    try {
      const auth = await verifyTicket(token, {
        secret: ctx.env.REALTIME_TICKET_SECRET,
        allowedHd: ctx.env.ALLOWED_GOOGLE_HD,
        db: ctx.db,
      });
      return { ...auth, protocolOk };
    } catch (err) {
      if (err instanceof TicketError) {
        ctx.logger.info({ reason: err.reason }, 'join rejected');
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
      logger.warn(
        { mapHash: map.mapHash, metaHash: map.metaHash },
        'map file differs from its meta.json (run pnpm map:check)',
      );
    }
    this.state.mapId = map.mapId;
    this.state.mapHash = map.mapHash;
    if (env.TOWN_IGNORE_OFFICE_HOURS) {
      logger.warn('TOWN_IGNORE_OFFICE_HOURS is set: the town ignores office hours (development/e2e only)');
    }
    this.director = new Director({
      world: map.world,
      state: this.state,
      timeZone: env.APP_TIMEZONE,
      ignoreOfficeHours: env.TOWN_IGNORE_OFFICE_HOURS,
      warn: (msg, data) => logger.warn(data, msg),
    });

    const timing: PolicyTiming = {
      ...DEFAULT_TIMING,
      joinDelayMs: env.NUDGE_JOIN_DELAY_MS ?? DEFAULT_TIMING.joinDelayMs,
    };
    this.chat = new ChatService(db);
    this.loader = new CandidateLoader({
      db,
      clock,
      timing,
      minIntervalOverrideMin: env.NUDGE_MIN_INTERVAL_MIN,
      ignoreQuietHours: env.NUDGE_IGNORE_QUIET_HOURS,
    });
    this.presenter = new BubblePresenter({ store: createDbDeliveryStore(db), clock, logger });
    this.scheduler = new NudgeScheduler({
      loader: this.loader,
      presenter: this.presenter,
      clock,
      timing,
      logger,
      hooks: bubbleHooks(this.director),
    });

    // A room with nobody connected still shows everyone the DB says is there.
    this.director.setHolidays(await loadHolidays(db));
    const day = localDateKey(clock.now(), env.APP_TIMEZONE);
    await this.reloadRoster(); // creates every actor and loads their signals
    this.signalsDay = day;
    logger.info({ actors: this.director.size }, 'roster loaded');
    this.evaluate({ snap: true });
    logger.info({ actors: this.director.size, officeOpen: this.state.officeOpen }, 'actors placed');

    this.registerMessages();
    this.setTimestep(() => this.fastTick(), 50);
    this.clock.setInterval(() => this.evaluate(), TOWN_TIMING.directorTickMs);
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

  /**
   * Colyseus reports every error thrown from a room method here, attaching the client, the join options
   * and the auth data to the exception. A ServerError thrown on purpose (e.g. protocol_mismatch,
   * not_on_roster in onJoin) is an expected refusal, not a failure. Everything else is logged without the
   * exception object itself, so no person's data ends up in the logs.
   */
  override onUncaughtException(error: Error, methodName: string): void {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof ServerError) return;
    const inner = cause instanceof Error ? cause : error;
    this.ctx?.logger.error(
      { methodName, error: { name: inner.name, message: inner.message, stack: inner.stack } },
      'uncaught room exception',
    );
  }

  // ---------------------------------------------------------------------------------------------
  // lifecycle

  override async onJoin(client: OfficeClient): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new ServerError(ErrorCode.AUTH_FAILED, 'unauthenticated');
    // A client built for another protocol version (a cached old bundle) gets nothing: not even the state.
    if (!auth.protocolOk) throw new ServerError(CloseCodes.ProtocolMismatch, 'protocol_mismatch');
    const { clock, logger } = this.ctx;
    const userId = auth.userId;
    client.userData = { userId };

    // Actors come only from the roster; someone who finished onboarding seconds ago is picked up here.
    if (!this.director.has(userId)) {
      await this.reloadRoster();
      if (!this.director.has(userId)) throw new ServerError(CloseCodes.Forbidden, 'not_on_roster');
    }
    const pet = this.director.pet(userId);
    if (!pet) throw new ServerError(CloseCodes.Forbidden, 'not_on_roster');

    // Everything below up to the replacement is synchronous, so concurrent joins of one user
    // always end with exactly one live session.
    const session: Session = {
      userId,
      sessionId: client.sessionId,
      client,
      limits: createClientLimits(),
      reconnection: null,
      ended: false,
    };
    const previous = this.byUser.get(userId);
    this.sessions.set(client.sessionId, session);
    this.byUser.set(userId, session);
    client.view = new StateView();
    // The same Pet instance for the actor's whole life: bubble fields reach only this view.
    client.view.add(pet);
    if (previous) this.endSession(previous, CloseCodes.SessionReplaced);
    this.director.setSession(userId, 'open', clock.now());
    this.evaluate();

    logger.info({ sessions: this.byUser.size, replaced: !!previous }, 'player joined');

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
    if (this.byUser.get(s.userId) === s) {
      // Still live (seat held), but not connected: no online dot, pings fail.
      this.director.setSession(s.userId, 'held', this.ctx.clock.now());
      this.evaluate();
    }
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
    if (!s.ended && this.byUser.get(s.userId) === s) {
      this.director.setSession(s.userId, 'open', this.ctx.clock.now());
      this.evaluate();
    }
  }

  override async onLeave(client: OfficeClient): Promise<void> {
    const s = this.sessions.get(client.sessionId);
    client.view?.dispose();
    if (!s) return;
    this.sessions.delete(client.sessionId);
    if (this.byUser.get(s.userId) !== s) return; // replaced by a newer connection
    this.byUser.delete(s.userId);
    this.scheduler.leave(s.userId);
    // The 60 s live grace starts now; nothing about the visit is stored.
    this.director.setSession(s.userId, 'ended', this.ctx.clock.now());
    this.evaluate();
    this.ctx.logger.info({ sessions: this.byUser.size }, 'player left');
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

  /** Kicks a user (deactivated, left the roster, ...). */
  kickUser(userId: string, code: number): boolean {
    const s = this.byUser.get(userId);
    if (!s) return false;
    this.endSession(s, code);
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // loops

  /** Director pass (1 Hz, and right after status:set, sessions and DB events). */
  private evaluate(opts: { snap?: boolean } = {}): void {
    const now = this.ctx.clock.now();
    if (localDateKey(now, this.ctx.env.APP_TIMEZONE) !== this.signalsDay && !this.dayReload) {
      // A new office day: yesterday's report no longer applies. Old signals stay until the new ones arrive.
      this.dayReload = this.reloadAllSignals()
        .then(() => this.director.evaluate(this.ctx.clock.now(), monotonicMs()))
        .catch((err: unknown) => this.ctx.logger.error({ err }, 'reloading signals for the new day failed'))
        .finally(() => {
          this.dayReload = null;
        });
    }
    this.director.evaluate(now, monotonicMs(), opts);
  }

  private fastTick(): void {
    this.director.step(monotonicMs());
    this.scheduler.expire();
  }

  // ---------------------------------------------------------------------------------------------
  // messages

  private registerMessages(): void {
    this.on(MSG.presence, C2S.presence, (s, m) => {
      if (!s.limits.presence.take(monotonicMs())) return this.sendError(s, MSG.presence, 'RATE_LIMITED');
      this.scheduler.setPresence(s.userId, m.visible, m.uiBusy);
    });
    this.on(MSG.statusSet, C2S.statusSet, (s, m) => this.handleStatus(s, m));
    this.on(MSG.chatSend, C2S.chatSend, (s, m) => this.handleChat(s, m.text, m.clientMsgId));
    this.on(MSG.dmSend, C2S.dmSend, (s, m) => this.handleDm(s, m.toUserId, m.text, m.clientMsgId));
    this.on(MSG.dmRead, C2S.dmRead, (s, m) => this.handleDmRead(s, m.peerUserId, m.lastMessageId));
    this.on(MSG.wave, C2S.wave, (s, m) => this.handleWave(s, m.toUserId));
    this.on(MSG.ping, C2S.ping, (s, m) => this.handlePing(s, m.toUserId));
    this.on(MSG.bubbleSeen, C2S.bubbleSeen, (s, m) => {
      if (!s.limits.bubbleSeen.take(monotonicMs())) return;
      this.scheduler.seen(s.userId, m.bubbleId);
    });
    // Everything else, including the removed `step` / `face`: nobody steers an avatar.
    this.onMessage('*', (client, type) => {
      (client as OfficeClient).send(MSG.error, {
        code: 'UNKNOWN_MESSAGE',
        type: String(type),
      } satisfies ErrorMsg);
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

  private nameOf(userId: string): string {
    return this.director.player(userId)?.name ?? '';
  }

  /**
   * The owner's own status. Stored first (so it survives a restart), then applied in memory. Not
   * audited and no NOTIFY: this room is the only reader that needs it right away.
   */
  private async handleStatus(s: Session, m: StatusSetMsg): Promise<void> {
    if (!s.limits.status.take(monotonicMs())) return this.sendError(s, MSG.statusSet, 'RATE_LIMITED');
    let text: string | undefined;
    if (m.text !== undefined) {
      text = normalizeLine(m.text);
      if (graphemeLength(text) > LIMITS.statusTextMax) return this.sendError(s, MSG.statusSet, 'INVALID_PAYLOAD');
    }
    const manual: ManualIn | null =
      m.status === 'auto'
        ? null
        : {
            status: m.status,
            until: manualStatusUntil(this.ctx.clock.now(), this.ctx.env.APP_TIMEZONE, m.duration ?? '1h'),
          };
    try {
      await this.ctx.db
        .update(profiles)
        .set({
          manualStatus: manual?.status ?? null,
          manualStatusUntil: manual?.until ?? null,
          ...(text !== undefined ? { statusText: text || null } : {}),
        })
        .where(eq(profiles.userId, s.userId));
    } catch (err) {
      this.ctx.logger.error({ err, userId: s.userId }, 'saving status failed');
      return this.sendError(s, MSG.statusSet, 'INTERNAL');
    }
    // A profile reload that started before this write must not bring the old status back.
    this.nextSeq(`p:${s.userId}`);
    this.director.setManual(s.userId, manual);
    if (text !== undefined) this.director.setStatusText(s.userId, text);
    this.evaluate();
  }

  private async handleChat(s: Session, raw: string, clientMsgId: string): Promise<void> {
    const ack = (msg: Omit<ChatAckMsg, 'clientMsgId'>) =>
      s.client.send(MSG.chatAck, { clientMsgId, ...msg } satisfies ChatAckMsg);
    if (!s.limits.chat.take(monotonicMs())) return ack({ id: null, error: 'RATE_LIMITED' });
    const prepared = prepareChatText(raw, { multiline: false });
    if (!prepared.ok) return ack({ id: null, error: prepared.error });
    const stored = await this.chat.storeRoomMessage({ senderId: s.userId, body: prepared.text, clientMsgId });
    if (!stored.duplicate) {
      const msg: ChatMsg = {
        id: stored.id,
        kind: 'room',
        fromUserId: s.userId,
        fromName: this.nameOf(s.userId),
        text: prepared.text,
        createdAt: stored.createdAt.toISOString(),
      };
      this.broadcast(MSG.chatMsg, msg);
    }
    ack({ id: stored.id });
  }

  private async handleDm(s: Session, toUserId: string, raw: string, clientMsgId: string): Promise<void> {
    const ack = (msg: Omit<ChatAckMsg, 'clientMsgId'>) =>
      s.client.send(MSG.chatAck, { clientMsgId, ...msg } satisfies ChatAckMsg);
    if (!s.limits.dm.take(monotonicMs())) return ack({ id: null, error: 'RATE_LIMITED' });
    const prepared = prepareChatText(raw, { multiline: true });
    if (!prepared.ok) return ack({ id: null, error: prepared.error });
    if (toUserId === s.userId || !(await this.chat.findActiveUser(toUserId)))
      return ack({ id: null, error: 'NOT_FOUND' });

    const stored = await this.chat.storeDm({
      senderId: s.userId,
      toUserId,
      body: prepared.text,
      clientMsgId,
    });
    if (!stored.duplicate) {
      const msg: DmMsg = {
        id: stored.id,
        fromUserId: s.userId,
        fromName: this.nameOf(s.userId),
        toUserId,
        text: prepared.text,
        createdAt: stored.createdAt.toISOString(),
      };
      // Only the two participants ever learn about a DM (no relationship metadata for anyone else).
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

  /** A human-initiated wave, shown to everyone: both people must be shown and the office open. */
  private handleWave(s: Session, toUserId: string): void {
    const nowMs = monotonicMs();
    if (!s.limits.wave.take(nowMs) || !s.limits.waveTarget.take(toUserId, nowMs)) {
      return this.sendError(s, MSG.wave, 'RATE_LIMITED');
    }
    if (toUserId === s.userId) return this.sendError(s, MSG.wave, 'INVALID_PAYLOAD');
    const from = this.director.projected(s.userId);
    const to = this.director.projected(toUserId);
    if (!this.state.officeOpen || !from?.shown || !to?.shown) return this.sendError(s, MSG.wave, 'NOT_SHOWN');
    this.broadcast(MSG.emote, { fromUserId: s.userId, toUserId, kind: 'wave' } satisfies EmoteMsg);
  }

  /**
   * Reaches only someone `online` (connected now, 접속 표시 on, shown, office open). Every failure
   * answers the same NOT_ONLINE, so a crafted ping cannot tell hidden-but-connected from offline.
   */
  private handlePing(s: Session, toUserId: string): void {
    const target = toUserId === s.userId ? undefined : this.byUser.get(toUserId);
    if (!target || this.director.projected(toUserId)?.online !== true) {
      return this.sendError(s, MSG.ping, 'NOT_ONLINE');
    }
    const nowMs = monotonicMs();
    if (!s.limits.ping.take(nowMs) || !s.limits.pingTarget.take(toUserId, nowMs)) {
      return this.sendError(s, MSG.ping, 'RATE_LIMITED');
    }
    target.client.send(MSG.pinged, { fromUserId: s.userId, fromName: this.nameOf(s.userId) } satisfies PingedMsg);
  }

  // ---------------------------------------------------------------------------------------------
  // DB events (LISTEN), roster and signals

  async handleTownEvent(event: TownEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'nudges_changed':
        case 'todos_changed':
          if (this.byUser.has(event.user_id)) await this.scheduler.reload(event.user_id);
          return;
        case 'link_state_changed':
          this.applyLinkState(event.user_id, event.state);
          if (event.state !== 'not_linked' && this.byUser.has(event.user_id))
            await this.scheduler.reload(event.user_id);
          return;
        case 'profile_changed':
          await this.reloadMember(event.user_id);
          return;
        case 'activity_changed':
          await this.reloadSignals([event.user_id]);
          this.evaluate();
          return;
        case 'work_log_changed': {
          await this.reloadSignals([event.user_id]);
          this.evaluate();
          this.director.noteLogWrite(event.user_id, event.by);
          if (event.visibility !== 'company' || !event.created) return;
          const notice: NoticeMsg = {
            kind: 'work_log_published',
            text: WORK_LOG_PUBLISHED_TEXT,
            logId: event.log_id,
          };
          this.byUser.get(event.user_id)?.client.send(MSG.notice, notice);
          return;
        }
        case 'user_deactivated':
          this.removeFromTown(event.user_id);
          this.evaluate();
          return;
        case 'desks_changed':
          await this.reloadRoster();
          this.evaluate();
          return;
      }
    } catch (err) {
      this.ctx.logger.error({ err, type: event.type }, 'town event handling failed');
    }
  }

  private nextSeq(key: string): number {
    const n = (this.seqs.get(key) ?? 0) + 1;
    this.seqs.set(key, n);
    return n;
  }

  private isLatest(key: string, n: number): boolean {
    return this.seqs.get(key) === n;
  }

  /** Kicks a connected member and removes their actor (deactivated, or no longer on the roster). */
  private removeFromTown(userId: string): void {
    this.kickUser(userId, CloseCodes.Forbidden);
    this.director.removeActor(userId);
  }

  private applyLinkState(userId: string, linkState: LinkState): void {
    if (this.director.setLinkState(userId, linkState)) this.scheduler.setLinkState(userId, linkState);
  }

  /**
   * The whole roster: existing actors are updated in place, new members get an actor (and their
   * signals), and actors that left the roster are removed. A Player/Pet is never swapped.
   */
  private async reloadRoster(): Promise<void> {
    const started = new Map(this.director.ids().map((id) => [id, this.nextSeq(`p:${id}`)]));
    const snaps = await loadRoster(this.ctx.db);
    const onRoster = new Set(snaps.map((s) => s.userId));
    const created: string[] = [];
    for (const snap of snaps) {
      const seq = started.get(snap.userId);
      if (seq !== undefined && !this.isLatest(`p:${snap.userId}`, seq)) continue;
      const r = this.director.upsertActor(snap);
      if (r.created) created.push(snap.userId);
      if (r.linkChanged) this.scheduler.setLinkState(snap.userId, snap.linkState);
    }
    for (const id of this.director.ids()) if (!onRoster.has(id)) this.removeFromTown(id);
    if (created.length > 0) await this.reloadSignals(created);
  }

  /** One member's profile (name, avatar, desk, pet, manual status, 활동 공유, 접속 표시), applied in place. */
  private async reloadMember(userId: string): Promise<void> {
    const seq = this.nextSeq(`p:${userId}`);
    const snap = await loadRosterMember(this.ctx.db, userId);
    if (!this.isLatest(`p:${userId}`, seq)) return;
    if (!snap) {
      if (this.director.has(userId)) {
        this.removeFromTown(userId);
        this.evaluate();
      }
      return;
    }
    const r = this.director.upsertActor(snap);
    if (r.linkChanged) this.scheduler.setLinkState(userId, snap.linkState);
    if (r.created) await this.reloadSignals([userId]);
    this.evaluate();
    if (this.byUser.has(userId)) await this.scheduler.reload(userId);
  }

  /** Today's report and log flags for these members (an absent row clears what was loaded before). */
  private async reloadSignals(userIds: readonly string[]): Promise<void> {
    const seqs = userIds.map((id) => [id, this.nextSeq(`s:${id}`)] as const);
    const signals = await loadSignals(this.ctx.db, userIds, this.ctx.clock.now(), this.ctx.env.APP_TIMEZONE);
    for (const [id, seq] of seqs) {
      if (this.isLatest(`s:${id}`, seq)) this.director.setSignals(id, signals.get(id) ?? NO_SIGNALS);
    }
  }

  private async reloadAllSignals(): Promise<void> {
    const day = localDateKey(this.ctx.clock.now(), this.ctx.env.APP_TIMEZONE);
    await this.reloadSignals(this.director.ids());
    this.signalsDay = day;
  }

  /** Every 5 minutes and after a LISTEN reconnect: holidays, roster, signals, bubble candidates. */
  async resyncAll(): Promise<void> {
    const { db, logger } = this.ctx;
    try {
      this.director.setHolidays(await loadHolidays(db));
      await this.reloadRoster();
      await this.reloadAllSignals();
    } catch (err) {
      logger.error({ err }, 'resync failed');
    }
    this.evaluate({ snap: true });
    for (const userId of [...this.byUser.keys()]) {
      try {
        await this.scheduler.reload(userId);
      } catch (err) {
        logger.error({ err, userId }, 'resync of pet bubble candidates failed');
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

  get townDirector(): Director {
    return this.director;
  }

  /** Runs one director pass now (tests use it after moving the fake clock). */
  evaluateNow(): void {
    this.evaluate();
  }
}
