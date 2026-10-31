// Adapted from pixelfx ui/quest-complete (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
import { DEN, TAU, WHITE, burst, clamp, ease, fit, noise, seg } from '../_core.js';

export const meta = {
  name: 'Quest done',
  desc: 'A small personal "nice!" for a finished to-do: a stitched lemon ribbon unrolls from the middle, a round lavender seal stamps down on it and a check draws on with a tick of light, little stars pop, then it rolls back up and is gone. No words. 1.6 s.',
  tags: ['ui', 'quest', 'to-do', 'ribbon', 'seal', 'check', 'one-shot'],
  size: [96, 48],
  origin: [48, 24],
  duration: 1.6,
  loop: false,
  fps: 15,
  bg: 'ground',
  options: { palette: DEN.lemon, seal: DEN.lavender, seed: 8 },
  den: { surface: 'ui', stand: 'none', anchor: 'free', depth: 'over', from: 'ui/quest-complete' },
};

// a whole-pixel shake that dies away, as pixelfx's ui helpers do it: [dx, dy] at t, amp px, from t0 over len s
function shake(t, amp, t0, len, seed, hz = 32) {
  if (t < t0 || t > t0 + len) return [0, 0];
  const k = 1 - (t - t0) / len;
  return [
    Math.round(noise(t * hz, seed) * amp * k * 1.7),
    Math.round(noise(t * hz, seed + 7) * amp * k * 1.3),
  ];
}

const L = 30; // the ribbon's half length
const BH = 5; // its half height
const OPEN = 0.27; // unrolled
const STAMP = 0.5; // the seal lands
const R = 9; // the seal's radius
const POPSEAL = 1.17; // the seal pops away
const ROLL = 1.22; // the ribbon starts rolling back up
const GONE = 1.47; // rolled up

// the ribbon: notched tails tucked behind, then the band with a lit top, lavender stitching and an ink rim
function ribbon(p, Rb, S, l, tails, jx, jy) {
  if (l < 1) return;
  if (tails > 0.02)
    for (const s of [-1, 1]) {
      const drop = 4 * tails;
      const x0 = s * (l - 6);
      const x1 = s * (l + 9 * tails);
      p.shade(
        Math.min(x0, x1) - 1 + jx,
        -BH + drop - 1 + jy,
        Math.max(x0, x1) + 1 + jx,
        BH + drop + 1 + jy,
        (x, y) => {
          const u = (x - jx - x0) / (x1 - x0);
          const v = y - jy - drop;
          if (u < 0 || u > 1 || Math.abs(v) > BH - 1) return 0;
          if (u > 1 - (0.35 * (BH - 1 - Math.abs(v))) / (BH - 1)) return 0; // the V notch
          const e = Math.min(BH - 1 - Math.abs(v), (1 - u) * Math.abs(x1 - x0));
          if (e < 1) return Rb[0];
          return v > BH - 3 ? Rb[1] : Rb[2];
        },
      );
    }
  p.shade(-l - 1 + jx, -BH - 1 + jy, l + 1 + jx, BH + 1 + jy, (x, y) => {
    const ax = Math.abs(x - jx);
    const v = y - jy;
    if (ax > l || Math.abs(v) > BH) return 0;
    if (Math.min(l - ax, BH - Math.abs(v)) < 1) return Rb[0];
    if (v < -BH + 2) return Rb[4];
    if (v > BH - 2) return Rb[1];
    const stitch = Math.abs(v + BH - 2.5) < 0.5 || Math.abs(v - BH + 2.5) < 0.5;
    if (stitch && Math.floor(x - jx + 0.5) % 3 !== 0 && ax < l - 2) return S[3];
    return v < 0 ? Rb[3] : Rb[2];
  });
  // while it unrolls or rolls up, the rolled ends ride its edges
  if (tails < 0.02)
    for (const s of [-1, 1]) {
      const x = Math.round(s * l + jx);
      p.rect(x - 2, -BH - 2 + jy, 4, BH * 2 + 4, Rb[0]);
      p.rect(x - 1, -BH - 1 + jy, 1, BH * 2 + 2, Rb[4]);
      p.rect(x, -BH - 1 + jy, 1, BH * 2 + 2, Rb[2]);
      p.px(x - 1, -BH - 1 + jy, WHITE);
    }
}

// the seal: a scalloped ink rim, a lit lavender band, a face with an inner ring; `white` flashes it
function seal(p, S, x, y, r, sx, sy, white, shine) {
  const M = r * 1.12 + 1;
  p.shade(x - M * sx, y - M * sy, x + M * sx, y + M * sy, (px, py) => {
    const dx = (px - x) / sx;
    const dy = (py - y) / sy;
    const d = Math.hypot(dx, dy);
    const an = Math.atan2(dy, dx);
    const edge = r * (1 + 0.08 * Math.cos(an * 12));
    if (d > edge) return 0;
    if (edge - d < 1) return S[0];
    if (white) return edge - d < 2 ? S[4] : WHITE;
    if (shine !== null && Math.abs(dx + dy * 0.7 - shine) < 1.2) return WHITE;
    const l = -(dx * 0.6 + dy * 0.8) / r; // lit from the upper left
    if (edge - d < 2.6) return l > 0.25 ? S[4] : l > -0.35 ? S[3] : S[2];
    if (Math.abs(d - r * 0.62) < 0.5) return S[2];
    return l > 0.4 ? S[5] : l > -0.2 ? S[4] : S[3];
  });
}

