// Adapted from pixelfx arcane/magic-circle-cast (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The column of light (banded across, pulses and halos climbing it, glints thrown off, a ring shocking out across
// the floor) is adapted from Sprite Fusion's open-source holy light
// (https://www.spritefusion.com/pixel-art-vfx/holy-light), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, band, burst, clamp, ease, fit, flare, fly, noise2, seg, smooth, wrap } from '../_core.js';
import { bayer } from '../_lib/arcane.js';

// 파티 결성: the circle lies on the floor under the meeting group (plane px; the floor squashes depth by SY).
// Two outer rings with a band of rune ticks between them, an inner ring holding a triangle (a party of three or
// more), then the flash and a short column of light that pops up and breaks into glints.
const R = 44,
  R2 = 36,
  RI = 22,
  SY = 0.3,
  NT = 12,
  TOP = 36,
  CW = 3.4;
const PEN = [0, 0.36],
  PEN2 = [0.06, 0.42],
  INNER = [0.22, 0.5],
  TRI = [0.42, 0.66],
  TICKS = [0.5, 0.84];
const POWER = 0.8,
  FLASH = 0.92,
  BREAK = 1.17,
  WIPE = [1.2, 1.46],
  WIPE2 = [1.2, 1.42],
  WIPE3 = [1.17, 1.34];
const LAST = 1.55,
  END = 1.6;

export const meta = {
  name: 'Party cast',
  desc: 'A meeting group gathers: a magic circle draws itself on the floor under it, rune ticks light one by one, a flash, and a short column of light pops up and breaks into glints. Lavender, 1.6 s, under the people.',
  tags: ['aura', 'meeting', 'party', 'circle', 'rune', 'cast', 'one-shot'],
  size: [96, 56],
  origin: [48, 40],
  duration: END,
  loop: false,
  fps: 15,
  bg: 'ground',
  options: { palette: DEN.lavender, seed: 6 },
  den: { surface: 'town', anchor: 'free', depth: 'under', from: 'arcane/magic-circle-cast' },
};

const gap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// the outer rings are drawn from the front round both sides to the back; the inner ring from the back all round
const outerAt = (g, w) => w[0] + (gap(g, Math.PI / 2) / Math.PI) * (w[1] - w[0]);
const innerAt = (g) => INNER[0] + (wrap(g + Math.PI / 2, TAU) / TAU) * (INNER[1] - INNER[0]);
const tickAngle = (k) => Math.PI / 2 + ((k + 0.5) * TAU) / NT;
const tickLit = (k) => TICKS[0] + (k * (TICKS[1] - TICKS[0])) / (NT - 1);
const onFloor = (g, r) => [Math.cos(g) * r, Math.sin(g) * r * SY];

// the triangle inside the inner ring, drawn edge by edge
const TRI_PTS = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6].map((a) => [
  Math.cos(a) * RI,
  Math.sin(a) * RI,
]);
const EDGES = [0, 1, 2].map((k) => ({
  p0: TRI_PTS[k],
  p1: TRI_PTS[(k + 1) % 3],
  t0: TRI[0] + (k * (TRI[1] - TRI[0])) / 3,
  dur: (TRI[1] - TRI[0]) / 3,
}));

// how bright the drawn circle burns: a settled violet while it's drawn and the ticks light, white just before and
// after the flash, cooling back to violet before it is wiped away
function level(t) {
  if (t < POWER) return 0.5;
  if (t < FLASH) return 0.5 + 0.4 * smooth(POWER, FLASH, t);
  if (t < FLASH + 0.07) return 1.2;
  return 0.9 - 0.4 * smooth(BREAK - 0.08, WIPE[0], t);
}

// a settled line is a mid violet that reads on any floor; a burning one is white with a violet rim beside it
const lineCol = (C, lvl, age) => (age < 0.06 || lvl > 1 ? C[6] : age < 0.16 || lvl > 0.75 ? C[5] : C[3]);
const rimA = (lvl) => (lvl > 1 ? 0.5 : 0.36);
// the wipe that takes the circle away: from the back round both sides to the front (the inner ring goes first)
const wipeAt = (g, w = WIPE) => w[0] + (1 - gap(g, Math.PI / 2) / Math.PI) * (w[1] - w[0]);
const live = (t, when, g, w = WIPE) => t >= when && t < wipeAt(g, w);

