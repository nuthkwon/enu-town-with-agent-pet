import type { BodyType } from '@enu/shared';
import type { Canvas } from '../draw/canvas';
import type { RGBA } from '../draw/color';
import { type ColorMap, type Template, stamp } from '../draw/template';

/** Pose of one avatar frame (all values in px). */
export interface Pose {
  /** Whole-body lift (hop), positive = up. */
  lift: number;
  /** Upper body (torso+head) offset relative to the feet: +1 squash, -1 stretch. */
  squash: number;
  /** Per-foot lift for the down/up views (left foot, right foot as seen on screen). */
  footLift: readonly [number, number];
  /** Feet spread outward (landing squash). */
  spread: number;
  /** Side view stride: -1 left foot forward, 0 together, 1 right foot forward. */
  stride: number;
  /** Arm swing (-1 back, 0, 1 forward). */
  swing: number;
  /** Wing phase 0 = open, 1 = raised. */
  wing: number;
  /** The wand arm: at rest, raised (cast wind-up), up (cast), or lowering. */
  arm: WandArm;
  /** Wand tip light: 0 glow, 1 small twinkle, 2 bright twinkle, 3 star flash. */
  tip: 0 | 1 | 2 | 3;
  /** Hem sway with the stride (px): the robe's two lowest rows shift sideways. */
  hem: number;
}

export type WandArm = 'rest' | 'raise' | 'up' | 'lower';

/** Grounded geometry: shoes' lowest row, torso top row. */
export const FEET_Y = 29;
export const TORSO_Y = 21;
export const LEG_TOP_Y = 27;

/*
 * Robe templates — anchored at x = 8, y = TORSO_Y (16 columns, x 8..23; 8 rows, y 21..28: the hem stops just
 * above the shoes). The wand arm is not part of the template (see `drawWandArm`); the other sleeve is.
 * c base, C shade, L light, a cream trim, A cream shade, r accent (sash, clasp), R accent shade, s skin,
 * S skin shade.
 */
const F_DOWN: Template = [
  '.....LcaacC.....',
  '.....LcrrcCC....',
  '.....LccccCCC...',
  '.....rrrrrRAaa..',
  '....LccccccC.S..',
  '....LccccccC....',
  '...LccccccccC...',
  '...aAaAaAaAaA...',
];
const M_DOWN: Template = [
  '....LccaaccC....',
  '....LccrrccCCC..',
  '....LccccccCCC..',
  '....rrrrrrrRAaa.',
  '....LccccccC.S..',
  '....LccccccC....',
  '...LccccccccC...',
  '...aAaAaAaAaA...',
];
const F_UP: Template = [
  '.....LccccC.....',
  '....LLccccC.....',
  '...LLLccccC.....',
  '..aaArrrrrR.....',
  '..s.LccccccC....',
  '....LccccccC....',
  '...LccccccccC...',
  '...aAaAaAaAaA...',
];
const M_UP: Template = [
  '....LccccccC....',
  '..LLLccccccC....',
  '..LLLccccccC....',
  '.aaArrrrrrrR....',
  '..s.LccccccC....',
  '....LccccccC....',
  '...LccccccccC...',
  '...aAaAaAaAaA...',
];
/* Side view (facing left); the near arm (holding the wand) is drawn separately so it can swing. */
const F_SIDE: Template = [
  '.....acccccC....',
  '.....arccccCC...',
  '.....acccccCC...',
  '.....rrrrrrRC...',
  '....acccccccC...',
  '....acccccccCC..',
  '...acccccccccC..',
  '...aAaAaAaAaAa..',
];
const M_SIDE: Template = [
  '.....acccccC....',
  '.....arccccCC...',
  '.....acccccCC...',
  '.....rrrrrrRC...',
  '.....accccccC...',
  '.....accccccCC..',
  '....acccccccCC..',
  '....aAaAaAaAaA..',
];

export interface BodyColors {
  base: RGBA;
  shade: RGBA;
  light: RGBA;
  cream: RGBA;
  creamShade: RGBA;
  accent: RGBA;
  accentShade: RGBA;
  skin: RGBA;
  skinShade: RGBA;
  pants: RGBA;
  pantsShade: RGBA;
  shoe: RGBA;
  shoeLight: RGBA;
  ink: RGBA;
}

