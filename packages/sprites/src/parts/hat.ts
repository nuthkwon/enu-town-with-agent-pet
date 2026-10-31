import { Canvas } from '../draw/canvas';
import type { RGBA } from '../draw/color';
import { type Template, stamp } from '../draw/template';
import { INK, inkFor } from '../palette';
import type { ViewDir } from './avatar-body';

/**
 * The pointy wizard hat (ADR 0008), drawn over the hair. A 32 px frame has no room for a tall cone above a chibi
 * head (the walk's air frames lift the body 3 px and row 0 must stay empty), so the cone is short, leans back and
 * its tip curls over to the side; the brim's ends dip a pixel so it sits round on the head. H hat (outfit dark),
 * D hat shade, L hat light (outfit base), r band (accent), R band shade. Front: the tip curls to the character's
 * left; back: the same side seen from behind; side: backwards.
 *
 * `HAT_TOP` is the first template row (y, grounded, no squash); `brim` is the template row where the brim starts:
 * hair above it (spikes, buns, ties) is hidden under the hat, hair below it shows.
 */
export const HAT_TOP = 5;

export interface HatArt {
  t: Template;
  /** x of the template's first column. */
  x: number;
  /** Template row of the brim's top. */
  brim: number;
}

const HAT_DOWN: HatArt = {
  t: [
    '...........LHHH.....',
    '..........LHHHHD....',
    '.........LHHHD..D...',
    '.........LHHHD......',
    '........LHHHHHD.....',
    '.......LHHHHHHD.....',
    '......rrrrrrrrR.....',
    '...LLLLHHHHHHHHHD...',
    '..L..............D..',
  ],
  x: 6,
  brim: 7,
};

const HAT_SIDE: HatArt = {
  t: [
    '............LHHH....',
    '...........LHHHHD...',
    '..........LHHHD..D..',
    '..........LHHHD.....',
    '.........LHHHHHD....',
    '........LHHHHHHD....',
    '.......rrrrrrrrR....',
    '..LLLLLHHHHHHHHHD...',
    '.L...............D..',
  ],
  x: 6,
  brim: 7,
};

const HAT_UP: HatArt = {
  t: [
    '.....LHHH...........',
    '....LHHHHD..........',
    '...H..LHHHD.........',
    '......LHHHD.........',
    '.....LHHHHHD........',
    '.....LHHHHHHD.......',
    '.....Rrrrrrrrr......',
    '...LLLLHHHHHHHHHD...',
    '..L..............D..',
  ],
  x: 6,
  brim: 7,
};

export const HAT_ART: Record<ViewDir, HatArt> = { down: HAT_DOWN, left: HAT_SIDE, up: HAT_UP };

export interface HatColors {
  hat: RGBA;
  shade: RGBA;
  light: RGBA;
  band: RGBA;
  bandShade: RGBA;
}

/** First row (frame y) that the hat covers with its brim, for a given upper-body offset. */
export function hatBrimY(view: ViewDir, dy: number): number {
  return HAT_TOP + HAT_ART[view].brim + dy;
}

/** The hat on its own transparent canvas, outlined, ready to composite over the outlined figure. */
export function renderHat(view: ViewDir, k: HatColors, dy: number): Canvas {
  const art = HAT_ART[view];
  const c = new Canvas(32, 32);
  stamp(c, art.t, art.x, HAT_TOP + dy, {
    H: k.hat,
    D: k.shade,
    L: k.light,
    r: k.band,
    R: k.bandShade,
  });
  c.outline(INK, { tint: inkFor });
  return c;
}
