// Adapted from pixelfx fire/fireball (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The flame-puff, smoke and spark recipe is adapted from Sprite Fusion's open-source explosion
// (https://www.spritefusion.com/pixel-art-vfx/explosion), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, WHITE, fit, mix } from '../_core.js';
import { drift, flameBlade, looped, noiseFor, pnoise, solid } from '../_lib/fire.js';

export const meta = {
  den: { surface: 'town', from: 'fire/fireball', anchor: 'free', depth: 'over', stand: 'none' },
  name: 'Cheer fireball',
  desc: 'The cheer fireball in flight, facing right: a churning white-hot head with a corona, a short torn tail of puffs cooling to pink, embers shed behind and one tiny heart-shaped ember a loop.',
  tags: ['spell', 'fireball', 'cheer', 'projectile', 'fire', 'directional', 'loop'],
  size: [40, 24],
  origin: [30, 12],
  duration: 0.4,
  loop: true,
  fps: 20,
  bg: 'dark',
  options: { palette: DEN.ember, cool: DEN.pink, seed: 4 },
};

const D = meta.duration,
  NL = noiseFor(D);
const R0 = 3.2; // head radius (px)
const V = 60; // how fast the head outruns what it sheds (px/s)
// the comet body: tongues rooted in the head streaming back [length, half-width, y offset]
const BODY = [
  [12, 2.3, 0],
  [9.5, 2.1, -1.1],
  [9, 2.1, 1.1],
  [6.5, 2.6, 0],
];
// the corona: short licks peeling back off the head [angle on the head (0 is the nose), length, half-width]
const CORONA = [
  [-1.2, 5, 0.9],
  [-1.85, 6, 1],
  [1.2, 5, 0.9],
  [1.85, 6, 1],
];
// a 5 x 4 heart
const HEART5 = ['.#.#.', '#####', '.###.', '..#..'];

// the head: a ball whose outline churns and whose heat swirls, white at the heart, swept back
function head(p, H, t, S, hx, hy) {
  const ph = t / D;
  p.shade(hx - R0 * 2.2, hy - R0 * 1.6, hx + R0 * 1.5, hy + R0 * 1.6, (x, y) => {
    x -= hx;
    y -= hy;
    const d = Math.hypot(x, y),
      th = Math.atan2(y, x),
      back = Math.max(0, -Math.cos(th)),
      a = th / TAU;
    const bump = 0.5 * pnoise(a * 7 + ph * 7, 7, S) + 0.3 * pnoise(a * 4 - ph * 8, 4, S + 1);
    const rim = R0 * (1 + 0.5 * back * back) + bump;
    if (d > rim) return;
    const swirl = pnoise(a * 4 - ph * 8 + d * 0.5, 4, S + 2);
    const h = 1 - d / rim + 0.24 * swirl + 0.1 * (1 - back);
    // a crisp hot edge where it cuts the air
    if (rim - d < 1 && back < 0.3) return h > 0.3 ? H[2] : H[3];
    return h > 0.7 ? H[0] : h > 0.52 ? H[1] : h > 0.36 ? H[2] : h > 0.2 ? H[3] : H[4];
  });
}

// a puff torn off the tail: hot, then orange, then pink, then a pale fleck that winks out
function puff(p, x, y, u, s, H, K) {
  if (u < 0.75) {
    const r = s * (1 - 0.35 * u);
    const [rim, body, hi] =
      u < 0.18 ? [H[3], H[1], H[0]] : u < 0.36 ? [H[4], H[2], H[1]] : [K[2], K[3], K[4]];
    solid(p, x, y, r + 0.6, rim);
    solid(p, x - r * 0.2, y - r * 0.25, r * 0.7, body);
    if (r > 1.1) p.px(x - r * 0.35, y - r * 0.45, hi);
  } else {
    // the last of it: a pale pink fleck that winks out
    const k = (1 - u) / 0.25;
    p.dot(x, y, K[4], 0.45 + 0.55 * k);
    if (k > 0.5 && s > 1.1)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.dot(x + dx, y + dy, K[3], k * 0.7);
  }
}

// a tiny heart: hot, then pink, winking out
function heart(p, x, y, u, H, K) {
  if (u > 0.8 && Math.floor(u * 20) % 2) return;
  const a = u < 0.85 ? 1 : (1 - u) / 0.15 + 0.2;
  const [edge, body, mid] = u < 0.5 ? [K[2], H[1], WHITE] : [K[2], K[3], K[4]];
  const X0 = Math.round(x - 2.5),
    Y0 = Math.round(y - 2);
  p.sprite(HEART5, { '#': edge }, X0, Y0, { a });
  p.dot(X0 + 1, Y0 + 1, body, a);
  p.dot(X0 + 2, Y0 + 1, mid, a);
  p.dot(X0 + 3, Y0 + 1, body, a);
  p.dot(X0 + 2, Y0 + 2, body, a);
}

