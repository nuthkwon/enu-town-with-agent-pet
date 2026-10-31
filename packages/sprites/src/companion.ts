import type { PetSpecies, PetTint } from '@enu/shared';
import { Canvas } from './draw/canvas';
import { hex, withAlpha } from './draw/color';
import type { ColorMap } from './draw/template';
import { INK, SPARKLE, inkFor } from './palette';
import { MOUTH_KEY, glanceAside, openMouth } from './parts/faces';
import { PET_ART, type PetArt } from './parts/pets';
import { PET_POSES, drawPet, drawSparkle, petBodyOrigin, petFrameColors, petRowY, type PetPose } from './pet';
import {
  COMPANION_COLUMNS,
  COMPANION_EXPRESSIONS,
  COMPANION_FRAME,
  type CompanionExpression,
  PET_FRAME,
} from './spec';

/**
 * The companion: the same fairy pet as in the town, with expressions for the pet room header (listening while the
 * owner types, thinking while a reply is pending, talking when one arrives, happy, asleep) and the familiar's play
 * (ADR 0008: munching a snack, showing a little spell). It only ever reacts to the owner's own room; nothing here
 * is shown to colleagues as a live state, and it is pictures only (never text).
 */

const MOUTH = hex('#a3466e');
/** Thought dots (2x2 ink squares) rising to the top right, one more per frame. */
const THOUGHT_DOTS: readonly [number, number][] = [
  [16, 3],
  [19, 1],
  [22, 0],
];

const IDLE = PET_POSES.idle;
const HOP = PET_POSES.hop;
const SLEEP = PET_POSES.sleep;

function pose(base: PetPose, over: Partial<PetPose> = {}): PetPose {
  return { ...base, ...over };
}

/** One 24x24 companion frame (pure). */
export function renderCompanionFrame(
  species: PetSpecies,
  expr: CompanionExpression,
  i: number,
  tint: PetTint = 'base',
): Canvas {
  const art = PET_ART[species];
  const open = petFrameColors(art, tint, false);
  const closed = petFrameColors(art, tint, true);
  const frames = COMPANION_EXPRESSIONS[expr].frames;
  const f = i % frames;
  switch (expr) {
    case 'idle':
      return drawPet(art, art.body, open, IDLE[f]!);
    case 'blink':
      return drawPet(art, art.body, f === 0 ? open : closed, IDLE[0]!);
    case 'listen':
      return drawPet(art, glanceAside(art.body), open, pose(IDLE[0]!, { squash: f, sparkle: -1 }));
    case 'think': {
      // Eyes roll up: the eye row turns ink and the lower eye row takes the face colour.
      const up: ColorMap = { ...open, w: INK, e: INK, E: art.asleep?.w ?? open.b };
      const out = drawPet(art, art.body, up, pose(IDLE[f % 2 === 0 ? 0 : 2]!, { sparkle: -1 }));
      THOUGHT_DOTS.slice(0, Math.min(f + 1, THOUGHT_DOTS.length)).forEach(([x, y]) => {
        out.plot(x, y, INK);
        out.plot(x + 1, y, INK);
        out.plot(x, y + 1, INK);
        out.plot(x + 1, y + 1, INK);
      });
      return out;
    }
    case 'talk':
      return drawPet(
        art,
        f % 2 === 1 ? openMouth(art.body, art.mouth) : art.body,
        { ...open, [MOUTH_KEY]: MOUTH },
        IDLE[f]!,
      );
    case 'happy': {
      const blush = open.k ? withAlpha(open.k, 255) : open.k;
      return drawPet(art, art.body, { ...closed, k: blush }, HOP[2 + f]!);
    }
    case 'sleep':
      return drawPet(art, art.body, closed, SLEEP[f]!);
    case 'eat': {
      // munch: the mouth opens on a cookie held to it, then chews with happy eyes (the cookie bitten)
      const p = pose(IDLE[0]!, { squash: f === 0 ? 1 : 0, sparkle: -1 });
      const body = f === 0 ? openMouth(art.body, art.mouth) : art.body;
      const out = drawPet(art, body, f === 0 ? { ...open, [MOUTH_KEY]: MOUTH } : closed, p);
      const mouth = mouthCell(art);
      if (mouth) {
        const x = petBodyOrigin(art.body, p)[0] + mouth[0];
        const y = petRowY(art, art.body, p, mouth[1]);
        // in front of the mouth, keeping a pixel of air at the frame's left edge
        out.blit(snack(f === 1), Math.max(0, x - 5), y - 2);
      }
      return out;
    }
    case 'cast': {
      // a little spell: a hop with both paws raised beside the face and a sparkle that grows into a star
      const p = pose(HOP[2 + f]!, { sparkle: -1 });
      const out = drawPet(art, art.body, f === 0 ? open : closed, p);
      const [x0] = petBodyOrigin(art.body, p);
      const row = Math.max(
        0,
        art.body.findIndex((r) => r.includes('e')),
      );
      const cells = [...art.body[row]!].flatMap((ch, x) => (ch === '.' || ch === ' ' ? [] : [x]));
      const left = x0 + Math.min(...cells);
      const right = x0 + Math.max(...cells);
      const y = petRowY(art, art.body, p, row) - 1 - f;
      const paw = pawCanvas(open);
      out.blit(paw, Math.max(1, left - 4), Math.max(1, y - 1));
      out.blit(paw, Math.min(PET_FRAME - 5, right + 1), Math.max(1, y - 1));
      // the sparkle over the front paw grows into a star in place
      const sx = Math.max(3, left - 2);
      const sy = Math.max(3, y - 3);
      if (f === 0) drawSparkle(out, sx, sy, true);
      else drawStar(out, sx, sy);
      return out;
    }
  }
}

