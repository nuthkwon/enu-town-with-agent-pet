// Adapted from pixelfx pickups/heart-pickup (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The hover, floor shadow and glints follow Sprite Fusion's open-source pickup
// (https://www.spritefusion.com/pixel-art-vfx/pickup), MIT License, Copyright (c) 2026 Hugo Duprez.
// The shaded, outlined hearts are adapted from Sprite Fusion's open-source heal
// (https://www.spritefusion.com/pixel-art-vfx/heal), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, WHITE, fit, seg } from '../_core.js';
import { twinkle } from '../_lib/pickups.js';
import { bitmap, icon } from '../_lib/status.js';

export const meta = {
  den: { surface: 'pet', from: 'pickups/heart-pickup', stand: 'companion', depth: 'over' },
  name: 'Familiar pat heart',
  desc: "A pat: one plump heart pops up out of the familiar's head, stretching as it rises and squashing as it stops, two tiny hearts drift off it, and it breathes in and shrinks away into a twinkle; 0.8 s.",
  tags: ['pet', 'familiar', 'pat', 'heart', 'love', 'pop', 'one-shot'],
  size: [24, 32],
  origin: [12, 28],
  duration: 0.8,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.pink, seed: 4 },
};

const HX = -2;
const HY = -21;
// hand-drawn squash and stretch: each shape with its glossy highlight ([dx, dy, step] from its middle)
const SHAPE = {
  pip: { rows: ['#.#', '###', '.#.'], gloss: [] },
  small: { rows: ['.#.#.', '#####', '#####', '.###.', '..#..'], gloss: [[-1, -1, 5]] },
  stretch: {
    rows: ['.##.##.', '#######', '#######', '#######', '.#####.', '.#####.', '..###..', '...#...'],
    gloss: [
      [-2, -3, 6],
      [-2, -2, 5],
    ],
  },
  squash: {
    rows: ['.####.####.', '###########', '###########', '.#########.', '...#####...', '.....#.....'],
    gloss: [
      [-4, -2, 6],
      [-3, -2, 5],
    ],
  },
  round: {
    rows: [
      '.###.###.',
      '#########',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
      '...###...',
      '....#....',
    ],
    gloss: [
      [-3, -3, 6],
      [-2, -3, 5],
      [-3, -2, 5],
    ],
  },
};
for (const s of Object.values(SHAPE)) s.inside = bitmap(s.rows);

// one [shape, lift] per frame (20 fps): out of the head as a pip, stretched as it shoots up, squashed as it
// stops, round with a little bob; a breath in (squash), a hop (stretch), and it shrinks away
const SEQ = [
  ['pip', 3],
  ['stretch', 0],
  ['squash', -1],
  ['round', -2],
  ['round', -1],
  ['round', -1],
  ['round', -2],
  ['round', -2],
  ['round', -1],
  ['round', -1],
  ['squash', 0],
  ['stretch', -2],
  ['small', -2],
  ['pip', -2],
];
const MINI = ['.a.a.', 'abbba', '.aba.', '..a..'];

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  // two tiny hearts drift off it, wobbling, and blink out
  for (const [side, t0] of [
    [-1, 0.14],
    [1, 0.22],
  ]) {
    const age = t - t0;
    if (age < 0 || age > 0.4) continue;
    const k = age / 0.4;
    const x = HX + side * (3 + age * (side < 0 ? 9 : 14)) + Math.sin(age * 16 + side);
    const y = HY - 1 - age * 7;
    if (k > 0.8 && Math.floor(t * 20) % 2) continue;
    p.sprite(
      MINI,
      { a: k < 0.5 ? C[2] : C[3], b: k < 0.3 ? WHITE : C[4] },
      Math.round(x - 2.5),
      Math.round(y - 2),
    );
  }
  // the plump heart
  const step = SEQ[Math.floor(t * meta.fps + 0.5)];
  if (step) {
    const [name, lift] = step;
    const s = SHAPE[name];
    const x = HX;
    const y = Math.round(HY + lift);
    icon(p, x, y, 6, s.inside, [C[1], C[2], C[3], C[4]]);
    for (const [dx, dy, c] of s.gloss) p.px(x + dx, y + dy, C[c]);
    p.glow(x, y, 9, C[3], 0.2);
  }
  // it goes out with a twinkle
  const q = seg(t, 0.68, 0.78);
  if (q > 0 && q < 1) {
    twinkle(p, HX, HY - 2, 1 + 2 * Math.sin(Math.PI * q), C[3], C[4]);
    p.glow(HX, HY - 2, 6, C[3], 0.25 * Math.sin(Math.PI * q));
  }
}
