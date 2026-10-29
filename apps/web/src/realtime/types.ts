import type {
  ChatAckMsg,
  ChatMsg,
  DmMsg,
  DmUnreadMsg,
  EmoteMsg,
  ErrorMsg,
  MoveCorrectMsg,
  NoticeMsg,
  PingedMsg,
} from '@enu/protocol';

/** Plain copies of the synced schema instances (safe to keep in React state). */
export interface PlayerSnap {
  id: string;
  name: string;
  avatar: string;
  deskId: string;
  x: number;
  y: number;
  dir: number;
  anim: number;
  status: number;
  statusText: string;
  zoneId: string;
}

export interface PetSnap {
  ownerId: string;
  species: string;
  name: string;
  x: number;
  y: number;
  dir: number;
  anim: number;
  linkState: number;
  indicator: number;
  /** Owner-only fields (StateView): everyone else always sees ''/0 here. */
  bubbleId: string;
  bubbleKind: number;
  bubbleText: string;
  bubbleDueAt: number;
  bubbleUntil: number;
}

export type ConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting'; attempt: number }
  | { kind: 'connected' }
  /** The SDK is re-establishing the same seat after a network drop. */
  | { kind: 'reconnecting' }
  /** Waiting before joining again with a fresh ticket. */
  | { kind: 'retrying'; attempt: number; retryAt: number }
  /** Another tab/device took over this user's session (4101). */
  | { kind: 'replaced' }
  /** Not allowed in (4103 / ticket 401/403): the app navigates to sign-in. */
  | { kind: 'forbidden' }
  /** The server runs a different map version (4110): the page reloads. */
  | { kind: 'map_mismatch' }
  /** Gave up after repeated failures; the UI offers a manual retry. */
  | { kind: 'failed' }
  | { kind: 'stopped' };

export type ConnectionKind = ConnectionStatus['kind'];

export interface PresenceState {
  visible: boolean;
  uiBusy: boolean;
}

export interface SessionEvents {
  status: ConnectionStatus;
  /** A new room was joined: views must drop everything they had and rebuild from the snapshot. */
  reset: void;
  'player:add': PlayerSnap;
  'player:change': { player: PlayerSnap; prev: PlayerSnap };
  'player:remove': PlayerSnap;
  'pet:add': PetSnap;
  'pet:change': { pet: PetSnap; prev: PetSnap };
  'pet:remove': PetSnap;
  /** Coarse change signal for React lists (add/remove/name/status/zone, not x/y). */
  roster: void;
  'map:hash': string;
  'move:correct': MoveCorrectMsg;
  'chat:msg': ChatMsg;
  'chat:ack': ChatAckMsg;
  'dm:msg': DmMsg;
  'dm:unread': DmUnreadMsg;
  emote: EmoteMsg;
  pinged: PingedMsg;
  notice: NoticeMsg;
  /** Server rejected a message (rate limit, invalid payload, …); the connection stays open. */
  'server:error': ErrorMsg;
}
