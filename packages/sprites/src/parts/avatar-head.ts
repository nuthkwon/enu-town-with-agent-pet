import type { Canvas } from '../draw/canvas';
import type { RGBA } from '../draw/color';
import { type Template, stamp } from '../draw/template';
import type { ViewDir } from './avatar-body';

/** Head skin, anchored at x = 8, y = HEAD_Y (16 columns). s skin, S shade, e ear. */
export const HEAD_Y = 9;

const HEAD_DOWN: Template = [
  '...ssssssssss...',
  '.ssssssssssssss.',
  '.ssssssssssssss.',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  '.ssssssssssssss.',
  '..ssssssssssss..',
  '....ssssssss....',
];
const HEAD_SIDE: Template = [
  '...ssssssssss...',
  '.ssssssssssssss.',
  '.ssssssssssssss.',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  '.ssssssssssssss.',
  '..sssssssssssss.',
  '....sssssssss...',
];
const HEAD_UP: Template = HEAD_DOWN;

export interface FaceColors {
  skin: RGBA;
  skinShade: RGBA;
  blush: RGBA;
  ink: RGBA;
  eye: RGBA;
  eyeLight: RGBA;
  white: RGBA;
  mouth: RGBA;
}

export function drawHead(c: Canvas, dir: ViewDir, k: FaceColors, dy: number): void {
  const t = dir === 'down' ? HEAD_DOWN : dir === 'up' ? HEAD_UP : HEAD_SIDE;
  stamp(c, t, 8, HEAD_Y + dy, { s: k.skin, S: k.skinShade });
  if (dir !== 'up') {
    // soft jaw shade
    const y = HEAD_Y + dy;
    c.plot(dir === 'down' ? 12 : 13, y + 11, k.skinShade);
    c.plot(dir === 'down' ? 19 : 20, y + 11, k.skinShade);
  }
}

/** Ears (drawn before hair so most styles can cover them). */
export function drawEars(c: Canvas, dir: ViewDir, k: FaceColors, dy: number): void {
  const y = HEAD_Y + dy + 6;
  if (dir === 'left') {
    c.rect(16, y, 2, 2, k.skinShade);
    c.plot(16, y, k.skin);
    return;
  }
  c.rect(7, y, 1, 2, k.skin);
  c.rect(24, y, 1, 2, k.skin);
}

/** Eyes, cheeks and mouth. `blink` closes the eyes (used by nothing yet but kept for pets parity). */
export function drawFace(c: Canvas, dir: ViewDir, k: FaceColors, dy: number, blink = false): void {
  if (dir === 'up') return;
  const y = HEAD_Y + dy;
  const eyes = dir === 'down' ? [11, 19] : [10];
  for (const ex of eyes) {
    if (blink) {
      c.rect(ex, y + 7, 2, 1, k.ink);
      continue;
    }
    // lash
    c.rect(ex, y + 5, 2, 1, k.ink);
    // iris
    c.set(ex, y + 6, k.white);
    c.set(ex + 1, y + 6, k.ink);
    c.set(ex, y + 7, k.ink);
    c.set(ex + 1, y + 7, k.eye);
    c.set(ex, y + 8, k.eye);
    c.set(ex + 1, y + 8, k.eyeLight);
  }
  if (dir === 'down') {
    c.plot(10, y + 9, k.blush);
    c.plot(11, y + 9, k.blush);
    c.plot(20, y + 9, k.blush);
    c.plot(21, y + 9, k.blush);
    c.set(15, y + 10, k.mouth);
    c.set(16, y + 10, k.mouth);
  } else {
    c.plot(11, y + 9, k.blush);
    c.plot(12, y + 9, k.blush);
    c.set(9, y + 10, k.mouth);
  }
}
