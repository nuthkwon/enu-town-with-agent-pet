import type { Canvas } from '../draw/canvas';
import { hex } from '../draw/color';

/**
 * A short wooden wand with a glowing tip, held in the hand at `grip` and pointing at `tip` (frame pixels).
 * The wand is one pixel wide and has no ink outline (a thin outlined stick reads as a dark scribble at 1x).
 */
export const WAND = {
  wood: hex('#5e3a2e'),
  woodLight: hex('#9a6744'),
  glow: hex('#fff3b0'),
  core: hex('#ffffff'),
  gold: hex('#ffe170'),
  pink: hex('#ffb8e0'),
  halo: hex('#fff3b0', 120),
};

function linePixels(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** The wooden shaft between the hand and the tip (the hand stays skin; the pixel next to the tip is lighter). */
export function drawWandShaft(
  c: Canvas,
  grip: readonly [number, number],
  tip: readonly [number, number],
): void {
  const px = linePixels(grip[0], grip[1], tip[0], tip[1]);
  px.slice(1, -1).forEach(([x, y], i) => c.set(x, y, i === px.length - 3 ? WAND.woodLight : WAND.wood));
}

/** The tip: a soft glow (0), a small twinkle (1), a bright twinkle (2) or the cast's white star flash (3). */
export function drawWandTip(c: Canvas, tip: readonly [number, number], level: 0 | 1 | 2 | 3): void {
  const [x, y] = tip;
  if (level === 0) {
    c.set(x, y, WAND.glow);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, -1],
    ] as const)
      c.plot(x + dx, y + dy, WAND.halo);
    return;
  }
  if (level === 1) {
    c.set(x, y, WAND.core);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      c.plot(x + dx, y + dy, WAND.halo);
    return;
  }
  if (level === 2) {
    c.set(x, y, WAND.core);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      c.set(x + dx, y + dy, WAND.gold);
    for (const [dx, dy] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ] as const)
      c.plot(x + dx, y + dy, WAND.halo);
    return;
  }
  // star flash: a white 3x3 core, white arms tipped with gold, pink diagonal glints
  for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) c.set(x + d, y + e, WAND.core);
  for (const s of [2, 3]) {
    c.set(x + s, y, s === 3 ? WAND.gold : WAND.core);
    c.set(x - s, y, s === 3 ? WAND.gold : WAND.core);
    c.set(x, y + s, s === 3 ? WAND.gold : WAND.core);
    c.set(x, y - s, s === 3 ? WAND.gold : WAND.core);
  }
  for (const [dx, dy] of [
    [2, 2],
    [-2, 2],
    [2, -2],
    [-2, -2],
  ] as const)
    c.set(x + dx, y + dy, WAND.pink);
}