// a star glint: sparkle's cross with a small light, so many of them stay cheap and soft on a pastel floor
function glint(p, C, x, y, arm, k = 0.15) {
  const n = Math.round(arm),
    X = Math.floor(x),
    Y = Math.floor(y);
  if (n < 1) return;
  for (let d = 1; d <= n; d++) {
    const c = d > n * 0.6 ? C[4] : C[6];
    p.px(X + d, Y, c);
    p.px(X - d, Y, c);
    p.px(X, Y + d, c);
    p.px(X, Y - d, c);
  }
  if (n >= 3)
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      p.px(X + dx, Y + dy, C[5]);
  p.px(X, Y, C[6]);
  if (k > 0) p.glow(x, y, 2 + n, C[5], k);
}

// where a pen is at time tb (glitter is shed from there), or null
function penAt(tb, r) {
  if (tb > PEN[0] && tb < PEN[1] && (tb < INNER[0] || r.chance(0.5)))
    return onFloor(Math.PI / 2 + r.sign() * seg(tb, PEN[0], PEN[1]) * Math.PI, R);
  if (tb > INNER[0] && tb < INNER[1]) return onFloor(-Math.PI / 2 + seg(tb, INNER[0], INNER[1]) * TAU, RI);
  for (const e of EDGES)
    if (tb >= e.t0 && tb < e.t0 + e.dur) {
      const s = (tb - e.t0) / e.dur;
      return [e.p0[0] + (e.p1[0] - e.p0[0]) * s, (e.p0[1] + (e.p1[1] - e.p0[1]) * s) * SY];
    }
  return null;
}

// a ring lying on the floor, 1 px at any size: col(g) its color at angle g (0: not there). With rim > 0 it draws
// only a translucent rim on both sides of the line instead, so a pale line still reads on a pale floor.
function ring(p, r, col, rim = 0, rc = 0, bright = () => true) {
  const ry = r * SY;
  p.shade(-r - 2, -ry - 2, r + 2, ry + 2, (x, y, _out) => {
    const nx = x / r,
      ny = y / ry,
      d = Math.hypot(nx, ny);
    if (d < 1e-6) return;
    const dp = Math.abs(d - 1) / (Math.hypot(nx / r, ny / ry) / d);
    if (dp > (rim ? 1.5 : 0.5) || (rim && dp <= 0.5)) return;
    const c = col(Math.atan2(ny, nx));
    if (!c) return;
    if (!rim) return c;
    if (bright(c)) p.blend(x, y, rc, rim);
  });
}

// the same rim beside a straight line
function rimLine(p, xa, ya, xb, yb, keep, a, c) {
  const dx = xb - xa,
    dy = yb - ya,
    L2 = dx * dx + dy * dy || 1e-9;
  p.shade(Math.min(xa, xb) - 2, Math.min(ya, yb) - 2, Math.max(xa, xb) + 2, Math.max(ya, yb) + 2, (x, y) => {
    const u = clamp(((x - xa) * dx + (y - ya) * dy) / L2),
      d = Math.hypot(xa + dx * u - x, ya + dy * u - y);
    if (d <= 0.6 || d > 1.5 || !keep(u)) return;
    p.blend(x, y, c, a);
  });
}

