import type { PetSpecies } from '@enu/shared';
import { Canvas } from './draw/canvas';
import { type ColorMap, stamp, templateWidth } from './draw/template';
import { INK, SPARKLE, inkFor } from './palette';
import { PET_ART } from './parts/pets';
import { drawPetWing } from './parts/wings';
import { PET_ANIMS, PET_COLUMNS, PET_DIRECTIONS, PET_FRAME, type PetAnim, type PetDirection } from './spec';

interface PetPose {
  /** Lowest body row (fill, before outline). */
  bottom: number;
  /** +1 squash, -1 stretch. */
  squash: number;
  wing: 'open' | 'up' | 'folded';
  sleep: boolean;
  /** Sparkle position index (-1 = none). */
  sparkle: number;
}

const IDLE: readonly PetPose[] = [
  { bottom: 18, squash: 0, wing: 'open', sleep: false, sparkle: 0 },
  { bottom: 17, squash: 0, wing: 'up', sleep: false, sparkle: 1 },
  { bottom: 16, squash: 0, wing: 'open', sleep: false, sparkle: 2 },
  { bottom: 17, squash: 0, wing: 'up', sleep: false, sparkle: 3 },
];
const HOP: readonly PetPose[] = [
  { bottom: 20, squash: 1, wing: 'up', sleep: false, sparkle: 0 },
  { bottom: 19, squash: -1, wing: 'open', sleep: false, sparkle: 1 },
  { bottom: 16, squash: 0, wing: 'up', sleep: false, sparkle: 2 },
  { bottom: 15, squash: 0, wing: 'open', sleep: false, sparkle: 3 },
  { bottom: 16, squash: 0, wing: 'up', sleep: false, sparkle: 0 },
  { bottom: 18, squash: 0, wing: 'open', sleep: false, sparkle: 1 },
];
const SLEEP: readonly PetPose[] = [
  { bottom: 21, squash: 0, wing: 'folded', sleep: true, sparkle: -1 },
  { bottom: 21, squash: 1, wing: 'folded', sleep: true, sparkle: -1 },
];
const POSES: Record<PetAnim, readonly PetPose[]> = { idle: IDLE, hop: HOP, sleep: SLEEP };

/** Removes (squash) or duplicates (stretch) one row; everything above it moves. */
function bend(c: Canvas, row: number, amount: number): Canvas {
  if (!amount) return c;
  const out = new Canvas(c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      let sy: number;
      if (amount > 0)
        sy = y > row ? y : y - 1; // rows <= row come from one above (drop by 1)
      else sy = y >= row ? y : y + 1; // rows < row come from one below (rise by 1)
      out.set(x, y, c.get(x, sy));
    }
  }
  return out;
}

const SPARKLE_SPOTS: readonly [number, number][] = [
  [20, 4],
  [3, 3],
  [21, 10],
  [17, 2],
];

function drawSparkle(c: Canvas, x: number, y: number, big: boolean): void {
  c.plot(x, y, SPARKLE.core);
  const arm = big ? SPARKLE.gold : SPARKLE.pink;
  c.plot(x - 1, y, arm);
  c.plot(x + 1, y, arm);
  c.plot(x, y - 1, arm);
  c.plot(x, y + 1, arm);
}

/** One 24x24 pet frame (pure). */
export function renderPetFrame(species: PetSpecies, dir: PetDirection, anim: PetAnim, i: number): Canvas {
  const art = PET_ART[species];
  const poses = POSES[anim];
  const pose = poses[i % poses.length]!;
  const w = templateWidth(art.body);
  const h = art.body.length;
  const x0 = Math.floor((PET_FRAME - w) / 2) - 1;
  const y0 = pose.bottom - h + 1;

  const colors: ColorMap = pose.sleep
    ? { ...art.colors, w: art.colors.b, e: art.colors.b, E: INK }
    : art.colors;
  let body = new Canvas(PET_FRAME, PET_FRAME);
  stamp(body, art.body, x0, y0, colors);
  body = bend(body, y0 + art.bendRow, pose.squash);
  body.outline(INK, { tint: inkFor });

  const wingY = y0 + art.wingAt[1] + (pose.squash > 0 ? 1 : 0);
  const wingX = x0 + art.wingAt[0];
  const wings = new Canvas(PET_FRAME, PET_FRAME);
  if (pose.wing !== 'folded') drawPetWing(wings, wingX - 3, wingY - 1, 'right', pose.wing, true);
  drawPetWing(wings, wingX + 1, wingY, 'right', pose.wing);

  const out = new Canvas(PET_FRAME, PET_FRAME);
  out.blit(wings, 0, 0);
  out.blit(body, 0, 0);
  if (pose.sparkle >= 0) {
    const [sx, sy] = SPARKLE_SPOTS[pose.sparkle]!;
    drawSparkle(out, sx, sy, pose.sparkle % 2 === 0);
  }
  return dir === 'right' ? out.flipX() : out;
}

/**
 * Full pet sheet as RGBA pixels: 12 columns (idle 4, hop 6, sleep 2) x 2 rows (left, right).
 * `sleeping: false` leaves the two sleep cells empty (layout never changes).
 */
export function renderPetImage(species: PetSpecies, opts: { sleeping?: boolean } = {}): Canvas {
  const sheet = new Canvas(PET_COLUMNS * PET_FRAME, PET_DIRECTIONS.length * PET_FRAME);
  PET_DIRECTIONS.forEach((dir, row) => {
    for (const anim of Object.keys(PET_ANIMS) as PetAnim[]) {
      if (anim === 'sleep' && opts.sleeping === false) continue;
      const def = PET_ANIMS[anim];
      for (let i = 0; i < def.frames; i++) {
        sheet.blit(renderPetFrame(species, dir, anim, i), (def.start + i) * PET_FRAME, row * PET_FRAME);
      }
    }
  });
  return sheet;
}
