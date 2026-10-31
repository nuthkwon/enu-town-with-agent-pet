// Adapted from pixelfx holy/heal (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// 힐링 포션 lands (after spell/potion-fly): from the library heal, the hoop of light that rises up the body leaving
// sparkles, and motes that pop into hearts; from heal-aoe, the ring that blooms on the floor and the plus signs.
// Ours: the flask breaks at the chest with a clink, mint brew rains down, and nothing recolours the person.
import { DEN, TAU, WHITE, clamp, ease, fit, rng, seg, smooth } from '../_core.js';

export const meta = {
  name: 'Healing potion',
  desc: 'The potion breaks on the chest with a white clink and glass glints, mint brew rains down and a soft ring blooms on the floor, a hoop of light rises up the body, then plus signs and tiny hearts float up and pop.',
  tags: ['spell', 'heal', 'potion', 'plus', 'hearts', 'ring', 'one-shot'],
  size: [48, 64],
  origin: [24, 58],
  duration: 1.2,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.mint, hearts: DEN.pink, seed: 2 },
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'holy/heal' },
};

const [W, H] = meta.size;
const [OX, OY] = meta.origin;
const XL = -OX,
  XR = W - OX,
  YT = -OY,
  YB = H - OY;
const IN = (x, y) => {
  const X = Math.floor(x),
    Y = Math.floor(y);
  return X >= XL && X < XR && Y >= YT && Y < YB;
};
const dot = (p, x, y, c, a = 1) => {
  if (a > 0 && IN(x, y)) p.dot(x, y, c, a);
};

const CHEST = -14,
  SY = 0.36,
  TOP = -27,
  LIFT0 = 0.16,
  LIFT1 = 0.64;
// the body the hoop goes behind: half its width at a height above the feet (a 32 px avatar, about 22 px tall)
const bodyHalf = (y) => (y > -1 ? 0 : y > -12 ? 4.5 : y > -24 ? 6.5 : 0);

/** A sprite from rows ('#' body, '+' glint), a 1 px rim round it: body c, glint white, rim r. */
function icon(p, rows, x, y, c, r, a = 1) {
  const h = rows.length,
    w = rows[0].length,
    X = Math.round(x - w / 2),
    Y = Math.round(y - h / 2);
  const at = (i, j) => j >= 0 && j < h && i >= 0 && i < w && rows[j][i] !== '.';
  for (let j = -1; j <= h; j++)
    for (let i = -1; i <= w; i++) {
      if (at(i, j)) dot(p, X + i, Y + j, rows[j][i] === '+' ? WHITE : rows[j][i] === 'o' ? r : c, a);
      else if (at(i - 1, j) || at(i + 1, j) || at(i, j - 1) || at(i, j + 1)) dot(p, X + i, Y + j, r, a);
    }
}
const PLUS = ['.#.', '#+#', '.#.'];
const PLUS_BIG = ['..#..', '..#..', '##+##', '..#..', '..#..'];
const HEART = ['##.##', '#+###', '.###.', '..#..'];

/** The clink: a white star with long and short rays and a mint rim, shrinking over k 0..1. */
function clink(p, C, x, y, k) {
  const L = 8 * (1 - k),
    S = 4 * (1 - k),
    core = 2.2 * (1 - k * 0.6);
  if (L < 1) return;
  const inside = (px, py) => {
    const dx = px - x,
      dy = py - y,
      ax = Math.abs(dx),
      ay = Math.abs(dy);
    if (Math.hypot(dx, dy) <= core) return true;
    if ((ax < 0.9 && ay <= L) || (ay < 0.9 && ax <= L)) return true;
    return Math.abs(ax - ay) < 0.9 && ax + ay <= S * 1.4;
  };
  for (let j = Math.floor(y - L - 2); j <= Math.ceil(y + L + 2); j++)
    for (let i = Math.floor(x - L - 2); i <= Math.ceil(x + L + 2); i++) {
      const px = i + 0.5,
        py = j + 0.5;
      if (inside(px, py)) dot(p, i, j, Math.hypot(px - x, py - y) > L * 0.7 ? C[4] : WHITE);
      else if (inside(px + 1, py) || inside(px - 1, py) || inside(px, py + 1) || inside(px, py - 1))
        dot(p, i, j, C[2], 0.9);
    }
  p.glow(x, y, 10, C[4], 0.35 * (1 - k));
}