function circle(p, C, t) {
  if (t >= WIPE[1]) return;
  const lvl = level(t),
    ra = rimA(lvl);
  // from the moment the ticks start to light, two sparks of light chase round the outer ring, faster and faster
  const run = t > TICKS[0] && t < BREAK ? (t - TICKS[0]) * 6 + (t - TICKS[0]) ** 2 * 8 : null;
  const chase =
    run === null ? null : (g) => gap(g, Math.PI / 2 + run) < 0.22 || gap(g, -Math.PI / 2 + run) < 0.22;
  const rings = [
    [R, (g) => outerAt(g, PEN), chase, WIPE],
    [R2, (g) => outerAt(g, PEN2), null, WIPE2],
    [RI, innerAt, null, WIPE3],
  ];
  const col = (when, hot, w) => (g) =>
    !live(t, when(g), g, w) ? 0 : hot && hot(g) ? C[6] : lineCol(C, lvl, t - when(g));
  // the triangle, a pen running each edge
  const edges = [];
  for (const e of EDGES) {
    const s = clamp((t - e.t0) / e.dur);
    if (s <= 0) continue;
    const P = (u) => [e.p0[0] + (e.p1[0] - e.p0[0]) * u, (e.p0[1] + (e.p1[1] - e.p0[1]) * u) * SY];
    const keep = (q) => {
      const [x, y] = P(q * s);
      return t < wipeAt(Math.atan2(y / SY, x), WIPE3);
    };
    edges.push({ e, s, P, keep });
  }
  // rims first, lines over them
  const hot = (c) => c === C[5] || c === C[6];
  for (const [r, when, h, w] of rings) ring(p, r, col(when, h, w), ra, C[3], hot);
  for (const { e, s, P, keep } of edges)
    rimLine(
      p,
      ...P(0),
      ...P(s),
      (q) => keep(q) && hot(lineCol(C, lvl, t - (e.t0 + q * s * e.dur))),
      ra,
      C[3],
    );
  for (const [r, when, hot, w] of rings) ring(p, r, col(when, hot, w));
  for (const { e, s, P, keep } of edges)
    p.line(
      ...P(0),
      ...P(s),
      (q) => lineCol(C, lvl, t - (e.t0 + q * s * e.dur)),
      (q) => (keep(q) ? 1 : 0),
    );
}

// the rune ticks across the band between the outer rings: dim when the pens pass, lit one by one round the circle,
// gone when the wipe passes
function ticks(p, C, t) {
  const lvl = level(t),
    white = t >= FLASH && t < FLASH + 0.07;
  for (let k = 0; k < NT; k++) {
    const g = tickAngle(k),
      when = outerAt(g, PEN2) + 0.03;
    if (!live(t, when, g)) continue;
    const lit = t - tickLit(k);
    const [x0, y0] = onFloor(g, R2 + 1.6),
      [x1, y1] = onFloor(g, R - 1.6);
    const c = lit < 0 ? C[3] : lit < 0.07 || white || lvl > 0.85 ? C[6] : C[5];
    p.line(x0, y0, x1, y1, c);
    if (lit >= 0 && lit < 0.14) glint(p, C, (x0 + x1) / 2, (y0 + y1) / 2 - 1, 3 - lit * 16, 0.2);
  }
}

// the pens: white points running round, writing light
function pens(p, C, t) {
  const pen = (x, y) => glint(p, C, x, y, 2, 0.15);
  // the pens are born at the front of the circle in a little spark
  if (t < 0.1) glint(p, C, 0, R * SY - 1, 2 * (1 - t / 0.1) + 1, 0.3 * (1 - t / 0.1));
  if (t > PEN[0] && t < PEN[1])
    for (const s of [-1, 1]) pen(...onFloor(Math.PI / 2 + s * seg(t, PEN[0], PEN[1]) * Math.PI, R));
  if (t > PEN2[0] && t < PEN2[1])
    for (const s of [-1, 1]) p.px(...onFloor(Math.PI / 2 + s * seg(t, PEN2[0], PEN2[1]) * Math.PI, R2), C[6]);
  if (t > INNER[0] && t < INNER[1]) pen(...onFloor(-Math.PI / 2 + seg(t, INNER[0], INNER[1]) * TAU, RI));
  for (const e of EDGES)
    if (t > e.t0 && t < e.t0 + e.dur) {
      const s = (t - e.t0) / e.dur;
      pen(e.p0[0] + (e.p1[0] - e.p0[0]) * s, (e.p0[1] + (e.p1[1] - e.p0[1]) * s) * SY);
    }
  // the wipe: two small sparks running from the back round to the front, taking the circle with them
  if (t > WIPE[0] && t < WIPE[1])
    for (const s of [-1, 1]) {
      const g = -Math.PI / 2 + s * seg(t, WIPE[0], WIPE[1]) * Math.PI;
      glint(p, C, ...onFloor(g, R), 1, 0.12);
    }
  if (t > WIPE3[0] && t < WIPE3[1])
    for (const s of [-1, 1])
      p.px(...onFloor(-Math.PI / 2 + s * seg(t, WIPE3[0], WIPE3[1]) * Math.PI, RI), C[6]);
}

