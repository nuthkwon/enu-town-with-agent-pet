// Shown while someone is on a break (휴식): mana coming back. A few soft sky motes rise lazily beside the person,
// drifting a little outward so they never cross the face, and each ends in a tiny "+" wink; two stray glints
// wink near the shoulders. Very quiet. Every particle repeats once a loop (cycle), so the loop has no seam.
import { DEN, TAU, WHITE, cycle, ease, fit } from '../_core.js';

export const meta = {
  name: 'Mana rest',
  desc: 'A break: a few soft sky-blue motes drift lazily up beside the person and wink out as tiny plus glints; very quiet, 2.4 s loop.',
  tags: ['aura', 'break', 'rest', 'mana', 'motes', 'status', 'loop'],
  size: [32, 40],
  origin: [16, 36],
  duration: 2.4,
  loop: true,
  fps: 12,
  bg: 'ground',
  options: { palette: DEN.sky, seed: 5 },
  den: { surface: 'town', anchor: 'feet', depth: 'over' },
};

/** A tiny plus: a white heart, arms of one pixel. */
function plus(p, x, y, c) {
  const X = Math.round(x);
  const Y = Math.round(y);
  p.px(X, Y, WHITE);
  p.px(X + 1, Y, c);
  p.px(X - 1, Y, c);
  p.px(X, Y + 1, c);
  p.px(X, Y - 1, c);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const D = meta.duration;
  // the motes: born beside the body at waist height, rising and slowing as they drift outward clear of the head,
  // swaying a little, then a wink. Round and soft, with no trail under them (that would read as a sweat drop).
  cycle(
    t,
    D,
    6,
    o.seed,
    (g) => g.range(1.6, 2.2),
    (age, life, r, i) => {
      const side = i % 2 ? 1 : -1;
      const x0 = side * r.range(8.5, 10.5);
      const y0 = r.range(-11, -2);
      const rise = r.range(12, 17);
      const ph = r.range(0, TAU);
      const k = age / life;
      const x = x0 + side * ease.inOutSine(k) * 3 + Math.sin(age * 2.6 + ph) * 0.7;
      const y = y0 - rise * ease.outSine(k);
      if (k > 0.86) {
        // it winks out as a tiny plus
        if (k < 0.97) plus(p, x, y, C[3]);
        return;
      }
      if (k < 0.12) return p.blend(x, y, C[2], 0.6);
      const tw = Math.sin(age * 5 + ph) > 0.3;
      p.px(x, y, tw ? C[5] : C[4]);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.blend(x + dx, y + dy, C[2], 0.4);
    },
  );
  // two stray glints near the shoulders, winking at their own times
  cycle(t, D, 2, o.seed + 7, 0.3, (age, life, r, i) => {
    const x = (i ? 1 : -1) * r.range(11, 13);
    const y = r.range(-22, -15);
    if (age < life * 0.25 || age > life * 0.75) p.px(x, y, C[3]);
    else plus(p, x, y, C[3]);
  });
}
