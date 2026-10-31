// Adapted from pixelfx spawn/egg-hatch (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The cracks that open in stages and the burst into tumbling pieces follow Sprite Fusion's open-source ice
// shatter (https://www.spritefusion.com/pixel-art-vfx/ice), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TINT_RAMP, TAU, WHITE, burst, ease, fit, fly, mix, seg, star } from '../_core.js';

export const meta = {
  den: {
    surface: 'pet',
    from: 'spawn/egg-hatch',
    stand: 'none',
    depth: 'over',
    variants: {
      base: { palette: TINT_RAMP.base },
      rose: { palette: TINT_RAMP.rose },
      mint: { palette: TINT_RAMP.mint },
      sky: { palette: TINT_RAMP.sky },
      lemon: { palette: TINT_RAMP.lemon },
      lilac: { palette: TINT_RAMP.lilac },
    },
  },
  name: 'Familiar hatch',
  desc: "A speckled egg in the familiar's tint rocks three times, each rock cracking it further with warm light leaking out, then pops: the cap flies off, the cup tumbles away, light pours up and sparkles scatter.",
  tags: ['pet', 'familiar', 'egg', 'hatch', 'spawn', 'crack', 'one-shot'],
  size: [40, 44],
  origin: [20, 40],
  duration: 2.0,
  loop: false,
  fps: 15,
  bg: 'ground',
  options: { palette: DEN.lavender, glow: DEN.lemon, seed: 31 },
};

// [start, tilt in radians]: each rock harder than the last, alternating sides
const ROCKS = [
  [0.13, 0.15],
  [0.43, -0.21],
  [0.73, 0.28],
];
const SHIVER = 1.06;
const POP = 1.2;
const F = 1 / 15;
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const key = (x, y) => `${x},${y}`;

// the egg, hand-shaped: inside cells per row, top (y = -17) to bottom (y = -2); its ink rim sits on y = -1
const ROWS = [
  [-2, 1],
  [-3, 2],
  [-4, 3],
  [-4, 3],
  [-5, 4],
  [-5, 4],
  [-6, 5],
  [-6, 5],
  [-6, 5],
  [-6, 5],
  [-6, 5],
  [-6, 5],
  [-5, 4],
  [-5, 4],
  [-4, 3],
  [-3, 2],
];
const TOP = -17;
const SPECKS = new Set(
  [
    [-2, -15],
    [1, -13],
    [2, -13],
    [-4, -12],
    [3, -11],
    [-5, -7],
    [-1, -6],
    [0, -6],
    [3, -5],
    [-3, -4],
    [1, -3],
  ].map(([x, y]) => key(x, y)),
);

// the zigzag the egg breaks along, and which part of it each rock opens
const zig = (x) => -10 + [0, 1, 2, 1][(((x + 8) % 4) + 4) % 4];
const STAGE_X = [
  [-6, -3],
  [2, 5],
  [-2, 1],
];

const INSIDE = new Map();
for (let i = 0; i < ROWS.length; i++) {
  const y = TOP + i;
  const [x0, x1] = ROWS[i];
  const hw = (x1 - x0 + 1) / 2;
  const cx = (x0 + x1 + 1) / 2;
  for (let x = x0; x <= x1; x++) {
    // lit from the upper left: a white catchlight, a pale body, a soft shadow side and a deeper crescent
    const u = (x + 0.5 - cx) / hw;
    const v = (y + 0.5 + 9) / 8;
    const nz = Math.sqrt(Math.max(0, 1 - 0.8 * (u * u + v * v)));
    const d = -0.55 * u - 0.6 * v + 0.58 * nz;
    const tone = d > 0.72 ? 6 : d > 0.2 ? 5 : d > -0.22 ? 4 : 3;
    INSIDE.set(key(x, y), { x, y, tone, speck: SPECKS.has(key(x, y)) });
  }
}
const CRACK = [];
STAGE_X.forEach(([x0, x1], s) => {
  for (let x = x0; x <= x1; x++) CRACK.push({ x, y: zig(x), s });
});
const CRACK_AT = new Map(CRACK.map((c) => [key(c.x, c.y), c.s]));

// the same egg as a smooth curve (it matches ROWS exactly when upright), so a tilted egg keeps a clean edge
const halfWidth = (ey) => {
  const v = (-1 - ey) / 16;
  const s = 1 - (2 * v - 1) ** 2;
  return s <= 0 ? -1 : 6.2 * Math.pow(s, 0.45) * (1.08 - 0.3 * v);
};
const toneAt = (ex, ey) => {
  const hw = Math.max(1, halfWidth(ey));
  const u = ex / hw;
  const v = (ey + 9) / 8;
  const nz = Math.sqrt(Math.max(0, 1 - 0.8 * (u * u + v * v)));
  const d = -0.55 * u - 0.6 * v + 0.58 * nz;
  return d > 0.72 ? 6 : d > 0.2 ? 5 : d > -0.22 ? 4 : 3;
};

