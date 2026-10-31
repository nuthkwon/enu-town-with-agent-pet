// Adapted from pixelfx impacts/shield-block (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// Mapping a lattice onto a dome by longitude and latitude, the ripple measured over its surface, the rim light
// and the glancing sparks are adapted from Sprite Fusion's open-source shield
// (https://www.spritefusion.com/pixel-art-vfx/shield), MIT License, Copyright (c) 2026 Hugo Duprez.
// The hex plates follow pixelfx scifi/force-field (same licence).
//
// A spell bounces off someone in focus or a meeting: a bubble of hex plates pops round them with a white flash
// where the spell lands (upper right; mirror it for a caster on the left), a ripple runs over the bubble from
// there, sparks glance off, then the bubble blinks out plate by plate, motes lifting off. Pure: a function of t.
import { DEN, Rng, WHITE, clamp, ease, fit, rand, seg, smooth } from '../_core.js';
import { spikes, star } from '../_lib/impacts.js';

export const meta = {
  name: 'Shield block',
  desc: 'A spell bounces off a shield: a hex-plated bubble pops round the person with a white flash, a ripple runs over it, sparks glance off, then it blinks out plate by plate; sky and lavender, 0.6 s.',
  tags: ['spell', 'shield', 'block', 'bubble', 'hex', 'ripple', 'focus', 'one-shot'],
  size: [48, 56],
  origin: [24, 48],
  duration: 0.6,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.sky, accent: DEN.lavender, seed: 12 },
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'impacts/shield-block' },
};

// the bubble: centre height, radius, how much we look down on it, hex plates per radian (and their stretch)
const CY = -15;
const RAD = 18.5;
const SA = 0.22;
const CA = Math.sqrt(1 - SA * SA);
const G = 3.7;
const KY = 1.12;
// where the spell lands (longitude from facing us, latitude up), and when the plates start to blink out
const HIT = { lon: 0.85, lat: 0.55 };
const GONE = 0.24;
const S3 = Math.sqrt(3);
// the canvas, so glancing sparks are clipped to it
const X0 = -24;
const X1 = 23;
const Y0 = -48;
const Y1 = 7;

/** The pointy-top hex plate under grid point (gx, gy): its axial coordinates. */
function cell(gx, gy) {
  const fq = (S3 / 3) * gx - gy / 3;
  const fr = (2 / 3) * gy;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return q * 1000 + r;
}

/** A point of the bubble (longitude, latitude) on screen: [x, y, facing]. */
function project(R, lon, lat) {
  const X = Math.cos(lat) * Math.sin(lon);
  const Y = Math.sin(lat);
  const Z = Math.cos(lat) * Math.cos(lon);
  return [R * X, CY - R * (Y * CA - Z * SA), Y * SA + Z * CA];
}

