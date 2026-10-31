import type { AvatarPreset } from '@enu/shared';
import { Canvas } from './draw/canvas';
import { darken, mix } from './draw/color';
import { stamp } from './draw/template';
import {
  CREAM,
  CREAM_SHADE,
  HAIR_PALETTES,
  INK,
  OUTFIT_PALETTES,
  SKIN_PALETTES,
  WHITE,
  inkFor,
} from './palette';
import {
  type BodyColors,
  type Pose,
  type ViewDir,
  type WandHold,
  drawLegsFront,
  drawLegsSide,
  drawShoesFront,
  drawTorso,
  drawWandArm,
} from './parts/avatar-body';
import { type FaceColors, drawEars, drawFace, drawHead } from './parts/avatar-head';
import { HAIR_TEMPLATES, HAIR_X, HAIR_Y } from './parts/avatar-hair';
import { type HatColors, hatBrimY, renderHat } from './parts/hat';
import { drawWandShaft, drawWandTip } from './parts/wand';
import { drawWing } from './parts/wings';
import {
  AVATAR_ANIMS,
  AVATAR_COLUMNS,
  AVATAR_DIRECTIONS,
  AVATAR_FRAME,
  type AvatarAnim,
  type AvatarDirection,
} from './spec';

const P = (p: Partial<Pose>): Pose => ({
  lift: 0,
  squash: 0,
  footLift: [0, 0],
  spread: 0,
  stride: 0,
  swing: 0,
  wing: 0,
  arm: 'rest',
  tip: 0,
  hem: 0,
  ...p,
});

/** Idle: breathing bounce (normal, squash, normal, stretch); the wand tip twinkles on 1 and 3. */
export const IDLE_POSES: readonly Pose[] = [
  P({ wing: 0 }),
  P({ squash: 1, wing: 1, tip: 1 }),
  P({ wing: 0 }),
  P({ squash: -1, wing: 1, tip: 2 }),
];

/**
 * Walk: two little hops per cycle — land (squash), take-off (stretch), air. The hem sways a pixel away from the
 * lifted foot (front and back views) or trails behind (side view).
 */
export const WALK_POSES: readonly Pose[] = [
  P({ squash: 1, spread: 1, footLift: [0, 1], stride: -1, swing: 1, wing: 0 }),
  P({ squash: -1, footLift: [0, 1], stride: 0, swing: 0, wing: 1, hem: -1 }),
  P({ lift: 3, footLift: [1, 1], stride: -1, swing: -1, wing: 0, hem: -1 }),
  P({ squash: 1, spread: 1, footLift: [1, 0], stride: 1, swing: -1, wing: 1 }),
  P({ squash: -1, footLift: [1, 0], stride: 0, swing: 0, wing: 0, hem: 1 }),
  P({ lift: 3, footLift: [1, 1], stride: 1, swing: 1, wing: 1, hem: 1 }),
];

/** Cast: wind up (raise the wand), the white star flash at the tip, hold, lower. Feet stay on the ground. */
export const CAST_POSES: readonly Pose[] = [
  P({ squash: 1, arm: 'raise', tip: 1, wing: 1 }),
  P({ squash: -1, arm: 'up', tip: 3, wing: 0 }),
  P({ arm: 'up', tip: 2, wing: 1 }),
  P({ arm: 'lower', tip: 1, wing: 0 }),
];

const POSES: Record<AvatarAnim, readonly Pose[]> = { idle: IDLE_POSES, walk: WALK_POSES, cast: CAST_POSES };

interface Look {
  body: BodyColors;
  face: FaceColors;
  hat: HatColors;
  hair: {
    h: ReturnType<typeof mix>;
    d: ReturnType<typeof mix>;
    l: ReturnType<typeof mix>;
    w: ReturnType<typeof mix>;
  };
}

function lookFor(p: AvatarPreset): Look {
  const o = OUTFIT_PALETTES[p.outfit];
  const s = SKIN_PALETTES[p.skin];
  const h = HAIR_PALETTES[p.hairColor];
  return {
    body: {
      base: o.base,
      shade: o.dark,
      light: o.light,
      cream: CREAM,
      creamShade: CREAM_SHADE,
      accent: o.accent,
      accentShade: mix(o.accent, o.dark, 0.35),
      skin: s.base,
      skinShade: s.shade,
      pants: o.pants,
      pantsShade: o.pantsDark,
      shoe: o.shoe,
      shoeLight: mix(o.shoe, WHITE, 0.35),
      ink: INK,
    },
    face: {
      skin: s.base,
      skinShade: s.shade,
      blush: s.blush,
      ink: INK,
      eye: h.eye,
      eyeLight: h.eyeLight,
      white: WHITE,
      mouth: mix(INK, s.blush, 0.45),
    },
    hat: {
      hat: o.dark,
      shade: darken(o.dark, 0.3),
      light: o.base,
      band: o.accent,
      bandShade: mix(o.accent, o.dark, 0.35),
    },
    hair: { h: h.base, d: h.dark, l: h.light, w: h.shine },
  };
}

function viewOf(dir: AvatarDirection): ViewDir {
  return dir === 'right' ? 'left' : dir;
}

