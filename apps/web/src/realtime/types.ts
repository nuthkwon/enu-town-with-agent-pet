import type {
  ChatAckMsg,
  ChatMsg,
  DmMsg,
  DmUnreadMsg,
  EmoteMsg,
  ErrorMsg,
  NoticeMsg,
  PingedMsg,
} from '@enu/protocol';

/**
 * Plain copy of a synced `Player`: a roster member (every active, onboarded employee), NOT a connected
 * player. All roster members are always in the state, so "a snapshot exists" means nothing; read
 * `shown` (avatar drawn), `online` (connected now) and `note` (hidden plate) instead.
 */
export interface PlayerSnap {
  id: string;
  name: string;
  avatar: string;
  deskId: string;
  x: number;
  y: number;
  dir: number;
  anim: number;
  /** Human-typed 상태 문구 ('' unless shown or the plate note is Away). */
  statusText: string;
  /** The avatar is drawn. */
  shown: boolean;
  /** Connected now ∧ 접속 표시 on ∧ shown ∧ office open. */
  online: boolean;
  /** ActivityCode (also the desk-plate label while hidden). */
  activity: number;
  /** SourceCode (None for a 부재 plate). */
  source: number;
  /** Epoch ms when the activity ends; 0 = none. */
  until: number;
  /** PlateNote of a hidden member. */
  note: number;
  /** Opaque group id ('' = none). */
  groupId: string;
  /** Changes on each Claude work-log write (the client sparkles on a change; the value counts nothing). */
  logPulse: number;
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
  /** The current privacy notice (or onboarding) is not accepted yet: the app navigates to /welcome. */
  | { kind: 'notice_required' }
  /** The server runs a different map version (4110): the page reloads. */
  | { kind: 'map_mismatch' }
  /** The server speaks a different protocol version (4111): the page reloads. */
  | { kind: 'protocol_mismatch' }
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
  /** Coarse change signal for React lists (add/remove/name/shown/online/activity…, not x/y). */
  roster: void;
  /** `OfficeState.officeOpen` changed (also fired once after joining). */
  office: boolean;
  'map:hash': string;
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
