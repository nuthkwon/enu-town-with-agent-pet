/** Small integer codes used in the synced state (as const objects, no TS enums). */

/** Order matches the sprite sheet rows (down, left, right, up). */
export const Dir = { Down: 0, Left: 1, Right: 2, Up: 3 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

export const DIR_DELTA: Record<Dir, { dx: number; dy: number }> = {
  [Dir.Down]: { dx: 0, dy: 1 },
  [Dir.Left]: { dx: -1, dy: 0 },
  [Dir.Right]: { dx: 1, dy: 0 },
  [Dir.Up]: { dx: 0, dy: -1 },
};

export function facingToDir(f: 'up' | 'down' | 'left' | 'right'): Dir {
  return f === 'up' ? Dir.Up : f === 'down' ? Dir.Down : f === 'left' ? Dir.Left : Dir.Right;
}

export const Anim = { Idle: 0, Walk: 1, Sit: 2, Sleep: 3 } as const;
export type Anim = (typeof Anim)[keyof typeof Anim];

/**
 * What a roster member is doing (`Player.activity`; also the desk-plate label while hidden).
 * The server director maps domain names to these codes; Korean labels live in the web app (ko.townUi.activity).
 */
export const ActivityCode = {
  None: 0,
  Available: 1,
  Focus: 2,
  Meeting: 3,
  Break: 4,
  Work: 5,
  Docs: 6,
  Review: 7,
  Collab: 8,
  Today: 9,
} as const;
export type ActivityCode = (typeof ActivityCode)[keyof typeof ActivityCode];

/** Where the shown activity comes from (`Player.source`); always None for a 부재 plate. */
export const SourceCode = { None: 0, Manual: 1, Calendar: 2, Claude: 3, WorkLog: 4, Town: 5 } as const;
export type SourceCode = (typeof SourceCode)[keyof typeof SourceCode];

/** Desk-plate note of a hidden roster member (`Player.note`). */
export const PlateNote = { None: 0, Away: 1, Absent: 2 } as const;
export type PlateNote = (typeof PlateNote)[keyof typeof PlateNote];

export const PetLink = { Linked: 0, NotLinked: 1, Stale: 2 } as const;
export type PetLink = (typeof PetLink)[keyof typeof PetLink];

export function linkStateToCode(s: 'linked' | 'not_linked' | 'stale'): PetLink {
  return s === 'linked' ? PetLink.Linked : s === 'stale' ? PetLink.Stale : PetLink.NotLinked;
}

/** What other people see while a pet shows its owner a private bubble. */
export const Indicator = { None: 0, Dots: 1 } as const;
export type Indicator = (typeof Indicator)[keyof typeof Indicator];

export const BubbleKind = { Nudge: 0, TodoDue: 1 } as const;
export type BubbleKind = (typeof BubbleKind)[keyof typeof BubbleKind];

/**
 * Custom close codes (>= 4100 so they never collide with Colyseus' reserved 4000-4010).
 * The room never offers reconnection for these.
 */
export const CloseCodes = {
  SessionReplaced: 4101,
  Forbidden: 4103,
  MapMismatch: 4110,
  /** The join options carry no or a different `protocol` (a cached old client); refused in onAuth. */
  ProtocolMismatch: 4111,
  RateLimited: 4129,
} as const;

/** Bumped on every incompatible change of the state schema or messages; sent as the `protocol` join option. */
export const PROTOCOL_VERSION = 4;

/** Walk cadence per tile (server walker, client interpolation and pet cadence). */
export const STEP_MS = 160;
