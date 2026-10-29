import type { Canvas } from '../draw/canvas';
import { type Template, stamp, templateWidth } from '../draw/template';
import { WING } from '../palette';

/**
 * Translucent fairy wings, drawn for the screen-right side (mirrored for the left one).
 * e edge, f upper fill, g lower fill, w shine. The wing root is the first column of `rootRow`.
 */
interface WingArt {
  t: Template;
  rootRow: number;
}

/* Avatar wings (butterfly-like). */
const WING_OPEN: WingArt = {
  t: [
    '.....eee.',
    '...eeffwe',
    '..efffwwe',
    '.effffffe',
    '.efffffe.',
    'effffffe.',
    'efffffe..',
    'eeeeee...',
    'eggggge..',
    'egggge...',
    '.eeee....',
  ],
  rootRow: 7,
};
const WING_UP: WingArt = {
  t: [
    '...ee....',
    '..efwe...',
    '..effwe..',
    '.efffwe..',
    '.effffe..',
    'efffffe..',
    'effffe...',
    'eeeee....',
    'egge.....',
    'eggge....',
    '.eee.....',
  ],
  rootRow: 7,
};

/* Pet wings: the near wing fans out up-right, the far wing stands up behind it. */
const PET_WING_OPEN: WingArt = {
  t: ['....ee.', '..eefwe', '.efffwe', 'effffe.', 'efffe..', 'eeee...', 'eggge..', '.egge..', '..ee...'],
  rootRow: 5,
};
const PET_WING_UP: WingArt = {
  t: ['..ee...', '.efwe..', '.efwe..', 'efffe..', 'efffe..', 'effe...', 'eee....', 'egge...', '.ee....'],
  rootRow: 6,
};
const PET_WING_FAR_OPEN: WingArt = {
  t: ['.ee..', 'efwe.', 'effe.', 'effe.', 'efe..', 'ee...'],
  rootRow: 5,
};
const PET_WING_FAR_UP: WingArt = {
  t: ['.e...', 'efe..', 'efe..', 'efe..', 'efe..', 'ee...'],
  rootRow: 5,
};
const PET_WING_FOLDED: WingArt = {
  t: ['.ee..', 'effe.', 'efwfe', 'effe.', 'eee..', 'egge.', '.ee..'],
  rootRow: 4,
};

const COLORS = { e: WING.edge, f: WING.fill, g: WING.fill2, w: WING.shine };

function draw(c: Canvas, art: WingArt, x: number, y: number, side: 'left' | 'right'): void {
  const top = y - art.rootRow;
  if (side === 'right') stamp(c, art.t, x, top, COLORS);
  else stamp(c, art.t, x - templateWidth(art.t) + 1, top, COLORS, { flipX: true });
}

/** Avatar wing whose root (inner edge) is at (x, y). */
export function drawWing(c: Canvas, x: number, y: number, side: 'left' | 'right', phase: number): void {
  draw(c, phase ? WING_UP : WING_OPEN, x, y, side);
}

/** Pet wing whose root is at (x, y); `far` draws the slimmer wing behind. */
export function drawPetWing(
  c: Canvas,
  x: number,
  y: number,
  side: 'left' | 'right',
  phase: 'open' | 'up' | 'folded',
  far = false,
): void {
  if (phase === 'folded') draw(c, PET_WING_FOLDED, x, y, side);
  else if (far) draw(c, phase === 'open' ? PET_WING_FAR_OPEN : PET_WING_FAR_UP, x, y, side);
  else draw(c, phase === 'open' ? PET_WING_OPEN : PET_WING_UP, x, y, side);
}
