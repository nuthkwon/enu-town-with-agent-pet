import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Synced room state. Players and pets are keyed by user id: every roster member has one of each,
 * whether or not anyone is connected. Activity fields come from the colleague projection
 * (`projectForColleagues`) and positions from the server director, so every client, the owner
 * included, decodes the same values.
 * Pet bubble fields are `.view()`-tagged: only the owner's StateView contains their own pet,
 * so nobody else ever receives the Claude-authored text. The shared `indicator` is never set by a bubble.
 */

/** A roster member (NOT a connected player): placed by the server director; nobody steers it. */
export const Player = schema(
  {
    id: t.string(),
    name: t.string(),
    avatar: t.string(),
    deskId: t.string().default(''),
    x: t.uint16().default(0),
    y: t.uint16().default(0),
    dir: t.uint8().default(0),
    anim: t.uint8().default(0),
    /** Human-typed 상태 문구; '' unless the member is shown or their plate note is Away. */
    statusText: t.string().default(''),
    /** The avatar is drawn. */
    shown: t.boolean().default(false),
    /** Connected now (no grace) ∧ 접속 표시 on ∧ shown ∧ office open. */
    online: t.boolean().default(false),
    /** ActivityCode (also the plate label while hidden). */
    activity: t.uint8().default(0),
    /** SourceCode (None for a 부재 plate). */
    source: t.uint8().default(0),
    /** Epoch ms when the activity ends, 0 = none (always 0 for a 부재 plate). */
    until: t.float64().default(0),
    /** PlateNote of a hidden member. */
    note: t.uint8().default(0),
    /** Opaque 'g…' group id, '' = none; the family is a meeting when activity is Meeting, otherwise work. */
    groupId: t.string().default(''),
    /**
     * Changes (by a random 1..255, mod 256) on each Claude work-log write while shown during office hours: the
     * client sparkles on a change; the value itself counts nothing. 0 while the office is closed.
     */
    logPulse: t.uint8().default(0),
  },
  'Player',
);
export type Player = SchemaType<typeof Player>;

export const Pet = schema(
  {
    ownerId: t.string(),
    species: t.string(),
    name: t.string(),
    x: t.uint16().default(0),
    y: t.uint16().default(0),
    dir: t.uint8().default(0),
    anim: t.uint8().default(0),
    linkState: t.uint8().default(1),
    /**
     * Shared with everyone, so the server keeps it at None: bubbles start only while the owner's tab is visible,
     * and a shared `…` would reveal when the owner looks at the town. Kept so the protocol does not change.
     */
    indicator: t.uint8().default(0),
    bubbleId: t.string().default('').view(),
    bubbleKind: t.uint8().default(0).view(),
    bubbleText: t.string().default('').view(),
    /** Epoch ms of the related to-do due time (drawn as a chip OUTSIDE the bubble), 0 = none. */
    bubbleDueAt: t.float64().default(0).view(),
    bubbleUntil: t.float64().default(0).view(),
  },
  'Pet',
);
export type Pet = SchemaType<typeof Pet>;

export const OfficeState = schema(
  {
    players: t.map(Player),
    pets: t.map(Pet),
    mapId: t.string(),
    mapHash: t.string(),
    /** Business day 08:30–19:30 (APP_TIMEZONE). While false every Player is neutral and pets sleep. */
    officeOpen: t.boolean().default(false),
  },
  'OfficeState',
);
export type OfficeState = SchemaType<typeof OfficeState>;
