import * as z from 'zod';
import { LIMITS, MANUAL_DURATIONS, MANUAL_STATUSES } from '@enu/shared';
import { PROTOCOL_VERSION } from './constants';

/**
 * Options every client sends with `joinOrCreate`. The room checks `protocol` in `onAuth`, before the
 * ticket, and refuses a missing or different value with CloseCodes.ProtocolMismatch.
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
    text: z.string().min(1).max(LIMITS.chatMaxLen * 2),
    clientMsgId: z.string().min(8).max(64),
  }),
  dmSend: z.object({
    toUserId: z.string().min(1).max(64),
    text: z.string().min(1).max(LIMITS.chatMaxLen * 2),
    clientMsgId: z.string().min(8).max(64),
  }),
  dmRead: z.object({ peerUserId: z.string().min(1).max(64), lastMessageId: z.string().min(1).max(64) }),
  wave: z.object({ toUserId: z.string().min(1).max(64) }),
  ping: z.object({ toUserId: z.string().min(1).max(64) }),
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
  bubbleSeen: 'pet:bubble-seen',
  // server -> client
  chatMsg: 'chat:msg',
  chatAck: 'chat:ack',
  dmMsg: 'dm:msg',
  dmUnread: 'dm:unread',
  emote: 'emote',
  pinged: 'social:pinged',
  notice: 'notice',
  error: 'error',
} as const;

export type StatusSetMsg = z.infer<typeof C2S.statusSet>;
export type ChatSendMsg = z.infer<typeof C2S.chatSend>;
export type DmSendMsg = z.infer<typeof C2S.dmSend>;
export type WaveMsg = z.infer<typeof C2S.wave>;

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

/** System notices are ENU Town UI text (never presented as the pet speaking). */
export interface NoticeMsg {
  kind: 'work_log_published' | 'link_state' | 'info';
  text: string;
  logId?: string;
}

/**
 * Payload of the server -> client `error` message (MSG.error). The connection stays open.
 * NOT_SHOWN: a wave to or from someone hidden, or while the office is closed. A ping answers only
 * NOT_ONLINE (for every failure) or RATE_LIMITED.
 */
export interface ErrorMsg {
  code:
    | 'INVALID_PAYLOAD'
    | 'RATE_LIMITED'
    | 'UNKNOWN_MESSAGE'
    | 'NOT_FOUND'
    | 'NOT_ONLINE'
    | 'NOT_SHOWN'
    | 'INTERNAL';
  /** The client message type that caused it. */
  type: string;
}