/** A ring on the floor or round the body: an ellipse, its near half bright, its far half dim and hidden by the body. */
function hoop(p, C, cy, rx, ry, a, hot, thick = false) {
  const n = Math.ceil(rx * TAU * 1.4) + 8;
  for (let j = 0; j < n; j++) {
    const g = (j / n) * TAU,
      s = Math.sin(g),
      x = Math.cos(g) * rx,
      y = cy + s * ry;
    if (s < 0) {
      if (Math.abs(x) < bodyHalf(y)) continue;
      dot(p, x, y, C[4], a * 0.75);
    } else {
      dot(p, x, y, hot || s > 0.5 ? WHITE : C[5], a);
      if (thick) dot(p, x, y - 1, s > 0.5 ? C[5] : C[4], a);
      if (s > 0.3) dot(p, x, y + 1, C[3], a * 0.8);
    }
  }
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7),
    K = fit(o.hearts, 7),
    seed = o.seed;

  // a soft mint light pools on the floor while the ring blooms and the hoop rises
  const pool = smooth(0.06, 0.2, t) * (1 - smooth(0.6, 0.9, t));
  if (pool > 0) p.glow(0, -2, 15, C[3], 0.24 * pool);

  // the ring that blooms on the floor where the brew lands, with a fainter one inside it
  const rb = seg(t, 0.08, 0.5);
  if (rb > 0 && rb < 1) {
    const rx = 4 + 12 * ease.outCubic(rb),
      a = 1 - smooth(0.55, 1, rb);
    hoop(p, C, 0, rx, rx * SY, a, rb < 0.12);
    if (rb > 0.15) hoop(p, C, 0, rx * 0.62, rx * 0.62 * SY, a * 0.6, false);
  }

  // the hoop of light rising up the body from the feet to over the head, leaving sparkles on the way
  if (t > LIFT0 && t < LIFT1 + 0.1) {
    const k = seg(t, LIFT0, LIFT1),
      y = TOP * ease.inOutSine(k),
      rx = 11 - 3 * k;
    const a = t < LIFT1 ? 1 : 1 - (t - LIFT1) / 0.1,
      shrink = t < LIFT1 ? 1 : 1 - (t - LIFT1) / 0.1;
    // a fading echo of where it just was, so it reads as rising
    const ye = TOP * ease.inOutSine(seg(t - 0.05, LIFT0, LIFT1));
    if (ye - y > 1.5) hoop(p, C, ye, (rx + 0.6) * shrink, (rx + 0.6) * shrink * 0.32, a * 0.45, false);
    hoop(p, C, y, rx * shrink, rx * shrink * 0.32, a, false, true);
    for (let i = -2; i <= 2; i++) p.glow(i * rx * 0.45, y, 7, C[3], 0.26 * a);
  }
  for (let i = 0; i < 9; i++) {
    const r = rng(seed, i, 1),
      f = (i + 0.5) / 9,
      tp = LIFT0 + (LIFT1 - LIFT0) * f,
      age = t - tp;
    if (age < 0 || age > 0.3) continue;
    const y = TOP * ease.inOutSine(f) - age * 14,
      side = i % 2 ? 1 : -1,
      x = side * (bodyHalf(y + 0.5) + r.range(1, 3));
    // small white glints, not to be mistaken for the plus signs
    if (age < 0.12)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        dot(p, x + dx, y + dy, C[5], 1.2 - age / 0.3);
    dot(p, x, y, WHITE, 1.2 - age / 0.3);
  }
  // the hoop pops over the head
  const pop = (t - LIFT1) / 0.14;
  if (pop > 0 && pop < 1) {
    const arm = Math.round(4 * (1 - pop)) + 1;
    for (let d = 1; d <= arm; d++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        dot(p, dx * d, TOP + dy * d, d > arm * 0.6 ? C[4] : WHITE);
    dot(p, 0, TOP, WHITE);
    for (let j = 0; j < 8; j++) {
      const g = (j / 8) * TAU + 0.4,
        rr = 3 + 9 * ease.outCubic(pop);
      dot(p, Math.cos(g) * rr, TOP + Math.sin(g) * rr * 0.7, j % 2 ? C[4] : WHITE, 1.2 - pop);
    }
    p.glow(0, TOP, 9, C[4], 0.3 * (1 - pop));
  }

  // the clink: the flask breaks on the chest in a white star, glass glints fly, mint brew rains down
  if (t < 0.12) clink(p, C, 0, CHEST, t / 0.12);
  for (let i = 0; i < 7; i++) {
    const r = rng(seed, i, 2),
      g = -Math.PI / 2 + r.range(-1.4, 1.4),
      v = r.range(55, 95),
      age = t - r.range(0, 0.02),
      life = r.range(0.22, 0.34);
    if (age < 0 || age > life) continue;
    const x = Math.cos(g) * v * age,
      y = CHEST + Math.sin(g) * v * age + 260 * age * age;
    dot(p, x, y, age < 0.1 || i % 2 ? WHITE : C[5], 1.3 - age / life);
  }
  for (let i = 0; i < 9; i++) {
    const r = rng(seed, i, 3),
      side = i % 2 ? 1 : -1,
      vx = side * r.range(12, 45),
      vy = -r.range(20, 70),
      t0 = r.range(0.01, 0.06);
    const age = t - t0;
    if (age < 0) continue;
    // brew drops arc out and fall to the floor, where each one plinks
    const land = (vy + Math.sqrt(vy * vy + 2 * 520 * -CHEST)) / 520;
    if (age < land) {
      const x = vx * age,
        y = CHEST + vy * age + 260 * age * age;
      dot(p, x, y, C[2]);
      dot(p, x, y - 1, C[4]);
    } else if (age < land + 0.1) {
      const x = vx * land,
        k = (age - land) / 0.1;
      dot(p, x, -1, WHITE, 1 - k);
      dot(p, x - 1 - k * 2, 0, C[4], 1 - k);
      dot(p, x + 1 + k * 2, 0, C[4], 1 - k);
    }
  }

  // plus signs and tiny hearts float up round the body, sway, and pop
  const RISERS = [
    [-10, -10, 0.4, PLUS_BIG],
    [11, -14, 0.44, PLUS_BIG],
    [1, -31, 0.5, PLUS_BIG],
    [-12, -20, 0.54, HEART],
    [9, -25, 0.58, HEART],
    [-6, -29, 0.62, PLUS],
    [13, -6, 0.64, PLUS],
    [-2, -38, 0.68, HEART],
  ];
  RISERS.forEach(([x0, y0, t0, rows], i) => {
    const r = rng(seed, i, 4),
      life = Math.min(r.range(0.42, 0.5), 1.08 - t0),
      age = t - t0;
    if (age < 0 || age > life + 0.1) return;
    const heart = rows === HEART,
      rise = r.range(10, 15);
    const x = x0 + Math.sin(age * 9 + i) * 1.2,
      y = y0 - rise * ease.outCubic(Math.min(1, age / life));
    if (age < life) {
      const grow = ease.outBack(clamp(age / 0.1), 2.5);
      if (grow < 0.6) dot(p, x, y, WHITE);
      else icon(p, rows, x, y, heart ? K[3] : C[4], heart ? K[2] : C[2]);
    } else {
      // the pop: four flecks fly off the corners
      const k = (age - life) / 0.1;
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        dot(p, x + dx * (2 + k * 3), y + dy * (2 + k * 3), k < 0.5 ? WHITE : heart ? K[4] : C[4], 1.2 - k);
    }
  });
}