// the check: a short stroke down, a long one up, drawn on in progress k (white with an ink edge)
function check(p, S, x, y, k) {
  if (k <= 0) return;
  const pts = [
    [x - 4, y],
    [x - 1.5, y + 2.5],
    [x + 4, y - 3.5],
  ];
  const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  const l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
  const done = k * (l1 + l2);
  const segs = [
    [pts[0], pts[1], Math.min(1, done / l1)],
    [pts[1], pts[2], clamp((done - l1) / l2)],
  ];
  for (const [w, c] of [
    [3.6, S[0]],
    [1.8, WHITE],
  ])
    for (const [a, b, u] of segs)
      if (u > 0) p.beam(a[0], a[1], a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, w, c);
}

// a little four-point twinkle: arms of length n, a pale heart
function twinkle(p, x, y, n, c, heart) {
  if (n < 0.5) return;
  const N = Math.round(n);
  for (let d = 1; d <= N; d++)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      p.px(x + dx * d, y + dy * d, c);
  if (N >= 3)
    for (const [dx, dy] of [
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ])
      p.px(x + dx, y + dy, c);
  p.px(x, y, N >= 2 ? heart : c);
}

export function draw(p, t, o) {
  const Rb = fit(o.palette, 7);
  const S = fit(o.seal, 7);
  const seed = o.seed;
  const [jx, jy] = shake(t, 1, STAMP, 0.16, seed);

  // 1. the ribbon unrolls from a little roll in the middle, its tails drop; at the end it rolls back up
  const l =
    t < ROLL
      ? 3 + (L - 3) * ease.outCubic(seg(t, 0, OPEN))
      : (L - 3) * (1 - ease.inCubic(seg(t, ROLL, GONE))) + 3;
  const tails = ease.outBack(seg(t, OPEN - 0.02, OPEN + 0.12), 2) * (1 - seg(t, ROLL - 0.08, ROLL));
  if (t < GONE) ribbon(p, Rb, S, l, tails, jx, jy);
  // gone with a wink where the roll was
  const w = seg(t, GONE, GONE + 0.1);
  if (w > 0 && w < 1) twinkle(p, 0, 0, 4 * Math.sin(w * Math.PI), Rb[2], Rb[4]);

  // 2. the seal drops in, big and high, stamps with a squash and a white frame, then the check draws on
  const dk = seg(t, STAMP - 0.14, STAMP);
  const pk = t - POPSEAL;
  if (dk > 0 && pk < 0.07) {
    const fall = 1 - ease.inQuad(dk);
    const sq = t >= STAMP ? Math.exp(-(t - STAMP) * 28) : 0;
    let sx = (1 + 0.45 * fall) * (1 + 0.22 * sq);
    let sy = (1 + 0.45 * fall) * (1 - 0.22 * sq);
    if (pk > 0) sx = sy = 1 + 0.35 * (pk / 0.07);
    const white = (t >= STAMP && t < STAMP + 0.06) || pk > 0;
    // its shadow on the ribbon as it comes down
    if (dk < 1) p.disc(jx, jy + 1, R * (1 - 0.3 * fall), S[0], 0.35 * dk);
    const sh = seg(t, 0.82, 0.96);
    seal(p, S, jx, jy - 9 * fall, R, sx, sy, white, sh > 0 && sh < 1 ? -14 + 28 * sh : null);
    if (!white) check(p, S, jx, jy, seg(t, STAMP + 0.06, STAMP + 0.2));
    p.glow(0, 0, 16, S[4], 0.18 + (white ? 0.17 : 0));
  }
  // the stamp's ring: two quick frames running out across the ribbon, then gone
  const rk = (t - STAMP) / 0.15;
  if (rk > 0 && rk < 1) {
    const rr = R + 1 + 8 * ease.outCubic(rk);
    p.ellipse(0, 0, rr * 1.25, rr * 0.8, rk < 0.4 ? S[4] : S[3], (d) => (d > 1 - 1.2 / rr ? 1 : 0));
  }
  // a tick of light: a lemon glint at the tip of the check once it is drawn
  const tk = seg(t, 0.76, 0.92);
  if (tk > 0 && tk < 1) twinkle(p, 4, -4, 4 * Math.sin(tk * Math.PI), Rb[2], WHITE);

  // 3. little stars pop round the banner one after another
  burst(6, seed, (r, i) => {
    const side = i % 2 ? 1 : -1;
    const x = side * [36, 20, 28][i >> 1] + r.range(-3, 3);
    const y = [-12, -15, 12][i >> 1] + r.range(-2, 2);
    const t0 = STAMP + 0.1 + i * 0.09 + r.range(0, 0.03);
    const u = (t - t0) / r.range(0.26, 0.34);
    if (u <= 0 || u >= 1) return;
    twinkle(
      p,
      Math.round(x),
      Math.round(y),
      (i % 3 ? 3 : 4) * Math.sin(u * Math.PI),
      i % 2 ? S[2] : Rb[2],
      i % 2 ? S[4] : Rb[4],
    );
  });
  // and a few more burst off the seal as it pops
  if (pk > 0)
    burst(6, seed + 5, (r, i) => {
      const a = (i / 6) * TAU + r.range(-0.3, 0.3);
      const u = pk / r.range(0.22, 0.3);
      if (u >= 1) return;
      const d = 6 + 12 * ease.outCubic(u);
      twinkle(
        p,
        Math.round(Math.cos(a) * d * 1.3),
        Math.round(Math.sin(a) * d * 0.8),
        2 * (1 - u) + 0.6,
        i % 2 ? S[2] : Rb[2],
        WHITE,
      );
    });
}