function bodyMap(k: BodyColors): ColorMap {
  return {
    c: k.base,
    C: k.shade,
    L: k.light,
    a: k.cream,
    A: k.creamShade,
    r: k.accent,
    R: k.accentShade,
    s: k.skin,
    S: k.skinShade,
    p: k.pants,
    P: k.pantsShade,
    o: k.ink,
  };
}

export type ViewDir = 'down' | 'left' | 'up';

/** Rows at the bottom of a robe template that sway with the stride. */
const HEM_ROWS = 2;

/** The robe (without the wand arm); `hem` shifts its two lowest rows sideways. */
export function drawTorso(c: Canvas, body: BodyType, dir: ViewDir, k: BodyColors, dy: number, hem = 0): void {
  const t =
    dir === 'down'
      ? body === 'f'
        ? F_DOWN
        : M_DOWN
      : dir === 'up'
        ? body === 'f'
          ? F_UP
          : M_UP
        : body === 'f'
          ? F_SIDE
          : M_SIDE;
  const split = t.length - HEM_ROWS;
  stamp(c, t.slice(0, split), 8, TORSO_Y + dy, bodyMap(k));
  stamp(c, t.slice(split), 8 + hem, TORSO_Y + dy + split, bodyMap(k));
}

/*
 * The wand arm: a wide sleeve with a cream cuff and the hand that holds the wand. `t` is stamped with its
 * top-left at `at`; `grip` is the hand and `tip` the wand tip. All in frame pixels for an upright pose (the
 * upper-body offset moves them). Down view: the character's right arm (screen left). Up view: the right arm
 * again (screen right). Side view (facing left): the near arm.
 */
interface ArmArt {
  t: Template;
  at: readonly [number, number];
  grip: readonly [number, number];
  tip: readonly [number, number];
}

const arm = (
  t: Template,
  at: readonly [number, number],
  grip: readonly [number, number],
  tip: readonly [number, number],
): ArmArt => ({ t, at, grip, tip });

const MIRROR_KEYS: Readonly<Record<string, string>> = { L: 'C', C: 'c', c: 'C', A: 'a', s: 'S' };

/** Mirrors an arm of the down view onto the screen-right side (the up view), shading the far side. */
function mirrorArm(a: ArmArt): ArmArt {
  const w = Math.max(...a.t.map((r) => r.length));
  return {
    t: a.t.map((r) =>
      r
        .padEnd(w, '.')
        .split('')
        .reverse()
        .map((ch) => MIRROR_KEYS[ch] ?? ch)
        .join(''),
    ),
    at: [31 - (a.at[0] + w - 1), a.at[1]],
    grip: [31 - a.grip[0], a.grip[1]],
    tip: [31 - a.tip[0], a.tip[1]],
  };
}

/* Both bodies raise the hand to the same spot, so the cast's flash (`AVATAR_WAND_TIP`) is per direction only. */
const DOWN_F: Record<WandArm, ArmArt> = {
  rest: arm(['..L', '.LL', 'aaA', 's..'], [10, 22], [10, 25], [5, 20]),
  raise: arm(['.s...', '.aA..', '..LLL', '...LL'], [8, 20], [9, 20], [6, 17]),
  up: arm(['.s....', '.aA...', '..LL..', '...LL.', '....LL'], [7, 18], [8, 18], [5, 15]),
  lower: arm(['..LL', 'aALL', 's...'], [9, 22], [9, 24], [6, 21]),
};
const DOWN_M: Record<WandArm, ArmArt> = {
  rest: arm(['.LL', 'LLL', 'aaA', '.s.'], [9, 22], [10, 25], [5, 20]),
  raise: arm(['.s..', '.aA.', '..LL', '...L'], [8, 20], [9, 20], [6, 17]),
  up: arm(['.s...', '.aA..', '..LL.', '...LL', '....L'], [7, 18], [8, 18], [5, 15]),
  lower: arm(['..LL', 'aALL', 's...'], [8, 22], [8, 24], [5, 21]),
};
const mirrorAll = (r: Record<WandArm, ArmArt>): Record<WandArm, ArmArt> => ({
  rest: mirrorArm(r.rest),
  raise: mirrorArm(r.raise),
  up: mirrorArm(r.up),
  lower: mirrorArm(r.lower),
});
const SIDE: Record<WandArm, ArmArt> = {
  rest: arm(['LLc', 'LLc', 'aaA', 's..'], [15, 21], [15, 25], [10, 20]),
  raise: arm(['..LLc', 'aALLc', 's....'], [12, 21], [12, 23], [9, 20]),
  up: arm(['aALLLc', 'sALLc.'], [10, 21], [10, 22], [6, 22]),
  lower: arm(['.LLc', 'aALc', 's...'], [13, 21], [13, 23], [10, 21]),
};

