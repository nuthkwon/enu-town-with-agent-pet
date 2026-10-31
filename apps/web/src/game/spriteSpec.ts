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

/*
 * Avatars: 32x32 frames, 14 columns (0-3 idle, 4-9 hop-walk, 10-13 cast: raise the wand, star flash, hold, lower)
 * x 4 rows (down, left, right, up). Everyone is a wizard (ADR 0008); row 0 of every frame stays empty.
 */
export const AVATAR_FRAME = 32;
export const AVATAR_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type AvatarDirection = (typeof AVATAR_DIRECTIONS)[number];
export const AVATAR_ANIMS = {
  idle: { start: 0, frames: 4, frameRate: 6, repeat: -1 },
  walk: { start: 4, frames: 6, frameRate: 12, repeat: -1 },
  cast: { start: 10, frames: 4, frameRate: 10, repeat: 0 },
} as const satisfies Record<string, AnimDef>;
export type AvatarAnim = keyof typeof AVATAR_ANIMS;
export const AVATAR_COLUMNS = 14;
export const AVATAR_FEET_Y = 31;
export const AVATAR_ORIGIN = { x: 0.5, y: AVATAR_FEET_Y / AVATAR_FRAME } as const;
/** Gap (px) between feet and ground per walk frame (airborne frames lift 4px). */
export const AVATAR_WALK_LIFT = [0, 0, 4, 0, 0, 4] as const;
export const AVATAR_MAX_HOP = 4;
/** The cast frame (0-based) with the white star flash at the wand tip. */
export const AVATAR_CAST_FLASH_FRAME = 1;
/**
 * The wand tip in the cast's flash frame: the tip pixel's centre relative to the sprite origin (between the feet),
 * per direction, in px. Place a charge effect here.
 */
export const AVATAR_WAND_TIP = {
  down: { x: -10.5, y: -16.5 },
  left: { x: -9.5, y: -9.5 },
  right: { x: 9.5, y: -9.5 },
  up: { x: 10.5, y: -16.5 },
} as const satisfies Record<AvatarDirection, { readonly x: number; readonly y: number }>;

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

/* Companions: companions/<species>.png, one row of 26 frames of 24x24 facing left (the pet room header). */
export const COMPANION_FRAME = 24;
export const COMPANION_EXPRESSIONS = {
  idle: { start: 0, frames: 4, frameRate: 6, repeat: -1 },
  blink: { start: 4, frames: 2, frameRate: 8, repeat: 0 },
  listen: { start: 6, frames: 2, frameRate: 3, repeat: -1 },
  think: { start: 8, frames: 4, frameRate: 4, repeat: -1 },
  talk: { start: 12, frames: 4, frameRate: 8, repeat: -1 },
  happy: { start: 16, frames: 4, frameRate: 10, repeat: -1 },
  sleep: { start: 20, frames: 2, frameRate: 2, repeat: -1 },
  eat: { start: 22, frames: 2, frameRate: 5, repeat: -1 },
  cast: { start: 24, frames: 2, frameRate: 6, repeat: -1 },
} as const satisfies Record<string, AnimDef>;
export type CompanionExpression = keyof typeof COMPANION_EXPRESSIONS;
export const COMPANION_COLUMNS = 26;

/*
 * Effects: effects.png, 16x16 frames, 8 columns x 4 rows (row 3: activity icons, fixed indices 16-23; row 4: the
 * wizard office's spell, shield and quest-scroll icons, 24-31).
 */
export const EFFECT_FRAME = 16;
export const EFFECT_COLUMNS = 8;
export const EFFECT_ROWS = 4;
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
  /** 응원 파이어볼. */
  fireball: 24,
  /** 커피 메테오 (a mug). */
  coffee: 25,
  /** 칭찬 번개. */
  bolt: 26,
  /** 힐링 포션. */
  potion: 27,
  /** 하이파이브 (an open palm). */
  palm: 28,
  /** 축하 폭죽. */
  firework: 29,
  /** The shield a spell bounces off. */
  shield: 30,
  /** 오늘의 퀘스트 (the quest scroll). */
  scroll: 31,
} as const;
export type EffectName = keyof typeof EFFECT_FRAMES;

/**
 * Bumped with every change to the generated art. Sheets are cached `immutable` at stable URLs, so every sprite URL
 * carries `?r=${SPRITE_REVISION}` and returning visitors fetch the new sheets; the sprite routes ignore the query.
 */
export const SPRITE_REVISION = 2;
const REV = `?r=${SPRITE_REVISION}`;

export const SPRITE_PATHS = {
  manifest: `/assets/sprites/manifest.json${REV}`,
  effects: `/assets/sprites/effects.png${REV}`,
  pet: (species: string): string => `/assets/sprites/pets/${encodeURIComponent(species)}.png${REV}`,
  companion: (species: string): string =>
    `/assets/sprites/companions/${encodeURIComponent(species)}.png${REV}`,
  /** Tinted town (`pt-…`) and companion (`pc-…`) sheets, generated on demand (cached immutable). */
  petApi: (key: string): string => `/api/sprites/pet/${encodeURIComponent(key)}${REV}`,
  avatarStatic: (key: string): string => `/assets/sprites/avatars/${encodeURIComponent(key)}.png${REV}`,
  /** Generated on demand for any valid preset key (cached immutable by the web server). */
  avatarApi: (key: string): string => `/api/sprites/avatar/${encodeURIComponent(key)}${REV}`,
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
