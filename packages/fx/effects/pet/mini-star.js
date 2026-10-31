import { DEN, TAU, WHITE, burst, ease, fit, fly } from '../_core.js';

export const meta = {
  name: 'Mini star',
  desc: 'The familiar shows a tiny star spell: three little stars streak down on trails round it, one on each side and the last onto its head, each popping with a tiny flat ring and hopping glints. Lemon ramp, 1 s.',
  tags: ['pet', 'familiar', 'spell', 'star', 'star-fall', 'one-shot'],
  size: [32, 32],
  origin: [16, 28],
  duration: 1,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.lemon, seed: 9 },
  den: { surface: 'pet', stand: 'companion', anchor: 'feet', depth: 'over' },
};

// a little five-point star: a amber edge, b yellow body, c its white heart; the bigger one has a plum rim
const STAR5 = ['..a..', '.aba.', 'abcba', '.aba.', '.a.a.'];
const STAR7 = ['...k...', '..kbk..', 'kkkbbkk', 'kbbcbak', '.kbbak.', '.kbkak.', '.kk.kk.'];

// where each star starts, where it lands, when it falls (s) and how long it takes; the last one bonks on the head
const STARS = [
  { x0: -9, y0: -25, x1: -12.5, y1: -3, t0: 0.06, T: 0.17, big: false },
  { x0: 9.5, y0: -25, x1: 12, y1: -3, t0: 0.24, T: 0.17, big: false },
  { x0: 4, y0: -25, x1: 0, y1: -20, t0: 0.46, T: 0.1, big: true },
];

// position along a fall that speeds up: 0 at the start, 1 on landing
const along = (s, u) => {
  const e = u * (0.3 + 0.7 * u);
  return [s.x0 + (s.x1 - s.x0) * e, s.y0 + (s.y1 - s.y0) * e];
};

function head(p, C, x, y, big) {
  const pal = { a: C[2], b: C[3], c: WHITE, k: C[1] };
  if (big) p.sprite(STAR7, pal, Math.round(x) - 3, Math.round(y) - 3);
  else p.sprite(STAR5, pal, Math.round(x) - 2, Math.round(y) - 2);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const seed = o.seed;
  STARS.forEach((s, i) => {
    const u = (t - s.t0) / s.T;
    // it winks into being at the top, then streaks down on a trail that thins to a dotted thread
    if (u >= -0.35 && u < 0) {
      p.px(s.x0, s.y0, C[2]);
      if (u > -0.2)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          p.px(s.x0 + dx, s.y0 + dy, C[3]);
      p.glow(s.x0, s.y0, 4, C[4], 0.25);
    }
    if (u >= 0 && u < 1) {
      const [x, y] = along(s, u);
      const n = 8;
      for (let k = n; k >= 1; k--) {
        const ua = u - (k * 0.55) / n;
        if (ua < 0) continue;
        const [ax, ay] = along(s, ua);
        const [bx, by] = along(s, u - ((k - 1) * 0.55) / n);
        const v = k / n;
        p.line(ax, ay, bx, by, C[2], v < 0.5 ? 1 : 1.2 - v);
        if (v < 0.35) p.line(ax + 1, ay, bx + 1, by, C[3], 1);
      }
      head(p, C, x, y, s.big);
      p.glow(x, y, 7, C[4], 0.3);
      // glints shed along the way
      burst(3, seed + i * 13, (r, j) => {
        const ub = r.range(0.15, 0.7);
        const age = (u - ub) * s.T;
        if (age < 0 || age > 0.12) return;
        const [gx, gy] = along(s, ub);
        p.px(gx + r.range(-2, 2), gy + age * 20, j % 2 ? C[2] : C[3]);
      });
    }
    // the landing: a white-hot star, a tiny flat ring running out, glints hopping off
    const q = t - (s.t0 + s.T);
    if (q < 0) return;
    if (q < 0.06) {
      head(p, C, s.x1, s.y1, s.big);
      p.sprite(
        s.big ? STAR7 : STAR5,
        {},
        Math.round(s.x1) - (s.big ? 3 : 2),
        Math.round(s.y1) - (s.big ? 3 : 2),
        { tint: C[4] },
      );
      p.px(s.x1, s.y1, WHITE);
      p.glow(s.x1, s.y1, 8, C[4], 0.35);
    }
    // the ring: small and solid, wider, then it breaks into four glints on its diagonals
    const k = q / 0.15;
    if (k < 1) {
      const rr = 1.5 + (s.big ? 3 : 2) * ease.outCubic(k);
      if (k < 0.66) p.ring(s.x1, s.y1, rr, 1, k < 0.33 ? C[3] : C[2]);
      else
        for (const [dx, dy] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ])
          p.px(s.x1 + dx * rr * 0.75, s.y1 + dy * rr * 0.75, C[2]);
    }
    burst(s.big ? 2 : 3, seed + i * 7 + 1, (r, j) => {
      const life = r.range(0.22, 0.3);
      const kk = q / life;
      if (kk >= 1) return;
      // side stars throw their glints mostly back toward the familiar, so they stay on the card
      const inward = s.x1 < -4 ? 1 : s.x1 > 4 ? -1 : 0;
      const dir = j % 2 ? 1 : -1;
      const vx =
        inward === 0
          ? dir * r.range(18, 30)
          : dir === inward
            ? inward * r.range(14, 22)
            : -inward * r.range(5, 9);
      const [gx, gy] = fly(s.x1, s.y1 - 1, vx, -r.range(30, 45), q, 240, 2);
      if (kk < 0.5 && j < 2 && !s.big) {
        p.px(gx, gy, C[3]);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          p.px(gx + dx, gy + dy, C[2]);
      } else if (kk < 0.8 || Math.round(t * 20) % 2) p.px(gx, gy, C[2]);
    });
  });

  // after the bonk, three tiny twinkles circle the head for a moment (front ones as crosses, back ones as dots)
  const b = STARS[2];
  const qb = t - (b.t0 + b.T) - 0.13;
  if (qb > 0 && qb < 0.25) {
    for (let j = 0; j < 3; j++) {
      const a = qb * TAU * 1.8 + (j * TAU) / 3 + 0.5;
      const x = b.x1 + Math.cos(a) * 7;
      const y = b.y1 - 2.5 + Math.sin(a) * 1.8;
      if (qb > 0.16 && (Math.round(t * 20) + j) % 2) continue;
      if (Math.sin(a) > 0) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          p.px(x + dx, y + dy, C[2]);
        p.px(x, y, C[3]);
      } else p.px(x, y, C[2]);
    }
  }
}
