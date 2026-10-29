import type { PetSpecies, PetTint } from '@enu/shared';
import { Canvas } from './draw/canvas';
import { hex, withAlpha } from './draw/color';
import type { ColorMap } from './draw/template';
import { INK } from './palette';
import { MOUTH_KEY, glanceAside, openMouth } from './parts/faces';
import { PET_ART } from './parts/pets';
import { PET_POSES, drawPet, petFrameColors, type PetPose } from './pet';
import { COMPANION_COLUMNS, COMPANION_EXPRESSIONS, COMPANION_FRAME, type CompanionExpression } from './spec';

/**
 * The companion: the same fairy pet as in the town, with expressions for the pet room header (listening while the
 * owner types, thinking while a reply is pending, talking when one arrives, happy, asleep). It only ever reacts to
 * the owner's own room; nothing here is shown to colleagues as a live state.
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
  }
}

/** The companion sheet: one row of 22 frames facing left (see COMPANION_EXPRESSIONS). */
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
