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
}

/** Grounded geometry: shoes' lowest row, torso top row. */
export const FEET_Y = 29;
export const TORSO_Y = 21;
export const LEG_TOP_Y = 27;

/*
 * Torso templates — anchored at x = 8, y = TORSO_Y (16 columns, x 8..23).
 * c base, C shade, L light, a cream, A cream shade, r accent, s skin, S skin shade, p pants, P pants shade
 */
const F_DOWN: Template = [
  '....LcaaaacL....',
  '...LLcarracLc...',
  '...LLccrrccCc...',
  '...s.ccccccC.S..',
  '...ccccccccccC..',
  '..CaCaCaCaCaCa..',
];
const M_DOWN: Template = [
  '....ccaaaacc....',
  '...cccaArAccC...',
  '...cCccArccCC...',
  '...cCcccrccCC...',
  '...s.cccccC.S...',
  '....pppppppP....',
];
const F_UP: Template = [
  '....LccccccL....',
  '...LLccccccLc...',
  '...LLccccccCc...',
  '...s.crrrrC.S...',
  '...ccrrcrrcccC..',
  '..CaCaCaCaCaCa..',
];
const M_UP: Template = [
  '....cccccccc....',
  '...ccccccccCC...',
  '...cCccCcccCC...',
  '...cCccCccCCC...',
  '...s.ccCccC.S...',
  '....pppppppP....',
];
/* Side view (facing left); the near arm is drawn separately so it can swing. */
const F_SIDE: Template = [
  '.....acccccc....',
  '.....arcccccc...',
  '.....cccccccc...',
  '.....cccccccc...',
  '....cccccccccc..',
  '...aCaCaCaCaCa..',
];
const M_SIDE: Template = [
  '.....acccccc....',
  '.....aAcccccc...',
  '.....rcccccccc..',
  '.....cccccccc...',
  '.....cccccccc...',
  '.....ppppppp....',
];

export interface BodyColors {
  base: RGBA;
  shade: RGBA;
  light: RGBA;
  cream: RGBA;
  creamShade: RGBA;
  accent: RGBA;
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
    s: k.skin,
    S: k.skinShade,
    p: k.pants,
    P: k.pantsShade,
    o: k.ink,
  };
}

export type ViewDir = 'down' | 'left' | 'up';

export function drawTorso(c: Canvas, body: BodyType, dir: ViewDir, k: BodyColors, dy: number): void {
  const t =
    dir === 'down' ? (body === 'f' ? F_DOWN : M_DOWN) : dir === 'up' ? (body === 'f' ? F_UP : M_UP) : body === 'f' ? F_SIDE : M_SIDE;
  stamp(c, t, 8, TORSO_Y + dy, bodyMap(k));
}

/** Near arm for the side view, swinging with the walk. */
export function drawSideArm(c: Canvas, body: BodyType, k: BodyColors, dy: number, swing: number): void {
  const y = TORSO_Y + dy;
  const sleeve = body === 'f' ? k.light : k.base;
  if (body === 'f') {
    // puff sleeve
    c.rect(15, y, 3, 2, sleeve);
    c.plot(15, y + 1, k.base);
  } else {
    c.rect(15, y, 2, 3, sleeve);
    c.plot(16, y + 2, k.shade);
  }
  const hx = 15 + (swing > 0 ? -1 : swing < 0 ? 1 : 0);
  const hy = body === 'f' ? y + 2 : y + 3;
  if (body === 'm') c.rect(hx, hy, 2, 1, k.base);
  c.rect(hx, hy + (body === 'm' ? 1 : 0), 2, 1, k.skin);
}

/** Legs + shoes for the front/back views. */
export function drawLegsFront(c: Canvas, body: BodyType, k: BodyColors, pose: Pose, upperDy: number): void {
  const legColor = body === 'f' ? k.skin : k.pants;
  const legShade = body === 'f' ? k.skinShade : k.pantsShade;
  const w = body === 'f' ? 2 : 3;
  const legs: [number, number][] = [
    [body === 'f' ? 13 - pose.spread : 12 - pose.spread, pose.footLift[0]],
    [body === 'f' ? 17 + pose.spread : 17 + pose.spread, pose.footLift[1]],
  ];
  const top = LEG_TOP_Y + upperDy;
  for (const [x, lift] of legs) {
    const foot = FEET_Y - lift;
    for (let y = top; y < foot; y++) {
      c.rect(x, y, w, 1, legColor);
      c.plot(x + w - 1, y, legShade);
    }
    // shoe
    const sx = body === 'f' ? x - (x < 16 ? 1 : 0) : x;
    c.rect(sx, foot, 3, 1, k.shoe);
    c.plot(sx + (x < 16 ? 0 : 2), foot, k.shoeLight);
  }
}

/** Legs for the side view (facing left). */
export function drawLegsSide(c: Canvas, body: BodyType, k: BodyColors, pose: Pose, upperDy: number): void {
  const legColor = body === 'f' ? k.skin : k.pants;
  const legShade = body === 'f' ? k.skinShade : k.pantsShade;
  const top = LEG_TOP_Y + upperDy;
  // far leg first (darker), then near leg
  const offs = pose.stride === 0 ? [1, -1] : pose.stride < 0 ? [2, -2] : [-2, 2];
  const lifts = [pose.footLift[0], pose.footLift[1]];
  const order = [0, 1];
  for (const i of order) {
    const far = i === 0;
    const x = 14 + offs[i]!;
    const foot = FEET_Y - lifts[i]!;
    for (let y = top; y < foot; y++) c.rect(x, y, 2, 1, far ? legShade : legColor);
    c.rect(x - 1, foot, 3, 1, far ? k.shoe : k.shoe);
    c.plot(x - 1, foot, far ? k.shoe : k.shoeLight);
  }
}
