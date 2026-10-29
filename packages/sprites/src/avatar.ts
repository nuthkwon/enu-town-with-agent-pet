import type { AvatarPreset } from '@enu/shared';
import { Canvas } from './draw/canvas';
import { mix } from './draw/color';
import { stamp } from './draw/template';
import { CREAM, CREAM_SHADE, HAIR_PALETTES, INK, OUTFIT_PALETTES, SKIN_PALETTES, WHITE, inkFor } from './palette';
import {
  type BodyColors,
  type Pose,
  type ViewDir,
  drawLegsFront,
  drawLegsSide,
  drawSideArm,
  drawTorso,
} from './parts/avatar-body';
import { type FaceColors, drawEars, drawFace, drawHead } from './parts/avatar-head';
import { HAIR_TEMPLATES, HAIR_X, HAIR_Y } from './parts/avatar-hair';
import { drawWing } from './parts/wings';
import { AVATAR_ANIMS, AVATAR_COLUMNS, AVATAR_DIRECTIONS, AVATAR_FRAME, type AvatarDirection } from './spec';

const P = (p: Partial<Pose>): Pose => ({
  lift: 0,
  squash: 0,
  footLift: [0, 0],
  spread: 0,
  stride: 0,
  swing: 0,
  wing: 0,
  ...p,
});

/** Idle: breathing bounce (normal, squash, normal, stretch). */
export const IDLE_POSES: readonly Pose[] = [
  P({ wing: 0 }),
  P({ squash: 1, wing: 1 }),
  P({ wing: 0 }),
  P({ squash: -1, wing: 1 }),
];

/** Walk: two little hops per cycle — land (squash), take-off (stretch), air. */
export const WALK_POSES: readonly Pose[] = [
  P({ squash: 1, spread: 1, footLift: [0, 1], stride: -1, swing: 1, wing: 0 }),
  P({ squash: -1, footLift: [0, 1], stride: 0, swing: 0, wing: 1 }),
  P({ lift: 3, footLift: [1, 1], stride: -1, swing: -1, wing: 0 }),
  P({ squash: 1, spread: 1, footLift: [1, 0], stride: 1, swing: -1, wing: 1 }),
  P({ squash: -1, footLift: [1, 0], stride: 0, swing: 0, wing: 0 }),
  P({ lift: 3, footLift: [1, 1], stride: 1, swing: 1, wing: 1 }),
];

interface Look {
  body: BodyColors;
  face: FaceColors;
  hair: { h: ReturnType<typeof mix>; d: ReturnType<typeof mix>; l: ReturnType<typeof mix>; w: ReturnType<typeof mix> };
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
    hair: { h: h.base, d: h.dark, l: h.light, w: h.shine },
  };
}

function viewOf(dir: AvatarDirection): ViewDir {
  return dir === 'right' ? 'left' : dir;
}

/** Renders one 32x32 frame (facing `dir`) without the mirror for `right`. */
function renderFigure(p: AvatarPreset, view: ViewDir, pose: Pose): Canvas {
  const look = lookFor(p);
  const fig = new Canvas(AVATAR_FRAME, AVATAR_FRAME);
  const up = pose.squash; // upper-body offset relative to the feet
  const hairSet = HAIR_TEMPLATES[p.hair][view];
  const hairColors = { h: look.hair.h, d: look.hair.d, l: look.hair.l, w: look.hair.w, t: look.body.accent, T: look.body.shade };

  if (hairSet.back && view !== 'up') stamp(fig, hairSet.back, HAIR_X, HAIR_Y + up, hairColors);

  if (view === 'left') drawLegsSide(fig, p.body, look.body, pose, up);
  else drawLegsFront(fig, p.body, look.body, pose, up);
  drawTorso(fig, p.body, view, look.body, up);
  if (view === 'left') drawSideArm(fig, p.body, look.body, up, pose.swing);

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
        if (under[0] === look.face.skin[0] && under[1] === look.face.skin[1] && under[2] === look.face.skin[2]) {
          fig.set(x, y, look.face.skinShade);
        }
      }
    }
  }
  fig.blit(hair, 0, 0);

  fig.outline(INK, { tint: inkFor });

  if (!p.wings) return shift(fig, pose.lift);

  const wings = new Canvas(AVATAR_FRAME, AVATAR_FRAME);
  const wy = 22 + up;
  if (view === 'left') {
    drawWing(wings, 18, wy, 'right', pose.wing);
  } else {
    drawWing(wings, 19, wy, 'right', pose.wing);
    drawWing(wings, 12, wy, 'left', pose.wing);
  }
  const out = new Canvas(AVATAR_FRAME, AVATAR_FRAME);
  if (view === 'up') {
    out.blit(fig, 0, 0);
    out.blit(wings, 0, 0);
  } else {
    out.blit(wings, 0, 0);
    out.blit(fig, 0, 0);
  }
  return shift(out, pose.lift);
}

function shift(c: Canvas, lift: number): Canvas {
  if (!lift) return c;
  const out = new Canvas(c.width, c.height);
  out.blit(c, 0, -lift);
  return out;
}

/** One frame of the avatar sheet (pure). */
export function renderAvatarFrame(p: AvatarPreset, dir: AvatarDirection, anim: 'idle' | 'walk', i: number): Canvas {
  const poses = anim === 'idle' ? IDLE_POSES : WALK_POSES;
  const pose = poses[i % poses.length]!;
  const fig = renderFigure(p, viewOf(dir), pose);
  return dir === 'right' ? fig.flipX() : fig;
}

/** Full avatar sheet as RGBA pixels (browser-safe: no PNG encoding). */
export function renderAvatarImage(p: AvatarPreset): Canvas {
  const sheet = new Canvas(AVATAR_COLUMNS * AVATAR_FRAME, AVATAR_DIRECTIONS.length * AVATAR_FRAME);
  AVATAR_DIRECTIONS.forEach((dir, row) => {
    for (const [anim, def] of Object.entries(AVATAR_ANIMS) as ['idle' | 'walk', { start: number; frames: number }][]) {
      for (let i = 0; i < def.frames; i++) {
        sheet.blit(renderAvatarFrame(p, dir, anim, i), (def.start + i) * AVATAR_FRAME, row * AVATAR_FRAME);
      }
    }
  });
  return sheet;
}
