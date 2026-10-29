/**
 * Browser-side copy of the sprite sheet contract.
 *
 * SOURCE OF TRUTH: `packages/sprites/src/spec.ts` (`@enu/sprites`). That package's index also
 * pulls in pngjs/zlib for PNG encoding, so the client cannot import it; keep these values in sync
 * with the generator (the unit test in `logic/direction.test.ts` pins the frame maths).
 */

export interface AnimDef {
  readonly start: number;
  readonly frames: number;
  readonly frameRate: number;
  readonly repeat: number;
}

/* Avatars: 32x32 frames, 10 columns (0-3 idle, 4-9 hop-walk) x 4 rows (down, left, right, up). */
export const AVATAR_FRAME = 32;
export const AVATAR_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type AvatarDirection = (typeof AVATAR_DIRECTIONS)[number];
export const AVATAR_ANIMS = {
  idle: { start: 0, frames: 4, frameRate: 6, repeat: -1 },
  walk: { start: 4, frames: 6, frameRate: 12, repeat: -1 },
} as const satisfies Record<string, AnimDef>;
export type AvatarAnim = keyof typeof AVATAR_ANIMS;
export const AVATAR_COLUMNS = 10;
export const AVATAR_FEET_Y = 31;
export const AVATAR_ORIGIN = { x: 0.5, y: AVATAR_FEET_Y / AVATAR_FRAME } as const;
/** Gap (px) between feet and ground per walk frame (airborne frames lift 4px). */
export const AVATAR_WALK_LIFT = [0, 0, 4, 0, 0, 4] as const;
export const AVATAR_MAX_HOP = 4;

/* Pets: 24x24 frames, 12 columns (0-3 idle hover, 4-9 hop, 10-11 sleep) x 2 rows (left, right). */
export const PET_FRAME = 24;
export const PET_DIRECTIONS = ['left', 'right'] as const;
export type PetDirection = (typeof PET_DIRECTIONS)[number];
export const PET_ANIMS = {
  idle: { start: 0, frames: 4, frameRate: 6, repeat: -1 },
  hop: { start: 4, frames: 6, frameRate: 12, repeat: -1 },
  sleep: { start: 10, frames: 2, frameRate: 2, repeat: -1 },
} as const satisfies Record<string, AnimDef>;
export type PetAnim = keyof typeof PET_ANIMS;
export const PET_COLUMNS = 12;
export const PET_GROUND_Y = 23;
export const PET_ORIGIN = { x: 0.5, y: PET_GROUND_Y / PET_FRAME } as const;

/* Companions: companions/<species>.png, one row of 22 frames of 24x24 facing left (the pet room header). */
export const COMPANION_FRAME = 24;
export const COMPANION_EXPRESSIONS = {
  idle: { start: 0, frames: 4, frameRate: 6, repeat: -1 },
  blink: { start: 4, frames: 2, frameRate: 8, repeat: 0 },
  listen: { start: 6, frames: 2, frameRate: 3, repeat: -1 },
  think: { start: 8, frames: 4, frameRate: 4, repeat: -1 },
  talk: { start: 12, frames: 4, frameRate: 8, repeat: -1 },
  happy: { start: 16, frames: 4, frameRate: 10, repeat: -1 },
  sleep: { start: 20, frames: 2, frameRate: 2, repeat: -1 },
} as const satisfies Record<string, AnimDef>;
export type CompanionExpression = keyof typeof COMPANION_EXPRESSIONS;
export const COMPANION_COLUMNS = 22;

/* Effects: effects.png, 16x16 frames, 8 columns x 3 rows (row 3: activity icons, fixed indices 16-23). */
export const EFFECT_FRAME = 16;
export const EFFECT_COLUMNS = 8;
export const EFFECT_ROWS = 3;
export const EFFECT_FRAMES = {
  sparkle0: 0,
  sparkle1: 1,
  sparkle2: 2,
  sparkle3: 3,
  star: 4,
  heart: 5,
  shadow: 6,
  shadowSmall: 7,
  zzz: 8,
  clock: 9,
  dots: 10,
  alarm: 11,
  exclaim: 12,
  check: 13,
  note: 14,
  question: 15,
  /** Meeting (회의 중). */
  headset: 16,
  /** Focus (집중 모드). */
  focus: 17,
  /** Break (휴식). */
  cup: 18,
  /** Personal work (개인 업무). */
  laptop: 19,
  /** Review (검토 중). */
  magnifier: 20,
  /** Collaboration (협업 중). */
  link: 21,
  /** Today's work log (오늘 업무 기록). */
  clipboard: 22,
  /** DM / work request paper plane (participants only). */
  plane: 23,
} as const;
export type EffectName = keyof typeof EFFECT_FRAMES;

export const SPRITE_PATHS = {
  manifest: '/assets/sprites/manifest.json',
  effects: '/assets/sprites/effects.png',
  pet: (species: string): string => `/assets/sprites/pets/${encodeURIComponent(species)}.png`,
  companion: (species: string): string => `/assets/sprites/companions/${encodeURIComponent(species)}.png`,
  /** Tinted town (`pt-…`) and companion (`pc-…`) sheets, generated on demand (cached immutable). */
  petApi: (key: string): string => `/api/sprites/pet/${encodeURIComponent(key)}`,
  avatarStatic: (key: string): string => `/assets/sprites/avatars/${encodeURIComponent(key)}.png`,
  /** Generated on demand for any valid preset key (cached immutable by the web server). */
  avatarApi: (key: string): string => `/api/sprites/avatar/${encodeURIComponent(key)}`,
} as const;

export const MAP_PATHS = {
  tmj: '/assets/maps/office-606/office-606.tmj',
  tileset: '/assets/maps/office-606/office-tiles.png',
} as const;

/** Frame numbers (inclusive) of an avatar animation for one direction. */
export function avatarAnimFrames(dir: AvatarDirection, anim: AvatarAnim): { start: number; end: number } {
  const row = AVATAR_DIRECTIONS.indexOf(dir);
  const a = AVATAR_ANIMS[anim];
  const start = row * AVATAR_COLUMNS + a.start;
  return { start, end: start + a.frames - 1 };
}

/** Frame numbers (inclusive) of a pet animation for one direction. */
export function petAnimFrames(dir: PetDirection, anim: PetAnim): { start: number; end: number } {
  const row = PET_DIRECTIONS.indexOf(dir);
  const a = PET_ANIMS[anim];
  const start = row * PET_COLUMNS + a.start;
  return { start, end: start + a.frames - 1 };
}