/** The front of the bubble at radius R: per pixel its normal, plate, whether it is a seam, how near the rim. */
const shells = new Map();
function shell(R) {
  const key = Math.round(R * 4);
  if (shells.has(key)) return shells.get(key);
  const N = Math.ceil(R) + 1;
  const at = (x, y) => {
    const u = (x + 0.5) / R;
    const vy = -(y + 0.5 - CY) / R;
    const q = u * u + vy * vy;
    if (q > 1) return null;
    const vz = Math.sqrt(1 - q);
    const Y = vy * CA + vz * SA;
    const Z = -vy * SA + vz * CA;
    const lon = Math.atan2(u, Z);
    const lat = Math.asin(clamp(Y, -1, 1));
    return { x, y, X: u, Y, Z, lat, id: cell(lon * G, lat * G * KY), sil: (1 - Math.sqrt(q)) * R };
  };
  const list = [];
  for (let y = Math.floor(CY - N); y <= Math.ceil(CY + N); y++)
    for (let x = -N; x <= N; x++) {
      const c = at(x, y);
      if (!c) continue;
      const rgt = at(x + 1, y);
      const dn = at(x, y + 1);
      c.seam = (rgt && rgt.id !== c.id) || (dn && dn.id !== c.id);
      list.push(c);
    }
  shells.set(key, list);
  return list;
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const A = fit(o.accent, 7);
  const S = o.seed;
  // the bubble pops in with an overshoot, a little boing as the spell lands
  const R = RAD * (0.86 + 0.14 * ease.outBack(seg(t, 0, 0.1), 3));
  const [hx, hy] = project(R, HIT.lon, HIT.lat);
  const HN = [
    Math.cos(HIT.lat) * Math.sin(HIT.lon),
    Math.sin(HIT.lat),
    Math.cos(HIT.lat) * Math.cos(HIT.lon),
  ];
  const flash = t < 0.025;
  const front = 0.1 + 7.5 * t;
  const rippleK = 1 - smooth(0.1, 0.36, t);

  for (const c of shell(R)) {
    // each plate keeps its own clock for blinking out, and flashes white just before it goes
    const gone = GONE + 0.24 * rand(c.id, S, 7);
    if (t >= gone) continue;
    const blink = t > gone - 0.05;
    const d = Math.acos(clamp(c.X * HN[0] + c.Y * HN[1] + c.Z * HN[2], -1, 1));
    const rp = Math.exp(-(((d - front) / 0.2) ** 2)) * rippleK;
    const hot = t < 0.11 && d < 0.4;
    const rim = clamp(1 - c.Z);
    if (c.sil < 1.1) {
      // the rim: white where the light sits (top left), sky round the side, lavender underneath
      const lit = -c.X * 0.6 + c.Y * 0.8;
      p.px(
        c.x,
        c.y,
        flash || blink || hot || rp > 0.5 || lit > 0.55 ? WHITE : lit > 0 ? C[3] : lit > -0.55 ? C[2] : A[3],
      );
      continue;
    }
    if (c.seam) {
      // seams: faint where the bubble faces us (the face stays readable), solid toward the rim
      const I = rim * rim + 1.4 * rp;
      const col = flash || blink || hot || rp > 0.55 ? WHITE : I > 0.6 ? C[4] : C[3];
      if (I > 0.45 || flash || hot || blink) p.px(c.x, c.y, col);
      else p.blend(c.x, c.y, col, 0.2 + 0.8 * I);
      continue;
    }
    // the glass: almost clear face-on so the person shows, thicker toward the rim
    const a = flash ? 0.55 : 0.05 + 0.3 * rim ** 3 + 0.4 * rp + (hot ? 0.35 : 0) + (blink ? 0.25 : 0);
    p.blend(c.x, c.y, flash || hot ? WHITE : rp > 0.4 ? C[5] : C[4], clamp(a));
  }

  // where the bubble meets the floor
  const rf = Math.sqrt(Math.max(0, R * R - CY * CY));
  const seal = 1 - smooth(GONE + 0.12, GONE + 0.3, t);
  if (seal > 0)
    for (let x = -Math.floor(rf); x <= Math.floor(rf); x++) {
      const yy = Math.round(Math.sqrt(Math.max(0, 1 - (x / rf) ** 2)) * rf * 0.24);
      p.dot(x, yy, flash ? WHITE : Math.abs(x) < rf * 0.4 ? C[3] : C[2], seal);
    }

  // the spell's hit: a white star, then a smaller one as it bounces away
  const rs = new Rng(S * 31 + 7);
  const sp = spikes(rs, 8, -0.75, { len: [4, 6.5], w: [1, 1.5], fwd: 0.9, back: 0.3 });
  if (t < 0.03) star(p, hx, hy, sp, 1, 1, [A[3], C[4], WHITE, WHITE], 1, 1.8);
  else if (t < 0.08) star(p, hx, hy, sp, 1.25, 0.5, [C[3], C[4], C[5], WHITE], 1, 1.2);

  const clip = (x, y) => x >= X0 && x < X1 && y >= Y0 && y < Y1;
  // the spell itself ricochets off, up and away: a bright two-pixel head with a tail that shortens as it goes
  const rk = seg(t, 0.02, 0.2);
  if (rk > 0 && rk < 1) {
    const ra = -1.1;
    const head = 20 * ease.outCubic(rk);
    const tail = Math.max(0, head - 10 * (1 - rk));
    for (let d = tail; d <= head; d += 0.5) {
      const x = hx + 2 + Math.cos(ra) * d;
      const y = hy - 1 + Math.sin(ra) * d + 0.012 * d * d;
      const u = (head - d) / Math.max(1, head - tail);
      const c = u < 0.25 ? WHITE : u < 0.55 ? C[4] : u < 0.8 ? C[3] : A[3];
      if (clip(x, y)) p.px(x, y, c);
      if (u < 0.55 && clip(x, y + 1)) p.px(x, y + 1, u < 0.25 ? C[4] : C[3]);
    }
  }

  // sparks glance off the curve: up and away, braking, each a streak along its flight with a lavender tail
  const rn = new Rng(S * 13 + 1);
  for (let i = 0; i < 14; i++) {
    const a = -0.75 + rn.range(-1, 0.85);
    const v = rn.range(45, 100);
    const life = rn.range(0.2, 0.38);
    const t0 = i < 10 ? 0 : rn.range(0.03, 0.07);
    const age = t - t0;
    if (age < 0 || age >= life) continue;
    const drag = 6;
    const f = (1 - Math.exp(-drag * age)) / drag;
    const x = hx + Math.cos(a) * v * f;
    const y = hy + Math.sin(a) * v * f + 70 * age * age;
    const len = Math.min(5, 1.5 + v * Math.exp(-drag * age) * 0.04);
    const k = age / life;
    for (let j = 0; j <= len; j++) {
      const sx = x - Math.cos(a) * j;
      const sy = y - Math.sin(a) * j;
      if (!clip(sx, sy)) continue;
      p.px(sx, sy, j === 0 ? (k < 0.6 ? WHITE : C[4]) : j < 2 ? C[3] : j < 4 ? C[2] : A[2]);
    }
  }

  // as plates blink out, a few little motes lift off them
  for (let r = 0; r < 9; r++)
    for (let q = -8; q <= 8; q++) {
      const id = q * 1000 + r;
      if (rand(id, S, 3) > 0.3) continue;
      const gone = GONE + 0.24 * rand(id, S, 7);
      const age = t - gone;
      if (age < 0 || age > 0.16) continue;
      const lon = (S3 * (q + r / 2)) / G;
      const lat = (1.5 * r) / (G * KY);
      if (lat > 1.45 || Math.abs(lon) > 1.35) continue;
      const [mx, my, f] = project(R, lon, lat);
      if (f < 0.2) continue;
      const yy = my - age * 40;
      p.px(mx, yy, age < 0.06 ? WHITE : rand(id, S, 5) < 0.5 ? C[4] : A[4]);
      if (age < 0.08) p.px(mx, yy + 1, C[3]);
    }
}