// the egg's pixels on screen, tilted by a about the middle of its round bottom (rolling, so the bottom stays
// put); a 1 px ink rim is drawn round whatever is inside
function eggOnScreen(a, dx) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const tx = 5 * a + dx;
  const out = new Map();
  for (let sy = -22; sy <= 0; sy++)
    for (let sx = -12; sx <= 12; sx++) {
      const X = sx + 0.5 - tx;
      const Y = sy + 0.5 + 6;
      const ex = X * ca + Y * sa;
      const ey = -X * sa + Y * ca - 6;
      if (Math.abs(ex) > halfWidth(ey)) continue;
      const speck = SPECKS.has(key(Math.floor(ex), Math.floor(ey)));
      out.set(key(sx, sy), { sx, sy, c: { tone: toneAt(ex, ey), speck } });
    }
  // where an egg cell lands on screen (for cracks, which must not lose pixels to sampling)
  const at = (x, y) => {
    const X = x + 0.5;
    const Y = y + 0.5 + 6;
    return key(Math.floor(X * ca - Y * sa + tx), Math.floor(X * sa + Y * ca - 6));
  };
  return { out, at };
}

function tilt(t) {
  let a = 0;
  for (const [t0, amp] of ROCKS) {
    const u = t - t0;
    if (u >= 0 && u < 0.4) a += amp * Math.sin((u * TAU) / 0.27) * Math.exp(-u * 3.2);
  }
  return a;
}
const stage = (t) => ROCKS.filter(([t0]) => t >= t0 + 0.06).length;
const opened = (s) => ROCKS[s][0] + 0.06;

function drawEgg(p, t, C, G) {
  const st = stage(t);
  const shake = t >= SHIVER ? (Math.floor(t * 15) % 2 ? 1 : -1) : 0;
  const { out, at } = eggOnScreen(tilt(t), shake);
  const col = new Map();
  for (const [k, e] of out) col.set(k, e.c.speck ? (e.c.tone >= 5 ? C[3] : C[2]) : C[e.c.tone]);
  // open cracks: warm light in the gap, white the moment it opens; the lip under it in shadow; the shell above
  // it lit from inside
  for (const c of CRACK) {
    if (c.s >= st) continue;
    const fresh = t - opened(c.s) < F;
    const lit = (Math.floor(t * 15) + c.x) % 3 === 0 ? G[4] : G[3];
    const k = at(c.x, c.y);
    // just before it pops the light boils up: the gap runs amber and the shell above it glows
    const boil = t >= SHIVER;
    if (col.has(k)) col.set(k, fresh ? WHITE : boil ? G[2] : lit);
    const lip = at(c.x, c.y + 1);
    if (col.has(lip) && !CRACK_AT.has(key(c.x, c.y + 1))) col.set(lip, C[1]);
    const up = at(c.x, c.y - 1);
    if (col.has(up) && !CRACK_AT.has(key(c.x, c.y - 1)))
      col.set(up, boil ? G[3] : mix(col.get(up), G[4], 0.55));
    const up2 = at(c.x, c.y - 2);
    if (boil && col.has(up2) && !CRACK_AT.has(key(c.x, c.y - 2))) col.set(up2, mix(col.get(up2), G[4], 0.6));
  }
  for (const [k, c] of col) {
    const [x, y] = k.split(',').map(Number);
    p.px(x, y, c);
  }
  for (const { sx, sy } of out.values())
    for (const [dx, dy] of N4) if (!out.has(key(sx + dx, sy + dy))) p.px(sx + dx, sy + dy, C[0]);
  // warm light pooling round the cracks, stronger with each one
  if (st > 0) p.glow(0, -10, 6 + st * 2, G[3], 0.1 + st * 0.06);
  // a few motes of light escape each crack as it opens
  for (let s = 0; s < st; s++)
    burst(3, 50 + s, (r, i) => {
      const age = t - opened(s) - i * 0.04;
      if (age < 0 || age > 0.33) return;
      const c = CRACK[CRACK.findIndex((q) => q.s === s) + 1 + i];
      const [x, y] = fly(c.x, c.y - 1, r.range(-12, 12), r.range(-40, -25), age, 0, 2);
      p.px(x, y, age < 0.15 ? WHITE : G[3]);
    });
}

// the two halves as cells around their own middles: the cap above the zigzag, the cup from it down
const CAP = new Map();
const CUP = new Map();
for (const c of INSIDE.values()) {
  if (c.y < zig(c.x)) CAP.set(key(c.x, c.y + 13), c);
  else CUP.set(key(c.x, c.y + 6), { ...c, rim: CRACK_AT.has(key(c.x, c.y)) });
}
for (let x = -6; x <= 5; x++) if (INSIDE.has(key(x, zig(x)))) CAP.set(key(x, zig(x) + 13), { x, rim: true });