/** Renders one 32x32 frame (facing `dir`) without the mirror for `right`. */
function renderFigure(p: AvatarPreset, view: ViewDir, pose: Pose): Canvas {
  const look = lookFor(p);
  const hat = p.hat !== false;
  const fig = new Canvas(AVATAR_FRAME, AVATAR_FRAME);
  const up = pose.squash; // upper-body offset relative to the feet
  const hairSet = HAIR_TEMPLATES[p.hair][view];
  const hairColors = {
    h: look.hair.h,
    d: look.hair.d,
    l: look.hair.l,
    w: look.hair.w,
    t: look.body.accent,
    T: look.body.shade,
  };
  // a raised wand arm is in front of the hair; at rest it hangs by the body
  const armOverHair = pose.arm === 'raise' || pose.arm === 'up';

  if (hairSet.back && view !== 'up') stamp(fig, hairSet.back, HAIR_X, HAIR_Y + up, hairColors);

  if (view === 'left') drawLegsSide(fig, look.body, pose, up, 'legs');
  else drawLegsFront(fig, p.body, look.body, pose, up);
  drawTorso(fig, p.body, view, look.body, up, view === 'left' ? Math.abs(pose.hem) : pose.hem);
  if (view === 'left') drawLegsSide(fig, look.body, pose, up, 'shoes');
  else drawShoesFront(fig, look.body, pose);

  let hold: WandHold | undefined;
  if (!armOverHair) hold = drawWandArm(fig, p.body, view, pose.arm, look.body, up, pose.swing);

  drawEars(fig, view, look.face, up);
  drawHead(fig, view, look.face, up);
  drawFace(fig, view, look.face, up);

  // hair + the soft shadow it casts on the forehead
  const hair = new Canvas(AVATAR_FRAME, AVATAR_FRAME);
  stamp(hair, hairSet.front, HAIR_X, HAIR_Y + up, hairColors);
  if (view === 'up' && hairSet.back) stamp(hair, hairSet.back, HAIR_X, HAIR_Y + up, hairColors);
  for (let y = 1; y < AVATAR_FRAME; y++) {
    for (let x = 0; x < AVATAR_FRAME; x++) {
      if (hair.alpha(x, y) === 0 && hair.alpha(x, y - 1) > 0 && fig.alpha(x, y) > 0) {
        const under = fig.get(x, y);
        if (
          under[0] === look.face.skin[0] &&
          under[1] === look.face.skin[1] &&
          under[2] === look.face.skin[2]
        ) {
          fig.set(x, y, look.face.skinShade);
        }
      }
    }
  }
  fig.blit(hair, 0, 0);

  if (armOverHair) hold = drawWandArm(fig, p.body, view, pose.arm, look.body, up, pose.swing);

  // the hat hides whatever hair would stick out above its brim (spikes, buns, ties)
  if (hat) {
    const brim = hatBrimY(view, up);
    for (let y = 0; y < brim; y++) for (let x = 0; x < AVATAR_FRAME; x++) fig.set(x, y, [0, 0, 0, 0]);
  }

  fig.outline(INK, { tint: inkFor });

  const out = new Canvas(AVATAR_FRAME, AVATAR_FRAME);
  const wings = new Canvas(AVATAR_FRAME, AVATAR_FRAME);
  if (p.wings) {
    const wy = 22 + up;
    if (view === 'left') {
      drawWing(wings, 18, wy, 'right', pose.wing);
    } else {
      drawWing(wings, 19, wy, 'right', pose.wing);
      drawWing(wings, 12, wy, 'left', pose.wing);
    }
  }
  // the wand: behind the body in the back view, in front otherwise
  const wand = new Canvas(AVATAR_FRAME, AVATAR_FRAME);
  if (hold) drawWandShaft(wand, hold.grip, hold.tip);

  if (view === 'up') {
    out.blit(wand, 0, 0);
    out.blit(fig, 0, 0);
    out.blit(wings, 0, 0);
  } else {
    out.blit(wings, 0, 0);
    out.blit(fig, 0, 0);
    out.blit(wand, 0, 0);
  }
  if (hat) out.blit(renderHat(view, look.hat, up), 0, 0);
  if (hold) drawWandTip(out, hold.tip, pose.tip);
  return shift(out, pose.lift);
}

function shift(c: Canvas, lift: number): Canvas {
  if (!lift) return c;
  const out = new Canvas(c.width, c.height);
  out.blit(c, 0, -lift);
  return out;
}

/** One frame of the avatar sheet (pure). */
export function renderAvatarFrame(
  p: AvatarPreset,
  dir: AvatarDirection,
  anim: AvatarAnim,
  i: number,
): Canvas {
  const poses = POSES[anim];
  const pose = poses[i % poses.length]!;
  const fig = renderFigure(p, viewOf(dir), pose);
  return dir === 'right' ? fig.flipX() : fig;
}

/** Full avatar sheet as RGBA pixels (browser-safe: no PNG encoding). */
export function renderAvatarImage(p: AvatarPreset): Canvas {
  const sheet = new Canvas(AVATAR_COLUMNS * AVATAR_FRAME, AVATAR_DIRECTIONS.length * AVATAR_FRAME);
  AVATAR_DIRECTIONS.forEach((dir, row) => {
    for (const anim of Object.keys(AVATAR_ANIMS) as AvatarAnim[]) {
      const def = AVATAR_ANIMS[anim];
      for (let i = 0; i < def.frames; i++) {
        sheet.blit(renderAvatarFrame(p, dir, anim, i), (def.start + i) * AVATAR_FRAME, row * AVATAR_FRAME);
      }
    }
  });
  return sheet;
}
