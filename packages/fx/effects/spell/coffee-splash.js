// Adapted from pixelfx water/splash (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The droplet recipe (shaded beads with tails that fly, land and plink) is adapted from Sprite Fusion's open-source
// blood (https://www.spritefusion.com/pixel-art-vfx/blood), MIT License, Copyright (c) 2026 Hugo Duprez.
// 커피 메테오, the landing: played where spell/coffee-fall hits, as it ends. The crown's timing (it leaps up and
// falls back), its tearing fingers, the jet that bounces back and the plinks come from the water splash; the
// coffee cup of a crown, the foam and the puffs of steam are ours.
import { DEN, TAU, WHITE, clamp, ease, fit, noise, rand, rng, smooth } from '../_core.js';

export const meta = {
  name: 'Coffee splash',
  desc: 'The coffee meteor lands: a caramel splash crown tears into drops that arc out and plink down, a jet bounces back, foam bubbles pop, puffs of steam swirl up and thin, then the floor is clean.',
  tags: ['spell', 'coffee', 'splash', 'impact', 'drops', 'steam', 'one-shot'],
  size: [64, 48],
  origin: [32, 40],
  duration: 1.1,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.coffee, steam: DEN.puff, seed: 3 },
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'water/splash' },
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
const bl = (p, x, y, c, a) => {
  if (a > 0.01 && IN(x, y)) p.blend(x, y, c, a);
};
function line(p, x0, y0, x1, y1, c, a = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++)
    dot(p, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, typeof c === 'function' ? c(i / n) : c, a);
}

const SY = 0.42,
  G = 700,
  DRAG = 0.8,
  TEAR = 0.11,
  FINGERS = 7,
  LEAD = 0.03;

// the crown over time u: it leaps up in a few frames, flares out, then falls back
const height = (u) => 9.5 * ease.outCubic(clamp(u / 0.08)) * (1 - ease.inQuad(clamp((u - 0.1) / 0.26)));
const foot = (u) => 3 + 6 * ease.outCubic(clamp(u / 0.4));
const lip = (u) => foot(u) + height(u) * 0.35 + 2 * ease.outCubic(clamp(u / 0.2));
// the jet that bounces back up the middle once the crown has fallen
const JET = 0.27;
const jetH = (u) => 11 * (ease.outCubic(clamp(u / 0.1)) - ease.inQuad(clamp((u - 0.13) / 0.2)));

/** A coffee drop at (x, y) moving at (vx, vy): s 1 a pixel, 2 a shaded 2x2, 3 a round bead; a tail behind it. */
function bead(p, C, x, y, vx, vy, s, a = 1) {
  const sp = Math.hypot(vx, vy) || 1,
    ux = vx / sp,
    uy = vy / sp,
    tail = Math.min(4, sp * 0.012);
  if (tail >= 1)
    line(
      p,
      x - ux * (tail + 1),
      y - uy * (tail + 1),
      x - ux * 1.2,
      y - uy * 1.2,
      (u) => (u < 0.5 ? C[4] : C[3]),
      a,
    );
  const X = Math.floor(x),
    Y = Math.floor(y);
  if (s >= 3) {
    for (const [i, j, c] of [
      [0, -1, C[4]],
      [1, -1, C[4]],
      [-1, 0, C[4]],
      [0, 0, C[5]],
      [1, 0, C[3]],
      [0, 1, C[3]],
      [1, 1, C[3]],
      [-1, 1, C[4]],
    ])
      dot(p, X + i, Y + j, c, a);
    dot(p, X, Y, WHITE, a);
  } else if (s >= 2) {
    dot(p, X, Y, C[5], a);
    dot(p, X + 1, Y, C[3], a);
    dot(p, X, Y + 1, C[3], a);
    dot(p, X + 1, Y + 1, C[3], a);
  } else dot(p, X, Y, sp > 150 ? C[5] : C[4], a);
}