// one half at (X, Y) turned by a: its lit outside, its broken edge hot at first, an ink rim round it all
function drawPiece(p, map, X, Y, a, C, G, hot, fade) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const on = new Map();
  for (let sy = Math.floor(Y - 10); sy <= Math.ceil(Y + 10); sy++)
    for (let sx = Math.floor(X - 10); sx <= Math.ceil(X + 10); sx++) {
      const dx = sx + 0.5 - X;
      const dy = sy + 0.5 - Y;
      const c = map.get(key(Math.floor(dx * ca + dy * sa), Math.floor(-dx * sa + dy * ca)));
      if (c) on.set(key(sx, sy), c);
    }
  // as it fades it pales first, so it never leaves dark specks behind
  const pale = fade < 0.75;
  const a2 = pale ? fade / 0.75 : 1;
  for (const [k, c] of on) {
    const [x, y] = k.split(',').map(Number);
    const col = c.rim
      ? hot > 0.6
        ? WHITE
        : hot > 0.2
          ? G[3]
          : C[4]
      : pale
        ? C[5]
        : c.speck
          ? C[3]
          : C[Math.max(4, c.tone)];
    p.dot(x, y, col, a2);
    for (const [dx, dy] of N4)
      if (!on.has(key(x + dx, y + dy))) p.dot(x + dx, y + dy, pale ? C[3] : C[0], a2);
  }
}

// a four-point twinkle: arms of arm px, a white heart
function twinkle(p, x, y, arm, c, tip) {
  const n = Math.round(arm);
  const X = Math.round(x);
  const Y = Math.round(y);
  if (n < 1) return p.px(X, Y, c);
  for (let d = 1; d <= n; d++) {
    const k = d === n && n > 1 ? tip : c;
    p.px(X + d, Y, k);
    p.px(X - d, Y, k);
    p.px(X, Y + d, k);
    p.px(X, Y - d, k);
  }
  p.px(X, Y, WHITE);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const G = fit(o.glow, 7);
  if (t < POP) {
    drawEgg(p, t, C, G);
    return;
  }
  const u = t - POP;
  // the hero frame: a burst of light behind an egg gone white
  if (u < F * 0.999) {
    p.poly(star(0, -11, 8, 15, 8, -Math.PI / 2), G[2]);
    p.poly(star(0, -11, 6.5, 12.5, 8, -Math.PI / 2), G[3]);
    for (const c of INSIDE.values()) p.px(c.x, c.y, c.y < -13 && c.x < -1 ? WHITE : G[5]);
    p.glow(0, -11, 16, G[3], 0.35);
    return;
  }
  // the cap pops up and tumbles off to the upper left; the cup is kicked away to the right
  if (u < 0.6) {
    const fade = 1 - seg(u, 0.34, 0.56);
    const hot = 1 - seg(u, F, 0.3);
    // it lands on the floor as a little bowl and rests there while it fades
    const [cx, cy] = fly(0, -13, -26, -120, u, 560, 0.8);
    drawPiece(p, CAP, cx, Math.min(cy, -5), -Math.PI * ease.outQuad(seg(u, 0, 0.42)), C, G, hot, fade);
    const kx = 12 * ease.outCubic(seg(u, 0, 0.4));
    const ky = -5 - 3 * Math.sin(Math.PI * seg(u, 0.03, 0.28));
    drawPiece(p, CUP, kx, ky, 1.1 * ease.outCubic(seg(u, 0, 0.35)), C, G, hot, fade);
  }
  // light pours up out of the opening: a bright core and a fan of rays that shrink away
  const lk = 1 - seg(u, F, 0.5);
  if (lk > 0) {
    const r = 5.5 * ease.outQuad(lk);
    p.circle(0, -10, r + 1, G[2]);
    p.circle(0, -10, r, G[3]);
    p.circle(0, -10.5, r * 0.6, G[5]);
    const L = 12 * ease.outCubic(seg(u, 0.03, 0.15)) * (0.4 + 0.6 * lk);
    for (let i = 0; i < 7; i++) {
      const an = -Math.PI / 2 + (i - 3) * 0.33;
      const len = L * (i % 2 ? 0.6 : 1);
      const x0 = Math.cos(an) * (r + 2);
      const y0 = -10 + Math.sin(an) * (r + 2);
      p.line(x0, y0, x0 + Math.cos(an) * len, y0 + Math.sin(an) * len, (q) => (q < 0.4 ? G[3] : G[2]));
    }
    p.glow(0, -11, 12, G[3], 0.3 * lk);
  }
  // sparkles flung out of the light, twinkling as they slow
  burst(9, o.seed, (r, i) => {
    const age = u - F - r.range(0, 0.08);
    const life = r.range(0.42, 0.66);
    if (age < 0 || age > life) return;
    const an = -Math.PI / 2 + (i - 4) * 0.36 + r.range(-0.12, 0.12);
    const sp = r.range(55, 95);
    const [x, y] = fly(0, -11, Math.cos(an) * sp, Math.sin(an) * sp, age, 40, 4.2);
    // hidden while still inside the light it came out of
    if (Math.hypot(x, y + 10) < 6.5 * (1 - seg(u, F, 0.5)) + 1.5) return;
    const k = age / life;
    const arm = k < 0.15 ? 1 : k < 0.6 ? 2 : k < 0.85 ? 1 : 0;
    const tint = i % 3 === 1;
    twinkle(p, x, y, arm, tint ? C[3] : G[3], tint ? C[2] : G[2]);
  });
}
