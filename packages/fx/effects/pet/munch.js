import { DEN, TAU, WHITE, burst, ease, fit, seg } from '../_core.js';

export const meta = {
  name: 'Familiar munch',
  desc: 'A snack for the familiar: a little chocolate-chip cookie pops in at mouth height, is eaten in three bites that shake crumbs loose, the crumbs fall and bounce, and a tiny sparkle of joy twinkles; 0.8 s.',
  tags: ['pet', 'familiar', 'snack', 'cookie', 'eat', 'crumbs', 'one-shot'],
  size: [32, 24],
  origin: [16, 20],
  duration: 0.8,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.coffee, glow: DEN.lemon, seed: 5 },
  den: { surface: 'pet', stand: 'companion', depth: 'over' },
};

const CX = -10;
const CY = -7;
const R0 = 3.3;
const BITES = [
  // [time, x, y, radius]: each bite comes from the familiar's side (the right) and takes a rounder chunk
  [0.18, CX + 3.6, CY - 1, 2.1],
  [0.32, CX + 2, CY + 1.4, 2.6],
];
const GONE = 0.46;
const CHIPS = [
  [-2, -2],
  [1, -1],
  [-1, 1],
  [2, 2],
];
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// height of a crumb dropped from y0 at vy, bouncing on the floor (y = -1) and settling; t seconds after it left
function hop(y0, vy, t, g = 520, e = 0.38) {
  let y = y0;
  let v = vy;
  let tt = t;
  for (let n = 0; n < 3; n++) {
    const c = y + 1;
    const s = (-v + Math.sqrt(Math.max(0, v * v - 2 * g * c))) / g;
    if (tt < s) return [y + v * tt + 0.5 * g * tt * tt, false];
    tt -= s;
    v = -(v + g * s) * e;
    y = -1;
    if (Math.abs(v) < 24) break;
  }
  return [-1, true];
}

function cookie(p, C, t) {
  // it pops in with a little overshoot, and jolts towards the familiar on every bite
  const r = R0 * ease.outBack(seg(t, 0, 0.1), 2.6);
  if (r < 0.5) return;
  let jolt = 0;
  for (const [tb] of BITES) if (t >= tb && t < tb + 0.05) jolt = 1;
  const x0 = CX + jolt;
  const bitten = (x, y) =>
    BITES.some(([tb, bx, by, br]) => t >= tb && (x - bx - jolt) ** 2 + (y - by) ** 2 < br * br);
  const on = new Set();
  for (let y = Math.floor(CY - r - 1); y <= Math.ceil(CY + r); y++)
    for (let x = Math.floor(x0 - r - 1); x <= Math.ceil(x0 + r); x++) {
      const dx = x + 0.5 - x0;
      const dy = y + 0.5 - CY;
      if (dx * dx + dy * dy <= r * r && !bitten(x + 0.5, y + 0.5)) on.add(`${x},${y}`);
    }
  for (const k of on) {
    const [x, y] = k.split(',').map(Number);
    const dx = x + 0.5 - x0;
    const dy = y + 0.5 - CY;
    // a golden bake: lit upper left, a toasted rim lower right, chips, and a crumbly pale edge where it was bitten
    const lit = -(dx * 0.6 + dy * 0.8) / Math.max(1, r);
    let c = lit > 0.45 ? C[5] : lit > -0.35 ? C[4] : C[3];
    if (CHIPS.some(([cx, cy]) => Math.round(dx - 0.5) === cx && Math.round(dy - 0.5) === cy) && r > 2.5)
      c = C[1];
    const edge = N4.some(([ex, ey]) => !on.has(`${x + ex},${y + ey}`) && bitten(x + ex + 0.5, y + ey + 0.5));
    if (edge) c = C[5];
    p.px(x, y, c);
  }
  for (const k of on) {
    const [x, y] = k.split(',').map(Number);
    for (const [ex, ey] of N4) if (!on.has(`${x + ex},${y + ey}`)) p.px(x + ex, y + ey, C[0]);
  }
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const G = fit(o.glow, 7);
  if (t < GONE) cookie(p, C, t);
  // crumbs knocked loose by each bite (the last one by the cookie vanishing), falling and bouncing
  const bursts = [...BITES.map(([tb, bx, by]) => [tb, bx, by]), [GONE, CX + 0.5, CY]];
  bursts.forEach(([tb, bx, by], j) => {
    burst(j === 2 ? 6 : 4, o.seed * 7 + j, (r, i) => {
      const age = t - tb;
      if (age < 0) return;
      // knocked out sideways and a little up, away from the face
      const vx = r.range(-24, 8) + (j === 2 ? (i - 2.5) * 5 : 0);
      const [y, rest] = hop(by + r.range(-1, 1.5), -r.range(12, 45), age);
      const x = Math.max(-15, bx + vx * Math.min(age, 0.3));
      // fade by blinking out before the end
      const left = meta.duration - 0.05 - t;
      if (left < 0 || (left < 0.08 && (i + Math.floor(t * 20)) % 2)) return;
      const big = i % 3 === 0;
      // lighter once they settle, so they never sit on the floor as a dark smudge
      const c = rest ? C[4] : i % 2 ? C[4] : C[3];
      p.px(x, y, c);
      if (big) {
        p.px(x + 1, y, rest ? C[3] : C[2]);
        if (!rest) p.px(x, y - 1, C[5]);
      }
    });
  });
  // the last bite: the cookie is gone in a little poof of crumb dust
  const q = seg(t, GONE, GONE + 0.12);
  if (q > 0 && q < 1)
    for (let i = 0; i < 6; i++) {
      const an = (i / 6) * TAU + 0.3;
      const d = 2 + 3.5 * ease.outQuad(q);
      p.px(CX + Math.cos(an) * d, CY + Math.sin(an) * d * 0.8, q < 0.5 ? C[4] : C[3]);
    }
  // a tiny sparkle of joy by the familiar's head once the snack is gone
  for (const [t0, x, y, n] of [
    [0.48, -14, -14, 2],
    [0.56, -11, -18, 1],
  ]) {
    const u = seg(t, t0, t0 + 0.2);
    if (u <= 0 || u >= 1) continue;
    const arm = Math.round(n * Math.sin(Math.PI * u));
    if (arm < 1) {
      p.px(x, y, G[3]);
      continue;
    }
    for (let d = 1; d <= arm; d++)
      for (const [dx, dy] of N4) p.px(x + dx * d, y + dy * d, d === arm && arm > 1 ? G[2] : G[3]);
    p.px(x, y, WHITE);
    p.glow(x, y, 5, G[3], 0.25 * Math.sin(Math.PI * u));
  }
  // the pop as it arrives
  if (t < 0.1)
    for (let i = 0; i < 4; i++) {
      const an = (i / 4) * TAU + Math.PI / 4;
      const d = 4 + 3 * ease.outQuad(t / 0.1);
      if (t > 0.03) p.px(CX + Math.cos(an) * d, CY + Math.sin(an) * d, G[3]);
    }
}