const DROPS = new Map();
/** Every drop of the splash, made once per seed: { t0, x, z, h, vx, vz, vh, s }. */
function dropsOf(seed) {
  if (DROPS.has(seed)) return DROPS.get(seed);
  const R = rng(seed, 77),
    out = [],
    phi = rand(seed, 5) * TAU;
  const add = (d) => {
    // keep every drop on the canvas: where it lands decides how far it may fly
    const tl = (d.vh + Math.sqrt(d.vh * d.vh + 2 * G * d.h)) / G,
      f = (1 - Math.exp(-DRAG * tl)) / DRAG;
    const lx = d.x + d.vx * f,
      lz = d.z + d.vz * f;
    if (Math.abs(lx) > 28) d.vx = (Math.sign(lx) * (28 - R.range(0, 4)) - d.x) / f;
    if (lz * SY > 6 || lz * SY < -6) d.vz = (Math.sign(lz) * (13 - R.range(0, 3)) - d.z) / f;
    out.push({ ...d, tl });
  };
  // the first fine spray, thrown up fast
  for (let i = 0; i < 7; i++) {
    const a = R.range(0, TAU),
      v = R.range(18, 40);
    add({
      t0: 0.01 + R.range(0, 0.03),
      x: Math.cos(a) * 3,
      z: Math.sin(a) * 3,
      h: R.range(1, 4),
      vx: Math.cos(a) * v,
      vz: Math.sin(a) * v,
      vh: R.range(100, 150),
      s: 1,
    });
  }
  // the beads on the finger tips tear off and arc away
  const h = height(TEAR),
    rt = lip(TEAR);
  for (let k = 0; k < FINGERS; k++) {
    const a = (k * TAU) / FINGERS + phi + R.range(-0.1, 0.1),
      L = h * R.range(0.22, 0.34),
      v = R.range(22, 40);
    add({
      t0: TEAR - LEAD,
      x: Math.cos(a) * (rt + L * 0.5),
      z: Math.sin(a) * rt,
      h: h + L + 1,
      vx: Math.cos(a) * v,
      vz: Math.sin(a) * v,
      vh: R.range(60, 110),
      s: R.chance(0.3) ? 3 : 2,
    });
  }
  // as the crown gives way its lip comes apart into drops
  for (let i = 0; i < 5; i++) {
    const u = R.range(0.14, 0.3),
      a = R.range(0, TAU),
      r = lip(u),
      v = R.range(14, 34);
    add({
      t0: u - LEAD,
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      h: Math.max(1, height(u) * R.range(0.6, 1)),
      vx: Math.cos(a) * v,
      vz: Math.sin(a) * v,
      vh: R.range(-5, 45),
      s: R.chance(0.35) ? 2 : 1,
    });
  }
  // the jet's tip pinches off into a bead that hangs, then drops back
  add({ t0: JET + 0.12 - LEAD, x: 0, z: 0.4, h: jetH(0.12) + 1, vx: R.range(-5, 5), vz: 0, vh: 40, s: 3 });
  DROPS.set(seed, out);
  return out;
}

/**
 * The crown, read at 1x: a cup of coffee thrown up round the hit. Its wall flares from the foot to a rolled lip,
 * lit on the left; through its open top the coffee inside shows; fingers with beads run on up off the lip
 * until they tear away. As it falls back the wall sinks and the lip breaks up.
 */