export function draw(p, t, o) {
  const E = fit(o.palette, 7),
    K = fit(o.cool, 7),
    S = o.seed;
  // hot-first: white, yellow, light orange, orange, red, deep red
  const H = [E[6], E[5], E[4], E[3], E[2], E[1]];
  const N = (rate, seed = 0, off = 0) => NL(t, rate, seed, off);
  // the head bobs a hair as it flies
  const hx = N(5, S + 50) * 0.4,
    hy = N(5, S + 51) * 0.5;

  // the torn tail: puffs thrown off the back that the head leaves behind; they shrink, cool to pink and go
  const puffs = [];
  looped(
    t,
    D,
    32,
    S + 100,
    (r) => {
      const x = -r.range(3, 10);
      return {
        x,
        y: r.range(-1, 1) * (1 + 0.12 * -x),
        v: V * r.range(0.05, 0.35),
        vy: r.range(-7, 7),
        s: r.range(0.9, 1.6),
        life: r.range(0.18, 0.3),
      };
    },
    (q, age) => {
      const [wx, y] = drift(0, q.y, q.v, q.vy, age, 0, -25, 3, 2.5);
      puffs.push([age / q.life, q.x + wx - V * age, y, q.s]);
    },
  );
  puffs.sort((a, b) => b[0] - a[0]);
  for (const [u, x, y, s] of puffs) puff(p, x, y, u, s, H, K);

  // the body: tongues of flame rooted in the head streaming back, and a corona licking round it
  const LAY = [
    [1, 1, 4],
    [0.74, 0.86, 3],
    [0.5, 0.66, 2],
    [0.26, 0.4, 1],
  ];
  BODY.forEach(([len, w, dy], i) => {
    const n = (S * 5 + i) * 17,
      L = len * (0.88 + 0.14 * N(5, n)) * (1 + 0.12 * Math.max(0, N(2.5, n + 3)));
    flameBlade(
      p,
      hx + 0.5,
      hy + dy * 0.5,
      -1,
      dy * 0.02,
      L,
      w,
      N(5, n + 5) * 1.5 + dy * 0.6,
      N,
      n,
      H,
      LAY,
      0.4,
      0.6 + L * 0.04,
    );
  });
  CORONA.forEach(([a, len, w], i) => {
    const n = (S * 5 + i + 20) * 17,
      L = len * (0.75 + 0.35 * (0.5 + 0.5 * N(7.5, n)));
    const ox = Math.cos(a) * R0 * 0.85,
      oy = Math.sin(a) * R0 * 0.85,
      dx = Math.cos(a) * 0.55 - 1,
      dy = Math.sin(a) * 0.55,
      l = Math.hypot(dx, dy);
    flameBlade(
      p,
      hx + ox,
      hy + oy,
      dx / l,
      dy / l,
      L,
      w,
      -Math.sign(a) * 0.8,
      N,
      n,
      H,
      [
        [1, 1, 3],
        [0.5, 0.7, 1],
      ],
      0.3,
      0.5,
    );
  });
  head(p, H, t, S, hx, hy);

  // embers shed behind: hot specks the head outruns, falling a little as they cool to pink
  looped(
    t,
    D,
    9,
    S + 300,
    (r) => ({
      x: -r.range(2, 7),
      y: r.range(-2.5, 2.5),
      v: V * r.range(0.3, 0.7),
      vy: r.range(-14, 18),
      life: r.range(0.2, 0.36),
      ph: r.range(0, 6.3),
    }),
    (q, age) => {
      const [wx, y, , vy] = drift(0, q.y, q.v, q.vy, age, 0, 40, 3, 2);
      const x = q.x + wx - V * age,
        k = 1 - age / q.life;
      if (k < 0.3 && Math.sin(age * 60 + q.ph) < 0) return;
      const c = k > 0.65 ? H[0] : k > 0.35 ? H[1] : K[3];
      p.px(x, y, c);
      if (k > 0.4) p.dot(x + 1, y - vy * 0.01, k > 0.65 ? H[2] : H[3], 0.9);
    },
  );

  // the one heart-shaped ember a loop: it pops off the back, floats up and back, cools to pink and winks out
  {
    const born = 0.04,
      life = 0.32,
      age = (((t - born) % D) + D) % D;
    if (age < life) {
      const u = age / life,
        [hx2, hy2] = drift(-3, -3, 0, -34, age, 0, 0, 3, 4);
      heart(p, hx2 - 40 * age, hy2, u, H, K);
    }
  }

  // light: a hot heart and a warm halo, a little light running down the tail
  const GLOW = mix(H[2], WHITE, 0.25);
  p.glowLine(hx - 3, hy, -16, 0, 5, GLOW, 0.12);
  p.glow(hx - 1, hy, 11, GLOW, 0.26);
  p.glow(hx, hy, 5, H[1], 0.2);
}
