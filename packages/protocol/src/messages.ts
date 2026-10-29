import * as z from 'zod';
import { LIMITS } from '@enu/shared';

/** Client -> server message schemas (validated with zod on the server). */

const dir = z.number().int().min(0).max(3);

export const C2S = {
  step: z.object({ seq: z.number().int().min(0), dir }),
  face: z.object({ dir }),
  presence: z.object({ visible: z.boolean(), uiBusy: z.boolean() }),
  statusSet: z.object({ status: z.number().int().min(0).max(3), text: z.string().max(LIMITS.statusTextMax).optional() }),
  chatSend: z.object({
    channel: z.enum(['nearby', 'room']),
    text: z.string().min(1).max(LIMITS.chatMaxLen * 2),
    clientMsgId: z.string().min(8).max(64),
  }),
  dmSend: z.object({
    toUserId: z.string().min(1).max(64),
    text: z.string().min(1).max(LIMITS.chatMaxLen * 2),
    clientMsgId: z.string().min(8).max(64),
  }),
  dmRead: z.object({ peerUserId: z.string().min(1).max(64), lastMessageId: z.string().min(1).max(64) }),
  wave: z.object({}),
  ping: z.object({ toUserId: z.string().min(1).max(64) }),
  bubbleSeen: z.object({ bubbleId: z.string().min(1).max(64) }),
} as const;

/** Message type names on the wire. */
export const MSG = {
  step: 'step',
  face: 'face',
  presence: 'presence',
  statusSet: 'status:set',
  chatSend: 'chat:send',
  dmSend: 'dm:send',
  dmRead: 'dm:read',
  wave: 'social:wave',
  ping: 'social:ping',
  bubbleSeen: 'pet:bubble-seen',
  // server -> client
  moveCorrect: 'move:correct',
  chatMsg: 'chat:msg',
  chatAck: 'chat:ack',
  dmMsg: 'dm:msg',
  dmUnread: 'dm:unread',
  emote: 'emote',
  pinged: 'social:pinged',
  notice: 'notice',
  error: 'error',
} as const;

export type StepMsg = z.infer<typeof C2S.step>;
export type ChatSendMsg = z.infer<typeof C2S.chatSend>;
export type DmSendMsg = z.infer<typeof C2S.dmSend>;

/** Server -> client payloads. */
export interface MoveCorrectMsg {
  seq: number;
  x: number;
  y: number;
}

export interface ChatMsg {
  id: string;
  kind: 'nearby' | 'room';
  fromUserId: string;
  fromName: string;
  text: string;
  createdAt: string;
  zoneId: string | null;
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

export interface EmoteMsg {
  fromUserId: string;
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
