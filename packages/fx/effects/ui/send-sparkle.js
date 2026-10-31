import { DEN, TAU, WHITE, burst, ease, fit, seg } from '../_core.js';

export const meta = {
  name: 'Send sparkle',
  desc: 'A message leaves: a lavender four-point sparkle snaps open at the send button and shrinks away while a thin pink ring flicks out and a few motes fly off, twinkle and wink out. Lavender and pink, 0.45 s.',
  tags: ['ui', 'messenger', 'send', 'sparkle', 'one-shot'],
  size: [32, 32],
  origin: [16, 16],
  duration: 0.45,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.lavender, accent: DEN.pink, seed: 2 },
  den: { surface: 'ui', stand: 'none', anchor: 'free', depth: 'over' },
};

/** Draw the shape `inside` with a 1 px rim and `fill` inside. */
function blob(p, x0, y0, x1, y1, inside, fill, rim) {
  p.shade(x0, y0, x1, y1, (x, y) => {
    if (!inside(x, y)) return 0;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return rim;
    return fill(x, y);
  });
}

// a four-point star with concave sides: long points on the axes (the side ones a little shorter), a plump
// heart, a white core and pink tips
function star4(p, C, A, x, y, L, pink) {
  if (L < 1.5) {
    if (L > 0.5) p.px(x, y, pink ? A[2] : C[3]);
    return;
  }
  const Lx = L * 0.8;
  const v = (px, py) => Math.pow(Math.abs(px - x) / Lx, 0.5) + Math.pow(Math.abs(py - y) / L, 0.5);
  // a concave heart, and 1 px needles running on to the tips
  const inside = (px, py) =>
    v(px, py) <= 1 ||
    (Math.abs(px - x) < 0.5 && Math.abs(py - y) <= L) ||
    (Math.abs(py - y) < 0.5 && Math.abs(px - x) <= Lx);
  const fill = (px, py) => {
    const d = v(px, py);
    return d < 0.4 ? WHITE : d < 0.6 ? (pink ? A[4] : C[4]) : pink ? A[3] : C[3];
  };
  blob(p, x - Lx - 1, y - L - 1, x + Lx + 1, y + L + 1, inside, fill, pink ? A[2] : C[2]);
}

// the motes' headings in degrees (y down), between the sparkle's four points; the upper right is the twin's
const MOTES = [25, 65, 115, 155, 205, 245];

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const A = fit(o.accent, 7);
  const seed = o.seed;

  // the sparkle: already open on the first frame, biggest on the second, then shrinking back to a point
  const L = t < 0.05 ? 6 : 10.5 * (1 - ease.inQuad(seg(t, 0.05, 0.32)));
  // centred on a pixel, so each point is a single pixel wide at its tip
  if (t < 0.32) star4(p, C, A, 0.5, 0.5, L, false);
  p.glow(0.5, 0.5, 10, C[4], 0.3 * (1 - seg(t, 0.05, 0.3)));
  // a little pink twin pops beside it
  const tw = seg(t, 0.07, 0.27);
  if (tw > 0 && tw < 1) star4(p, C, A, 7.5, -6.5, 4.5 * Math.sin(tw * Math.PI), true);

  // motes flying out between the points, slowing, then twinkling and winking out
  burst(6, seed, (r, i) => {
    const a = (MOTES[i] / 360) * TAU + r.range(-0.08, 0.08); // between the points, never along them
    const t0 = r.range(0, 0.02);
    const life = r.range(0.33, 0.4);
    const u = (t - t0) / life;
    if (u < 0 || u >= 1) return;
    const reach = i % 2 ? r.range(9, 10.5) : r.range(6, 8);
    const d = 4 + reach * ease.outQuart(u);
    const x = 0.5 + Math.cos(a) * d;
    const y = 0.5 + Math.sin(a) * d;
    const col = i % 2 ? A[2] : C[2];
    if (u < 0.25) {
      const db = 4 + reach * ease.outQuart(Math.max(0, u - 0.08));
      p.line(0.5 + Math.cos(a) * db, 0.5 + Math.sin(a) * db, x, y, i % 2 ? A[3] : C[3]);
      p.px(x, y, col);
    } else if (u < 0.7) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.px(x + dx, y + dy, col);
      p.px(x, y, i % 2 ? A[4] : C[4]);
    } else if (Math.round(t * 20 + i) % 2) p.px(x, y, col);
  });
}
