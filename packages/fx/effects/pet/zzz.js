// Adapted from pixelfx status/sleep (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The shaded, outlined letters are
// adapted from Sprite Fusion's open-source heal (https://www.spritefusion.com/pixel-art-vfx/heal),
// MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, cycle, ease, fit } from '../_core.js';

export const meta = {
  den: { surface: 'pet', from: 'status/sleep', stand: 'companion', depth: 'over' },
  name: 'Familiar zzz',
  desc: 'The familiar is asleep: soft outlined Z shapes float up off its head one after another, swaying and growing a step at a time as they rise, then pop into a puff; seamless 2.4 s loop.',
  tags: ['pet', 'familiar', 'sleep', 'zzz', 'rest', 'loop'],
  size: [24, 32],
  origin: [6, 28],
  duration: 2.4,
  loop: true,
  fps: 10,
  bg: 'ground',
  options: { palette: DEN.lavender, seed: 3 },
};

const D = meta.duration;
const NZ = 3;
const LIFE = 1.2;
// the shape at three sizes, drawn as pixels (not a font): it grows a step at a time as it rises
const ZS = [
  ['####', '..#.', '.#..', '####'],
  ['#####', '...#.', '..#..', '.#...', '#####'],
  ['######', '....#.', '...#..', '..#...', '.#....', '######'],
];

// a Z centred on (x, y): a crisp body with a soft shadow a pixel down and right, a lit top bar
function zee(p, rows, x, y, body, shadow, top, a) {
  const X = Math.round(x - rows[0].length / 2);
  const Y = Math.round(y - rows.length / 2);
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === '#') p.dot(X + c + 1, Y + r + 1, shadow, a);
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++)
      if (rows[r][c] === '#') p.dot(X + c, Y + r, r === 0 ? top : body, a);
}

// where Z i is at age u (0..1): off the top of the head, drifting up and right, swaying
function zAt(i, u) {
  const x = 4 + 8 * u + 1.2 * Math.sin(TAU * 1.1 * u + i * 2.1);
  const y = -17 - 7 * ease.outQuad(u);
  const size = u < 0.28 ? 0 : u < 0.58 ? 1 : 2;
  return { x, y, size };
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  // tiny dream motes drifting up beside the Zs
  cycle(
    t,
    D,
    4,
    o.seed + 4,
    (r) => r.range(1.2, 1.8),
    (age, life, r) => {
      const u = age / life;
      const x = r.range(-2, 12) + Math.sin(age * 3 + r.next() * TAU) * 1.2;
      const y = -13 - r.range(0, 4) - age * r.range(6, 9);
      const k = Math.sin(Math.PI * u);
      if (k > 0.3) p.px(x, y, k > 0.75 ? C[5] : C[4]);
    },
  );
  // the Zs, one born every D / NZ, each living LIFE
  for (let i = 0; i < NZ; i++) {
    const age = (((t - (i * D) / NZ) % D) + D) % D;
    if (age >= LIFE) continue;
    const u = age / LIFE;
    const z = zAt(i, u);
    if (u > 0.86) {
      // it pops into a little puff
      const k = (u - 0.86) / 0.14;
      for (let j = 0; j < 4; j++) {
        const an = (j / 4) * TAU + Math.PI / 4;
        const d = 2 + 3 * k;
        p.px(z.x + Math.cos(an) * d, z.y + Math.sin(an) * d, k < 0.5 ? C[4] : C[3]);
      }
      continue;
    }
    const k = Math.min(1, u / 0.08);
    // it pales as it gets old
    if (u > 0.7) zee(p, ZS[z.size], z.x, z.y, C[3], C[5], C[4], k);
    else zee(p, ZS[z.size], z.x, z.y, C[2], C[4], C[3], k);
    p.glow(z.x, z.y, 4 + z.size, C[4], 0.1 * k);
  }
}
