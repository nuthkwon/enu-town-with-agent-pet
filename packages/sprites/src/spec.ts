import { TILE_CATALOG, TILE_SIZE, TILESET_COLUMNS } from '@enu/shared';

/**
 * Sprite sheet contract shared by the generator and the Phaser client.
 *
 * Every sheet is a grid of equally sized frames, numbered row-major:
 *   frame index = row * columns + col
 * Phaser: `this.load.spritesheet(key, url, { frameWidth, frameHeight })` and then
 * `anims.create({ frames: anims.generateFrameNumbers(key, { start, end }) , frameRate, repeat })`
 * with `start = row * columns + anim.start` and `end = start + anim.frames - 1`
 * (see `avatarAnimFrames` / `petAnimFrames`).
 */

export interface AnimDef {
  /** First column of the animation within a row. */
  readonly start: number;
  readonly frames: number;
  readonly frameRate: number;
  /** -1 loops forever (Phaser semantics). */
  readonly repeat: number;
}

/* ------------------------------------------------------------------------------------------------
 * Avatars — one sheet per preset (`avatarSpriteKey(preset)`), 32x32 frames.
 *
 *   columns: 0-3 idle (breathing bounce), 4-9 walk (hop cycle)            -> 10 columns
 *   rows:    0 down (front, face visible), 1 left, 2 right (mirror of left), 3 up (back)
 *   sheet:   320 x 128 px
 *
 * The shoes' outline always ends on row `AVATAR_FEET_Y - 1` when grounded (idle, land and take-off
 * frames); the two air frames of the walk lift the feet by `AVATAR_WALK_LIFT` px, so keep the drop
 * shadow on the ground line and shrink/fade it on lifted frames. Idle = breathing bounce
 * (normal, squash 1px, normal, stretch 1px); walk = two little hops (squash on landing, stretch at
 * take-off, air). The top rows stay transparent so hops never clip. The figure is centred on x 16.
 * ---------------------------------------------------------------------------------------------- */
export const AVATAR_FRAME = 32;
export const AVATAR_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type AvatarDirection = (typeof AVATAR_DIRECTIONS)[number];
export const AVATAR_ANIMS = {
  idle: { start: 0, frames: 4, frameRate: 6, repeat: -1 },
  walk: { start: 4, frames: 6, frameRate: 12, repeat: -1 },
} as const satisfies Record<string, AnimDef>;
export type AvatarAnim = keyof typeof AVATAR_ANIMS;
export const AVATAR_COLUMNS = 10;
export const AVATAR_ROWS = AVATAR_DIRECTIONS.length;
export const AVATAR_SHEET_WIDTH = AVATAR_COLUMNS * AVATAR_FRAME;
export const AVATAR_SHEET_HEIGHT = AVATAR_ROWS * AVATAR_FRAME;
/** Row (y, inside a frame) just below the shoes' outline: the ground line for shadows/depth sort. */
export const AVATAR_FEET_Y = 31;
/** Suggested sprite origin so (x, y) of the game object is the point between the feet. */
export const AVATAR_ORIGIN = { x: 0.5, y: AVATAR_FEET_Y / AVATAR_FRAME } as const;
/** Gap (px) between the feet and the ground line per idle frame (idle never leaves the ground). */
export const AVATAR_IDLE_LIFT = [0, 0, 0, 0] as const;
/**
 * Gap (px) between the feet and the ground line per walk frame (land+squash, take-off+stretch, air,
 * land, take-off, air). In the air frames the body rises 3px and the feet tuck 1px. Use it to shrink
 * or fade the drop shadow on airborne frames.
 */
export const AVATAR_WALK_LIFT = [0, 0, 4, 0, 0, 4] as const;
export const AVATAR_MAX_HOP = 4;

/* ------------------------------------------------------------------------------------------------
 * Pets — one sheet per species (`pets/<species>.png`), 24x24 frames.
 *
 *   columns: 0-3 idle (fairy hover, wings flap), 4-9 hop, 10-11 sleep (eyes closed, wings folded)
 *   rows:    0 facing left, 1 facing right (mirror)
 *   sheet:   288 x 48 px
 * Pets float: their lowest pixel is at most `PET_GROUND_Y` - 1 (sleep frames rest on it).
 * ---------------------------------------------------------------------------------------------- */
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
export const PET_ROWS = PET_DIRECTIONS.length;
export const PET_SHEET_WIDTH = PET_COLUMNS * PET_FRAME;
export const PET_SHEET_HEIGHT = PET_ROWS * PET_FRAME;
/** Ground line inside a pet frame (place the small shadow here). */
export const PET_GROUND_Y = 23;
export const PET_ORIGIN = { x: 0.5, y: PET_GROUND_Y / PET_FRAME } as const;

/* ------------------------------------------------------------------------------------------------
 * Effects — `effects.png`, 16x16 frames, 8 columns x 3 rows (128 x 48 px).
 *
 *   rows 0-1: sparkles, shadows and pet / bubble badges
 *   row 2:    activity icons drawn over a shown avatar's head or on a hidden person's desk plate.
 *             Their indices are fixed (the web client keeps a copy in apps/web/src/game/spriteSpec.ts);
 *             docs (문서 작성) reuses `note`.
 * ---------------------------------------------------------------------------------------------- */