// glitter the pens shed as they write: specks that float up and wink out
function glitter(p, C, t, S) {
  burst(46, S * 31 + 1, (r) => {
    const tb = r.range(PEN[0], TRI[1]),
      life = r.range(0.2, 0.4),
      at0 = penAt(tb, r),
      vx = r.range(-10, 10),
      vy = r.range(-26, -8);
    const age = t - tb;
    if (!at0 || age < 0 || age >= life) return;
    const [x, y] = fly(at0[0], at0[1] - 1, vx, vy, age, 0, 2.5),
      k = 1 - age / life;
    p.dot(x, y, k > 0.55 ? C[6] : C[5], k < 0.35 ? k / 0.35 : 1);
  });
}

// gathering: light rushes in along the floor to the heart of the circle
function gather(p, C, t, S) {
  burst(16, S * 31 + 2, (r) => {
    const tb = r.range(0.72, FLASH - 0.12),
      T = r.range(0.1, 0.14),
      g = r.range(0, TAU),
      D = r.range(R * 0.7, R);
    const age = t - tb;
    if (age < 0 || age >= T) return;
    const [sx, sy] = onFloor(g, D),
      u = ease.inQuad(age / T),
      u0 = ease.inQuad(Math.max(0, age - 0.035) / T);
    p.line(sx * (1 - u0), sy * (1 - u0) - 1, sx * (1 - u), sy * (1 - u) - 1, C[5], 0.85);
    p.px(sx * (1 - u), sy * (1 - u) - 1, C[6]);
  });
}

// the shock of the flash running out across the floor
function shock(p, C, t) {
  const k = (t - FLASH) / 0.3;
  if (k < 0 || k >= 1) return;
  band(
    p,
    0,
    0,
    R * (0.35 + 0.66 * ease.outCubic(k)),
    SY,
    Math.max(1, 3 * (1 - k)),
    1.1 - k,
    [C[3], C[4], C[5], C[6]],
    () => true,
    k < 0.25,
  );
}

// the column of light: shoots up at the flash, holds with pulses climbing it, breaks apart into glints
function column(p, C, t, S) {
  if (t < FLASH || t > BREAK + 0.3) return;
  const u = t - FLASH,
    brk = clamp((t - BREAK) / 0.24),
    fade = 1 - smooth(BREAK + 0.08, BREAK + 0.3, t);
  if (fade <= 0) return;
  const top = -Math.min(39, TOP * ease.outBack(clamp(u / 0.12), 2));
  const w = t < BREAK ? CW * (1 + 0.5 * Math.exp(-u * 12)) : CW * (1 - 0.6 * ease.outCubic(brk));
  // white core, pale body, a violet rim so it reads on a pale floor too
  const COL = [C[6], C[5], C[4], C[3]];
  for (let y = 1; y >= Math.ceil(top); y--) {
    const h = -y,
      tip = clamp((y - top) / 9),
      ww = w * (1 + 0.3 * Math.exp(-Math.max(0, h) / 2.5)) * Math.sqrt(tip);
    const pulse = (((h * 0.06 - u * 3.2) % 1) + 1) % 1 < 0.12 ? 1 : 0;
    for (let x = Math.floor(-ww - 1); x <= Math.ceil(ww); x++) {
      const q = Math.abs(x + 0.5) / Math.max(0.5, ww);
      if (q > 1.15) continue;
      if (brk > 0 && noise2(x * 0.45, h * 0.16 - (t - BREAK) * 9, S) * 0.5 + 0.5 < brk * 1.3 - 0.12) continue;
      let lv = q < 0.35 ? 0 : q < 0.7 ? 1 : q < 0.95 ? 2 : 3;
      lv = u < 0.067 ? 0 : Math.max(0, lv - pulse);
      // only the fading crown and the last moments dither
      const a = fade * (tip < 1 ? 0.35 + 0.65 * tip : 1);
      if (a < 1 && a <= bayer(x, y)) continue;
      p.px(x, y, COL[lv]);
    }
  }
  // halos climbing it
  for (let i = 0; i < 2; i++) {
    const k = (t - (FLASH + 0.03 + i * 0.1)) / 0.32;
    if (k < 0 || k >= 1) continue;
    const rx = w * 1.6 * (1 + k * 0.3) + 1,
      yc = -2 - ease.outQuad(k) * (TOP - 8),
      n = Math.ceil(rx * 7);
    for (let j = 0; j < n; j++) {
      const g = (j / n) * TAU;
      p.dot(
        Math.cos(g) * rx,
        yc + Math.sin(g) * rx * 0.3,
        k < 0.3 ? C[6] : C[5],
        (1 - k) * fade * (Math.sin(g) < 0 ? 0.6 : 1),
      );
    }
  }
  p.glow(0, -3, 11, C[5], 0.3 * fade);
}