const ARMS: Record<ViewDir, Record<BodyType, Record<WandArm, ArmArt>>> = {
  down: { f: DOWN_F, m: DOWN_M },
  up: { f: mirrorAll(DOWN_F), m: mirrorAll(DOWN_M) },
  left: { f: SIDE, m: SIDE },
};

export interface WandHold {
  /** Hand pixel holding the wand (frame coordinates). */
  grip: readonly [number, number];
  /** Wand tip pixel (frame coordinates). */
  tip: readonly [number, number];
}

/** Draws the wand arm and returns where the hand and the wand tip are. `swing` moves the side-view hand. */
export function drawWandArm(
  c: Canvas,
  body: BodyType,
  view: ViewDir,
  pose: WandArm,
  k: BodyColors,
  dy: number,
  swing: number,
): WandHold {
  const art = ARMS[view][body][pose];
  const sx = view === 'left' && pose === 'rest' ? (swing > 0 ? -1 : swing < 0 ? 1 : 0) : 0;
  stamp(c, art.t, art.at[0] + sx, art.at[1] + dy, bodyMap(k));
  return {
    grip: [art.grip[0] + sx, art.grip[1] + dy],
    tip: [art.tip[0] + sx, art.tip[1] + dy],
  };
}

/** Legs for the front/back views: they only show where a stretch or a step lifts the hem off the shoes. */
export function drawLegsFront(c: Canvas, body: BodyType, k: BodyColors, pose: Pose, upperDy: number): void {
  const w = 2;
  const legs: [number, number][] = [
    [body === 'f' ? 13 - pose.spread : 12 - pose.spread, pose.footLift[0]],
    [body === 'f' ? 17 + pose.spread : 18 + pose.spread, pose.footLift[1]],
  ];
  const top = LEG_TOP_Y + upperDy;
  for (const [x, lift] of legs) {
    const foot = FEET_Y - lift;
    for (let y = top; y < foot; y++) {
      c.rect(x, y, w, 1, k.pants);
      c.plot(x + w - 1, y, k.pantsShade);
    }
  }
}

/** Shoes for the front/back views, drawn over the hem so a lifted foot stays visible. */
export function drawShoesFront(c: Canvas, k: BodyColors, pose: Pose): void {
  const feet: [number, number][] = [
    [12 - pose.spread, pose.footLift[0]],
    [17 + pose.spread, pose.footLift[1]],
  ];
  for (const [x, lift] of feet) {
    const foot = FEET_Y - lift;
    c.rect(x, foot, 3, 1, k.shoe);
    c.plot(x + (x < 16 ? 0 : 2), foot, k.shoeLight);
  }
}

/** Legs for the side view (facing left); `shoes` draws only the shoes (over the hem). */
export function drawLegsSide(
  c: Canvas,
  k: BodyColors,
  pose: Pose,
  upperDy: number,
  part: 'legs' | 'shoes',
): void {
  const top = LEG_TOP_Y + upperDy;
  // far leg first (darker), then near leg
  const offs = pose.stride === 0 ? [1, -1] : pose.stride < 0 ? [2, -2] : [-2, 2];
  const lifts = [pose.footLift[0], pose.footLift[1]];
  for (const i of [0, 1]) {
    const far = i === 0;
    const x = 14 + offs[i]!;
    const foot = FEET_Y - lifts[i]!;
    if (part === 'legs') {
      for (let y = top; y < foot; y++) c.rect(x, y, 2, 1, far ? k.pantsShade : k.pants);
      continue;
    }
    c.rect(x - 1, foot, 3, 1, k.shoe);
    c.plot(x - 1, foot, far ? k.shoe : k.shoeLight);
  }
}