const SNACK = { c: hex('#f6c98e'), C: hex('#9b6046') };

/** A round cookie with chocolate chips (4x4, outlined); `bitten` takes a bite out of its mouth side. */
function snack(bitten: boolean): Canvas {
  const c = new Canvas(8, 8);
  const t = bitten ? ['.cc.', 'cCc.', 'ccc.', '.cC.'] : ['.cc.', 'cCcc', 'cccC', '.cc.'];
  t.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '.') c.set(x + 2, y + 2, SNACK[ch as 'c' | 'C']);
    }),
  );
  c.outline(INK, { tint: inkFor });
  if (bitten) c.set(5, 7, SNACK.c); // a crumb
  return c;
}

/** A small raised paw in the pet's own colour (2x2, outlined). */
function pawCanvas(colors: ColorMap): Canvas {
  const c = new Canvas(4, 4);
  const fill = colors.l ?? colors.b!;
  c.set(1, 1, fill);
  c.set(2, 1, fill);
  c.set(1, 2, colors.b!);
  c.set(2, 2, colors.b!);
  c.outline(INK, { tint: inkFor });
  return c;
}

/** The cast's star: a white core with golden arms. */
function drawStar(c: Canvas, x: number, y: number): void {
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const)
    c.set(x + dx, y + dy, SPARKLE.core);
  for (const [dx, dy] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ] as const)
    c.set(x + dx, y + dy, SPARKLE.gold);
  for (const [dx, dy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const)
    c.plot(x + dx, y + dy, SPARKLE.pink);
}

/** The template cell (x, y) where the companion opens its mouth (see `openMouth`). */
function mouthCell(art: PetArt): [number, number] | undefined {
  const anchor = art.mouth ?? { key: 'n' };
  const y = art.body.findIndex((row) => row.includes(anchor.key));
  if (y < 0) return undefined;
  return [art.body[y]!.indexOf(anchor.key) + (anchor.dx ?? 0), y + (anchor.dy ?? 0)];
}

/** The companion sheet: one row of 26 frames facing left (see COMPANION_EXPRESSIONS). */
export function renderCompanionImage(species: PetSpecies, tint: PetTint = 'base'): Canvas {
  const sheet = new Canvas(COMPANION_COLUMNS * COMPANION_FRAME, COMPANION_FRAME);
  for (const expr of Object.keys(COMPANION_EXPRESSIONS) as CompanionExpression[]) {
    const def = COMPANION_EXPRESSIONS[expr];
    for (let i = 0; i < def.frames; i++) {
      sheet.blit(renderCompanionFrame(species, expr, i, tint), (def.start + i) * COMPANION_FRAME, 0);
    }
  }
  return sheet;
}