// the flash: a small white-hot flare at the heart of the circle
function flash(p, C, t) {
  if (t < FLASH || t >= FLASH + 0.2) return;
  const a = (t - FLASH) / 0.2;
  flare(p, 0, -4, 12 * Math.pow(1 - a, 1.5), 1 - a, C);
  p.glow(0, -5, 15, C[6], 0.32 * (1 - a));
}

// glints: thrown low across the floor at the flash, and left floating where the column broke
function glints(p, C, t, S) {
  const star = (x, y, size, k, ph) => {
    const tw = 0.6 + 0.4 * Math.sin(ph);
    if (size < 1.2) {
      if (tw * k > 0.25) p.px(x, y, tw > 0.8 ? C[6] : C[5]);
      return;
    }
    glint(p, C, x, y, size * tw * Math.min(1, k * 3), 0.15 * k * tw);
  };
  burst(14, S * 31 + 3, (r) => {
    const tb = FLASH + r.range(0, 0.04),
      life = r.range(0.3, 0.5),
      age = t - tb,
      s = r.sign();
    const vx = s * r.range(40, 110),
      vy = -r.range(10, 50),
      size = r.range(0.8, 2.2),
      ph = r.range(0, TAU);
    if (age < 0 || age >= life) return;
    const [x, y] = fly(s * r.range(0, 6), -1, vx, vy, age, 120, 4);
    if (Math.abs(x) < 46 && y < 14) star(x, Math.min(y, 0), size, 1 - age / life, ph + age * 30);
  });
  // the wipe leaves a few glints rising off the floor where the circle was
  burst(18, S * 31 + 5, (r) => {
    const u = r.next(),
      tb = WIPE[0] + u * (WIPE[1] - WIPE[0]),
      life = Math.min(r.range(0.14, 0.26), LAST - tb),
      age = t - tb;
    const [x0, y0] = onFloor(-Math.PI / 2 + r.sign() * u * Math.PI, r.chance(0.7) ? R : RI);
    const vx = r.range(-6, 6),
      vy = -r.range(14, 34),
      size = r.range(0.6, 1.8),
      ph = r.range(0, TAU);
    if (age < 0 || age >= life) return;
    const [x, y] = fly(x0, y0 - 1, vx, vy, age, 0, 3);
    star(x, y, size, 1 - age / life, ph + age * 30);
  });
  burst(20, S * 31 + 4, (r) => {
    const tb = BREAK + r.range(0, 0.16),
      life = Math.min(r.range(0.2, 0.38), LAST - tb),
      age = t - tb;
    const x0 = r.range(-1, 1) * CW,
      y0 = -r.range(3, TOP - 4),
      vx = r.range(-10, 10),
      vy = -r.range(8, 30);
    const size = r.range(0.6, 2),
      ph = r.range(0, TAU);
    if (age < 0 || age >= life) return;
    const [x, y] = fly(x0, y0, vx, vy, age, 0, 2);
    star(x, Math.max(-38, y), size, 1 - age / life, ph + age * 26);
  });
}

export function draw(p, t, o) {
  if (t >= END) return;
  const C = fit(o.palette, 7),
    S = o.seed;
  shock(p, C, t);
  circle(p, C, t);
  ticks(p, C, t);
  pens(p, C, t);
  glitter(p, C, t, S);
  gather(p, C, t, S);
  column(p, C, t, S);
  flash(p, C, t);
  glints(p, C, t, S);
}