export const EFFECT_FRAME = 16;
export const EFFECT_COLUMNS = 8;
export const EFFECT_FRAMES = {
  sparkle0: 0,
  sparkle1: 1,
  sparkle2: 2,
  sparkle3: 3,
  star: 4,
  heart: 5,
  /** Soft ground shadow for avatars (14x5 ellipse centred in the frame: origin 0.5/0.5 at the feet). */
  shadow: 6,
  /** Smaller ground shadow for pets (10x4 ellipse, centred). */
  shadowSmall: 7,
  zzz: 8,
  /** Stale link-state badge. */
  clock: 9,
  /** Typing / "…" indicator. */
  dots: 10,
  /** Due-time chip icon. */
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
  /** DM / work request paper plane (drawn for the two participants only). */
  plane: 23,
} as const;
export type EffectName = keyof typeof EFFECT_FRAMES;
export const EFFECT_ROWS = 3;
export const EFFECT_SHEET_WIDTH = EFFECT_COLUMNS * EFFECT_FRAME;
export const EFFECT_SHEET_HEIGHT = EFFECT_ROWS * EFFECT_FRAME;
export const EFFECT_ANIMS = {
  sparkle: { start: EFFECT_FRAMES.sparkle0, frames: 4, frameRate: 8, repeat: -1 },
} as const satisfies Record<string, AnimDef>;

/* ------------------------------------------------------------------------------------------------
 * Office tileset — `office-tiles.png`, one tile per TILE_CATALOG entry in order (gid = index + 1).
 * ---------------------------------------------------------------------------------------------- */
export const TILE = TILE_SIZE;
export const TILESET_TILE_COUNT = TILE_CATALOG.length;
export const TILESET_ROWS = Math.ceil(TILE_CATALOG.length / TILESET_COLUMNS);
export const TILESET_WIDTH = TILESET_COLUMNS * TILE;
export const TILESET_HEIGHT = TILESET_ROWS * TILE;
export { TILESET_COLUMNS };

/* ------------------------------------------------------------------------------------------------
 * Public asset URLs (relative to `apps/web/public`).
 * ---------------------------------------------------------------------------------------------- */
/* ------------------------------------------------------------------------------------------------
 * Companions — the big pet of a pet room (messenger-spec §8), one sheet per species
 * (`companions/<species>.png`, base colours; tints come from `/api/sprites/pet/pc-<species>-<tint>`).
 *
 *   one row facing left (3/4 view), 24x24 frames drawn at 3-5x with pixelated scaling:
 *   0-3 idle, 4-5 blink, 6-7 listen, 8-11 think, 12-15 talk, 16-19 happy, 20-21 sleep   -> 22 columns
 *   sheet: 528 x 24 px
 * ---------------------------------------------------------------------------------------------- */
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
export const COMPANION_SHEET_WIDTH = COMPANION_COLUMNS * COMPANION_FRAME;
export const COMPANION_SHEET_HEIGHT = COMPANION_FRAME;

export const SPRITE_PATHS = {
  manifest: '/assets/sprites/manifest.json',
  effects: '/assets/sprites/effects.png',
  tileset: '/assets/maps/office-606/office-tiles.png',
  pet: (species: string): string => `/assets/sprites/pets/${species}.png`,
  companion: (species: string): string => `/assets/sprites/companions/${species}.png`,
  /** Tinted town (`pt-<species>-<tint>`) and companion (`pc-<species>-<tint>`) sheets, rendered on demand. */
  petApi: (key: string): string => `/api/sprites/pet/${key}`,
  avatar: (key: string): string => `/assets/sprites/avatars/${key}.png`,
} as const;

/** Frame numbers (inclusive range) of an avatar animation for one direction. */
export function avatarAnimFrames(dir: AvatarDirection, anim: AvatarAnim): { start: number; end: number } {
  const row = AVATAR_DIRECTIONS.indexOf(dir);
  const a = AVATAR_ANIMS[anim];
  const start = row * AVATAR_COLUMNS + a.start;
  return { start, end: start + a.frames - 1 };
}

/** Frame numbers (inclusive range) of a pet animation for one direction. */
export function petAnimFrames(dir: PetDirection, anim: PetAnim): { start: number; end: number } {
  const row = PET_DIRECTIONS.indexOf(dir);
  const a = PET_ANIMS[anim];
  const start = row * PET_COLUMNS + a.start;
  return { start, end: start + a.frames - 1 };
}

/** JSON-friendly summary of the whole contract (written into manifest.json). */
export function spriteSpec() {
  return {
    avatar: {
      frameWidth: AVATAR_FRAME,
      frameHeight: AVATAR_FRAME,
      columns: AVATAR_COLUMNS,
      rows: AVATAR_DIRECTIONS,
      anims: AVATAR_ANIMS,
      feetY: AVATAR_FEET_Y,
      origin: AVATAR_ORIGIN,
      idleLift: AVATAR_IDLE_LIFT,
      walkLift: AVATAR_WALK_LIFT,
    },
    pet: {
      frameWidth: PET_FRAME,
      frameHeight: PET_FRAME,
      columns: PET_COLUMNS,
      rows: PET_DIRECTIONS,
      anims: PET_ANIMS,
      groundY: PET_GROUND_Y,
      origin: PET_ORIGIN,
    },
    companion: {
      frameWidth: COMPANION_FRAME,
      frameHeight: COMPANION_FRAME,
      columns: COMPANION_COLUMNS,
      expressions: COMPANION_EXPRESSIONS,
    },
    effects: {
      frameWidth: EFFECT_FRAME,
      frameHeight: EFFECT_FRAME,
      columns: EFFECT_COLUMNS,
      frames: EFFECT_FRAMES,
      anims: EFFECT_ANIMS,
    },
    tileset: {
      tileWidth: TILE,
      tileHeight: TILE,
      columns: TILESET_COLUMNS,
      tileCount: TILESET_TILE_COUNT,
      names: TILE_CATALOG.map((t) => t.name),
    },
  };
}