function crown(p, C, u, phi, seed) {
  const h = height(u);
  if (u < 0 || h < 0.7) return;
  const r0 = foot(u),
    rt = lip(u),
    white = u < 0.045;
  // the wall at level v (0 foot .. 1 lip): its centre line rises, its radius flares
  const rad = (v) => r0 + (rt - r0) * Math.pow(v, 2.2);
  const top = -h,
    lipRy = rt * SY;
  const inCup = (x, y) => {
    for (let i = 0; i <= 24; i++) {
      const v = i / 24,
        r = rad(v),
        cy = -h * v,
        dx = x / r,
        dy = (y - cy) / (r * SY);
      if (dx * dx + dy * dy <= 1) return v;
    }
    return -1;
  };
  const x0 = Math.floor(-rt - 1),
    x1 = Math.ceil(rt + 1),
    y0 = Math.floor(top - lipRy - 1),
    y1 = Math.ceil(r0 * SY + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!IN(x, y)) continue;
      const px = x + 0.5,
        py = y + 0.5,
        v = inCup(px, py);
      if (v < 0) {
        // a 1 px rim round the cup, caramel
        if (
          inCup(px + 1, py) >= 0 ||
          inCup(px - 1, py) >= 0 ||
          inCup(px, py + 1) >= 0 ||
          inCup(px, py - 1) >= 0
        )
          p.px(x, y, white ? C[4] : C[3]);
        continue;
      }
      if (white) {
        p.px(x, y, WHITE);
        continue;
      }
      // the open top: inside the lip ellipse the coffee shows, dark at the back, a white rolled lip round it
      const lx = px / rt,
        ly = (py - top) / lipRy,
        ld = Math.hypot(lx, ly);
      if (ld <= 1) {
        p.px(x, y, ld > 0.72 ? (ly > 0 ? (lx < 0.35 ? WHITE : C[5]) : C[4]) : ly < -0.1 ? C[2] : C[3]);
        continue;
      }
      // the wall: lit on the left, a pale streak where the sheet thins, shaded on the right
      const q = px / rad(v),
        pale = rand(Math.floor((q + 1) * 3.2 + phi * 2), seed) < 0.3;
      const gloss = q > -0.78 && q < -0.5;
      p.px(x, y, gloss ? (v > 0.3 && v < 0.6 ? WHITE : C[5]) : q > 0.55 ? C[3] : pale ? C[5] : C[4]);
    }
  // fingers: spikes running on up and out from the lip, a bead on each until it tears off
  const reach = 1 - smooth(TEAR, TEAR + 0.08, u);
  if (reach <= 0) return;
  for (let k = 0; k < FINGERS; k++) {
    const a = (k * TAU) / FINGERS + phi,
      c = Math.cos(a),
      sn = Math.sin(a);
    const L = h * (0.28 + 0.16 * rand(k, seed)) * reach,
      bx = c * rt,
      by = top + sn * lipRy;
    const tx = bx + c * L * 0.55,
      ty = by - L;
    if (L >= 1) line(p, bx, by, tx, ty, white ? WHITE : sn > 0 ? C[5] : C[4]);
    if (u > 0.035 && u < TEAR) bead(p, C, tx - 0.5, ty - 1.5, 0, -1, sn > 0 ? 2 : 1);
  }
}

/**
 * Puffs [x, y, r, g] (g 0 fresh .. 1 old) drawn as one soft cartoon cloud: white, shaded lilac on the lower
 * right, a 1 px lilac rim so it reads on the pale carpet; old puffs turn see-through.
 */
