import { DEN, TAU, WHITE, burst, clamp, ease, fit, fly } from '../_core.js';

export const meta = {
  name: 'Bubble pop',
  desc: "My own pet's speech bubble appears: a tiny white pop, a mini pink ring and five pink and lilac sparkle pixels flicked out, all gone in a third of a second.",
  tags: ['town', 'pet', 'bubble', 'pop', 'sparkle', 'one-shot'],
  size: [24, 24],
  origin: [12, 16],
  duration: 0.35,
  loop: false,
  fps: 24,
  bg: 'ground',
  options: { palette: DEN.pink, sparks: DEN.lavender, seed: 3 },
  den: { surface: 'town', anchor: 'free', depth: 'over', stand: 'none' },
};

const CY = -4;
const PLUS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const V = fit(o.sparks, 7);

  // the pop: a white plus with pink arms for one frame
  if (t < 0.04) {
    for (const [dx, dy] of PLUS) {
      p.px(dx, CY + dy, WHITE);
      p.px(dx * 2, CY + dy * 2, C[3]);
    }
    p.px(0, CY, WHITE);
    p.glow(0.5, CY + 0.5, 7, C[4], 0.3);
  }
  // a mini ring snapping out and gone
  const u = (t - 0.03) / 0.11;
  if (u > 0 && u < 1) p.ring(0.5, CY + 0.5, 2 + 2.8 * ease.outCubic(u), 1, u < 0.4 ? WHITE : C[3], 1.3 - u);
  // five sparkle pixels flicked out past the ring, streaking while they are fast, braked hard, winking out
  // one after another (the pink ones twinkle into a little plus on the way)
  burst(5, o.seed, (r, i) => {
    const age = t - 0.03;
    const life = 0.15 + i * 0.022 + r.range(0, 0.02);
    if (age < 0 || age >= life) return;
    const a = (i / 5) * TAU - Math.PI / 2 + r.range(-0.25, 0.25);
    const sp = r.range(105, 125);
    const at = (q) =>
      fly(Math.cos(a) * 3, CY + Math.sin(a) * 3, Math.cos(a) * sp, Math.sin(a) * sp, q, 0, 12);
    const [x, y] = at(age);
    const X = Math.round(x);
    const Y = Math.round(y);
    const q = clamp(age / life);
    const c = i % 2 ? V[2] : C[2];
    if (q < 0.35) {
      const [bx, by] = at(Math.max(0, age - 0.02));
      p.line(bx, by, x, y, (v) => (v > 0.6 ? WHITE : c));
      return;
    }
    if (i % 2 === 0 && q < 0.6) for (const [dx, dy] of PLUS) p.px(X + dx, Y + dy, C[3]);
    // then a pale pixel that winks off and on before it goes, not a speck left lying there
    if (q >= 0.6 && Math.sin(age * 90 + i * 2.3) < -0.2) return;
    p.px(X, Y, q < 0.6 ? c : i % 2 ? V[3] : C[3]);
  });
}
