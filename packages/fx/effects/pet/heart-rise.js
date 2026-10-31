// Adapted from pixelfx status/charmed (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The shaded, outlined hearts are
// adapted from Sprite Fusion's open-source heal (https://www.spritefusion.com/pixel-art-vfx/heal),
// MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, HEART, WHITE, ease, fit, rng } from '../_core.js';
import { bitmap, icon } from '../_lib/status.js';

export const meta = {
  den: { surface: 'pet', from: 'status/charmed', stand: 'companion', depth: 'over' },
  name: 'Familiar heart rise',
  desc: 'A reply arrives: little outlined hearts pop out round the familiar on a soft lub-dub beat, float up swaying, give one more beat on the way and shrink into twinkles; 1.2 s.',
  tags: ['pet', 'familiar', 'reply', 'hearts', 'love', 'float', 'one-shot'],
  size: [32, 40],
  origin: [16, 36],
  duration: 1.2,
  loop: false,
  fps: 15,
  bg: 'ground',
  options: { palette: DEN.pink, seed: 8 },
};

// three sizes of heart: a pip, a small one and the house heart; a bigger one for the beat
const H3 = bitmap(['#.#', '###', '.#.']);
const H5 = bitmap(['.#.#.', '#####', '#####', '.###.', '..#..']);
const H7 = bitmap(HEART);
const H9 = bitmap([
  '.###.###.',
  '#########',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
]);

// [birth, x, y, rise, drift, big]: two beats (lub, dub); they start above the head or by the wing, never on
// the face; the first ones lean outward as they rise, making room for the second
const HEARTS = [
  [0.0, -6, -20, 12, -4, true],
  [0.04, 6, -19, 11, 3, false],
  [0.08, 0, -24, 8, 0, false],
  [0.3, 9, -12, 12, -2, true],
  [0.34, -10, -17, 11, 2, false],
];
const LIFE = 0.84;

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  HEARTS.forEach(([t0, x0, y0, rise, drift, big], i) => {
    const a = t - t0;
    if (a < 0 || a >= LIFE) return;
    const r = rng(o.seed, i);
    const u = a / LIFE;
    const x = x0 + drift * ease.outQuad(u) + 1.2 * Math.sin(a * 6.5 + r.range(0, 6.28)) * Math.min(1, a * 4);
    const y = y0 - rise * ease.outSine(u);
    // it pops in through a beat, beats once more on the way up, and shrinks to a pip and a twinkle
    let shape = big ? H7 : H5;
    if (a < 0.07) shape = H3;
    else if (a < 0.14 || Math.abs(a - 0.5) < 0.034) shape = big ? H9 : H7;
    if (u > 0.82) shape = H3;
    if (u > 0.92) {
      p.px(x, y, C[5]);
      p.px(x - 1, y, C[4]);
      p.px(x + 1, y, C[4]);
      p.px(x, y - 1, C[4]);
      p.px(x, y + 1, C[4]);
      p.px(x, y, WHITE);
      return;
    }
    const R = u > 0.7 ? [C[2], C[3], C[4], C[5]] : [C[1], C[2], C[3], C[4]];
    icon(p, x, y, 5, shape, R);
    // a glint on the left lobe
    if (shape === H7 || shape === H9)
      p.px(Math.round(x) - (shape === H9 ? 3 : 2), Math.round(y) - (shape === H9 ? 3 : 2), C[6]);
    p.glow(x, y, 7, C[3], 0.15);
  });
}
