import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Synced room state. Players and pets are keyed by user id (one session per user).
 * Pet bubble fields are `.view()`-tagged: only the owner's StateView contains their own pet,
 * so nobody else ever receives the Claude-authored text (they only see `indicator`).
 */
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
    status: t.uint8().default(0),
    statusText: t.string().default(''),
    zoneId: t.string().default(''),
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
  },
  'OfficeState',
);
export type OfficeState = SchemaType<typeof OfficeState>;