function cloud(p, S, puffs) {
  if (!puffs.length) return;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y, r] of puffs) {
    x0 = Math.min(x0, x - r - 1);
    x1 = Math.max(x1, x + r + 1);
    y0 = Math.min(y0, y - r - 1);
    y1 = Math.max(y1, y + r + 1);
  }
  x0 = Math.floor(x0) - 1;
  y0 = Math.floor(y0) - 1;
  x1 = Math.ceil(x1) + 1;
  y1 = Math.ceil(y1) + 1;
  // for every pixel once: the puff it sits deepest in (-1 for none) and how deep
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1,
    who = new Int16Array(w * h).fill(-1),
    depth = new Float32Array(w * h);
  puffs.forEach((q, i) => {
    for (let y = Math.floor(q[1] - q[2]); y <= Math.ceil(q[1] + q[2]); y++)
      for (let x = Math.floor(q[0] - q[2]); x <= Math.ceil(q[0] + q[2]); x++) {
        const d = 1 - Math.hypot(x + 0.5 - q[0], y + 0.5 - q[1]) / q[2],
          k = (y - y0) * w + (x - x0);
        if (d >= 0 && (who[k] < 0 || d > depth[k])) {
          who[k] = i;
          depth[k] = d;
        }
      }
  });
  const alpha = (g) => (g < 0.55 ? 1 : 1 - (g - 0.55) / 0.45);
  for (let y = y0 + 1; y < y1; y++)
    for (let x = x0 + 1; x < x1; x++) {
      if (!IN(x, y)) continue;
      const k = (y - y0) * w + (x - x0),
        cx = x + 0.5,
        cy = y + 0.5;
      if (who[k] >= 0) {
        const q = puffs[who[k]],
          d = depth[k],
          lit = q[0] - cx + (q[1] - cy),
          a = alpha(q[3]);
        const c = lit > q[2] * 0.25 ? WHITE : d < 0.3 && lit < -q[2] * 0.2 ? S[3] : S[4];
        if (a >= 1) p.px(x, y, c);
        else bl(p, x, y, c, a * 0.9);
        continue;
      }
      // a 1 px lilac rim round the cloud, darker on its shaded side
      let rim = null;
      for (const n of [k + 1, k - 1, k + w, k - w])
        if (who[n] >= 0 && (!rim || puffs[who[n]][3] < rim[3])) rim = puffs[who[n]];
      if (!rim) continue;
      const shade = cx - rim[0] + (cy - rim[1]) > 0;
      bl(p, x, y, shade ? S[2] : S[3], alpha(rim[3]) * (shade ? 0.95 : 0.8));
    }
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7),
    S = fit(o.steam, 6),
    seed = o.seed,
    phi = rand(seed, 5) * TAU,
    u = t + LEAD;

  // the puddle: it spreads at once, holds while the splash falls back, then soaks away
  const spread = ease.outCubic(clamp(u / 0.25)),
    soak = smooth(0.6, 1.02, t);
  const prx = (5 + 7 * spread) * (1 - soak),
    pry = prx * SY;
  if (prx >= 1) {
    const a = 1;
    for (let y = Math.floor(-pry - 1); y <= Math.ceil(pry + 1); y++)
      for (let x = Math.floor(-prx - 1); x <= Math.ceil(prx + 1); x++) {
        const dx = (x + 0.5) / prx,
          dy = (y + 0.5) / pry,
          wob = 1 + 0.08 * noise(Math.atan2(dy, dx) * 2.5 + 7, seed);
        const d = Math.hypot(dx, dy) / wob;
        if (d > 1) continue;
        const sheen = Math.hypot(dx + 0.3, dy + 0.35) < 0.35;
        const c = d > 0.82 ? (dy > 0 ? C[4] : C[3]) : sheen ? C[5] : C[4];
        dot(p, x, y, c, a);
      }
  }

  // the jet that bounces back up, with its bead pinching off at the top
  const ju = u - JET,
    jh = jetH(ju);
  if (ju > 0 && jh >= 0.8) {
    const top = -jh;
    for (let y = Math.floor(top); y <= 0; y++) {
      const v = clamp((y - top) / jh),
        w = 0.9 + 1.3 * v * v;
      for (let x = Math.floor(-w); x <= Math.ceil(w) - 1; x++) {
        const q = (x + 0.5) / w;
        if (Math.abs(q) > 1) continue;
        dot(p, x, y, q < -0.45 ? C[5] : q < 0.2 ? WHITE : q < 0.7 ? C[4] : C[3]);
      }
    }
    if (ju < 0.12) bead(p, C, 0, top - 1, 0, -1, 3);
  }

  // foam bubbles rising on the puddle and popping
  for (let i = 0; i < 7; i++) {
    const r = rng(seed, i, 9),
      t0 = r.range(0.2, 0.62),
      life = r.range(0.14, 0.26),
      age = t - t0;
    if (age < 0 || age > life + 0.06) continue;
    const bx = r.range(-0.75, 0.75) * prx,
      bz = r.range(-0.6, 0.6) * pry,
      rr = r.range(0.9, 1.7);
    if (age < life) {
      const R = rr * ease.outBack(clamp(age / 0.08));
      for (let j = 0; j < 12; j++) {
        const an = (j / 12) * TAU;
        dot(p, bx + Math.cos(an) * R, bz + Math.sin(an) * R - R, Math.sin(an) < 0 ? WHITE : C[5]);
      }
      dot(p, bx - R * 0.4, bz - R * 1.5, WHITE);
    } else {
      // the pop: four flecks flung off
      const k = (age - life) / 0.06;
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ])
        dot(p, bx + dx * (rr + 1 + k * 2), bz - rr + dy * (rr + 1 + k * 2), WHITE, 1 - k * 0.5);
    }
  }

  crown(p, C, u, phi, seed);

  // the drops in flight; where they come down, a white plink, a tiny ring and a spot that soaks away
  for (const d of dropsOf(seed)) {
    const tau = t - d.t0;
    if (tau < 0) continue;
    if (tau < d.tl) {
      const f = (1 - Math.exp(-DRAG * tau)) / DRAG,
        e = Math.exp(-DRAG * tau);
      const x = d.x + d.vx * f,
        z = d.z + d.vz * f,
        hh = d.h + d.vh * tau - 0.5 * G * tau * tau;
      bead(p, C, x, z * SY - hh, d.vx * e, d.vz * e * SY - (d.vh - G * tau), d.s);
      continue;
    }
    const f = (1 - Math.exp(-DRAG * d.tl)) / DRAG,
      x = d.x + d.vx * f,
      y = (d.z + d.vz * f) * SY,
      k = tau - d.tl;
    if (k < 0.05) dot(p, x, y - 1, WHITE);
    if (k < 0.14) {
      const rr = 1 + (2 + d.s) * (k / 0.14);
      for (let j = 0; j < 10; j++) {
        const an = (j / 10) * TAU;
        dot(
          p,
          x + Math.cos(an) * rr,
          y + Math.sin(an) * rr * SY,
          Math.sin(an) > 0 ? C[5] : C[4],
          1 - k / 0.14,
        );
      }
    }
    if (d.s > 1 && k < 0.22) {
      const a = 1 - smooth(0.1, 0.22, k);
      dot(p, x, y, C[4], a);
      dot(p, x + 1, y, C[5], a);
    }
  }

  // steam rolls out low over the floor from the hit, thinning
  const puffs = [];
  for (let i = 0; i < 6; i++) {
    const r = rng(seed, i, 4),
      life = r.range(0.3, 0.45),
      age = t - r.range(0, 0.05);
    if (age < 0 || age > life) continue;
    const side = i % 2 ? 1 : -1,
      v = r.range(60, 95),
      f = (1 - Math.exp(-5 * age)) / 5;
    const x = side * (r.range(5, 9) + v * f),
      y = -r.range(1, 3) - r.range(8, 16) * f - 10 * age;
    puffs.push([x, y, r.range(1.4, 2.2) + r.range(0.8, 1.6) * (age / life), 0.6 + 0.4 * (age / life)]);
  }
  cloud(p, S, puffs);

  // a swirl of steam off the coffee: little puffs rising in an S, leaning out, swelling and thinning. Two tall
  // columns at the sides frame whoever stands there; a short one in the middle stays low.
  const steam = [];
  const CURLS = [
    [-9.5, 0.18, 0.36, 0.5, 50, -1],
    [9.5, 0.24, 0.31, 0.5, 50, 1],
    [0.5, 0.3, 0.2, 0.24, 36, 0],
  ];
  CURLS.forEach(([x0, ts, span, L, vr, side], w) => {
    const ph = (w * TAU) / 3;
    for (let j = 0; j < 12; j++) {
      const te = ts + j * 0.05;
      if (te > ts + span) break;
      const age = t - te;
      if (age < 0 || age > L) continue;
      const g = age / L,
        x = x0 + side * age * 5 + Math.sin(age * 10 + ph + j * 0.9) * (0.5 + age * 3),
        y = -2.5 - age * vr;
      steam.push([x, y, 0.9 + 1.5 * Math.min(1, g * 1.6), 0.35 + 0.65 * g]);
    }
  });
  cloud(p, S, steam);

  // the hit itself: a flat white flash on the floor for the first frame, warm light for a moment
  if (t < 0.05) {
    for (let y = -3; y <= 3; y++)
      for (let x = -11; x <= 11; x++) {
        const d = Math.hypot((x + 0.5) / 11, (y + 0.5) / 3.4);
        if (d <= 1) dot(p, x, y, d < 0.75 ? WHITE : C[4], d < 0.75 ? 1 : 0.8);
      }
  }
  p.glow(0, -3, 18, C[5], 0.28 * (1 - smooth(0, 0.3, t)));
}
