import * as z from 'zod';
import {
  LIMITS,
  MANUAL_DURATIONS,
  MANUAL_STATUSES,
  SPELLS,
  type Spell,
  type SpellOutcome,
} from '@enu/shared';
import { PROTOCOL_VERSION } from './constants';

/**
 * Options every client sends with `join`. The room reads `protocol` in `onAuth` and refuses a missing or
 * different value at the start of `onJoin`, before any state is sent, with CloseCodes.ProtocolMismatch
 * (Colyseus turns an onAuth error code into an HTTP status, so 4111 would not reach the client from there).
 */
export interface JoinOptions {
  /** sha256 of the .tmj the client renders (compared with state.mapHash on the client). */
  mapHash?: string;
  protocol: typeof PROTOCOL_VERSION;
}

const joinProtocol = z.object({ protocol: z.literal(PROTOCOL_VERSION) });

/** True when the join options were sent by a client speaking this protocol version. */
export function isCurrentProtocol(options: unknown): boolean {
  return joinProtocol.safeParse(options).success;
}

/** `status:set` choices: `auto` clears the manual status (상태 문구 stays). */
export const STATUS_SET_CHOICES = ['auto', ...MANUAL_STATUSES] as const;

/** Client -> server message schemas (validated with zod on the server). Avatars are never steered. */
export const C2S = {
  presence: z.object({ visible: z.boolean(), uiBusy: z.boolean() }),
  statusSet: z.object({
    status: z.enum(STATUS_SET_CHOICES),
    /** Default 1h; ignored for `auto`. */
    duration: z.enum(MANUAL_DURATIONS).optional(),
    /** 상태 문구; written for any status when sent. */
    text: z.string().max(LIMITS.statusTextMax).optional(),
  }),
  chatSend: z.object({
    text: z
      .string()
      .min(1)
      .max(LIMITS.chatMaxLen * 2),
    clientMsgId: z.string().min(8).max(64),
  }),
  dmSend: z.object({
    toUserId: z.string().min(1).max(64),
    text: z
      .string()
      .min(1)
      .max(LIMITS.chatMaxLen * 2),
    clientMsgId: z.string().min(8).max(64),
  }),
  dmRead: z.object({ peerUserId: z.string().min(1).max(64), lastMessageId: z.string().min(1).max(64) }),
  wave: z.object({ toUserId: z.string().min(1).max(64) }),
  ping: z.object({ toUserId: z.string().min(1).max(64) }),
  /** A spell at a colleague (ADR 0008): public like the wave. */
  cast: z.object({ toUserId: z.string().min(1).max(64), spell: z.enum(SPELLS) }),
  bubbleSeen: z.object({ bubbleId: z.string().min(1).max(64) }),
} as const;

/** Message type names on the wire. */
export const MSG = {
  presence: 'presence',
  statusSet: 'status:set',
  chatSend: 'chat:send',
  dmSend: 'dm:send',
  dmRead: 'dm:read',
  wave: 'social:wave',
  ping: 'social:ping',
  cast: 'social:cast',
  bubbleSeen: 'pet:bubble-seen',
  // server -> client
  chatMsg: 'chat:msg',
  chatAck: 'chat:ack',
  dmMsg: 'dm:msg',
  dmUnread: 'dm:unread',
  emote: 'emote',
  pinged: 'social:pinged',
  notice: 'notice',
  petChanged: 'pet:changed',
  spell: 'spell',
  overviewChanged: 'overview:changed',
  error: 'error',
} as const;

export type StatusSetMsg = z.infer<typeof C2S.statusSet>;
export type ChatSendMsg = z.infer<typeof C2S.chatSend>;
export type DmSendMsg = z.infer<typeof C2S.dmSend>;
export type WaveMsg = z.infer<typeof C2S.wave>;
export type CastMsg = z.infer<typeof C2S.cast>;

/** Server -> client payloads. */
export interface ChatMsg {
  id: string;
  kind: 'room';
  fromUserId: string;
  fromName: string;
  text: string;
  createdAt: string;
}

export interface ChatAckMsg {
  clientMsgId: string;
  id: string | null;
  error?: 'EMPTY' | 'TOO_LONG' | 'RATE_LIMITED' | 'NOT_FOUND';
}

export interface DmMsg {
  id: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  text: string;
  createdAt: string;
}

export interface DmUnreadMsg {
  total: number;
  byPeer: Record<string, number>;
}

/** A human-initiated wave, broadcast to every client. */
export interface EmoteMsg {
  fromUserId: string;
  toUserId: string;
  kind: 'wave';
}

export interface PingedMsg {
  fromUserId: string;
  fromName: string;
}

/**
 * A spell, broadcast to every client (ADR 0008): who cast what at whom and what became of it. Nothing about it is
 * stored or counted; `combo` and `raid` are moments only.
 */
export interface SpellMsg {
  fromUserId: string;
  toUserId: string;
  spell: Spell;
  outcome: SpellOutcome;
}

/** System notices are ENU Den UI text (never presented as the pet speaking). */
export interface NoticeMsg {
  kind: 'work_log_published' | 'link_state' | 'info';
  text: string;
  logId?: string;
}

/**
 * Owner only (MSG.petChanged): one of my pet rooms changed (`petId`), or my pets themselves (`null`). It carries
 * ids only; the client refetches over REST. Colleagues never receive it.
 */
export interface PetChangedMsg {
  petId: string | null;
}

/**
 * To everyone, in office hours only (MSG.overviewChanged): the work overview changed (ADR 0007); clients fetch it
 * again over REST. Empty: it never says whose log changed. A change the feed shows without a time is announced only
 * with the next periodic batch, so the push never dates it.
 */
export type OverviewChangedMsg = Record<string, never>;

/**
 * Payload of the server -> client `error` message (MSG.error). The connection stays open.
 * NOT_SHOWN: a wave or spell to or from someone hidden, or while the office is closed. A ping answers only
 * NOT_ONLINE (for every failure) or RATE_LIMITED. NOT_ACCEPTED: the target turned spells off (마법 받지 않기).
 */
export interface ErrorMsg {
  code:
    | 'INVALID_PAYLOAD'
    | 'RATE_LIMITED'
    | 'UNKNOWN_MESSAGE'
    | 'NOT_FOUND'
    | 'NOT_ONLINE'
    | 'NOT_SHOWN'
    | 'NOT_ACCEPTED'
    | 'INTERNAL';
  /** The client message type that caused it. */
  type: string;
}
