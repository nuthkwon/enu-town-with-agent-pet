// Adapted from pixelfx holy/holy-pillar (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The feather burst follows pixelfx holy/feather-burst (same licence); its rocking feathers come from holy/_lib.
//
// 단체 응원 (a raid: three colleagues cheered the same person within a minute). Two little clouds part with a
// glint, light pours down and slams into a pillar on the person (one white hero frame), rings climb the pillar,
// soft feathers burst out and rock down, the pillar folds to a thread and lifts away, the clouds close, and
// sparkles linger round the person and wink out.
//
// Bytes (a strip is at most 48 KB): the pillar is the same from row to row (rays are fixed stripes, light runs down
// them as short dashes) so it compresses, and light is carried in colour; the only glow is the hit's flash.
import {
  DEN,
  Lights,
  P,
  Particles,
  Rng,
  TAU,
  WHITE,
  ease,
  fit,
  lerp,
  seg,
  smooth,
  sparkle,
  clamp,
} from '../_core.js';
import { Feathers, oval } from '../_lib/holy.js';

export const meta = {
  name: 'Raid pillar',
  desc: 'Two clouds part, light slams down into a pillar on the person (white hero frame), rings climb it, soft feathers burst out and rock down, sparkles wink out; lemon and lavender, 2.2 s.',
  tags: ['spell', 'raid', 'pillar', 'light', 'feather', 'rings', 'cheer', 'one-shot'],
  size: [64, 96],
  origin: [32, 92],
  duration: 2.2,
  loop: false,
  fps: 15,
  bg: 'ground',
  options: { palette: DEN.lemon, accent: DEN.lavender, seed: 3 },
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'holy/holy-pillar' },
};

// where the sky breaks (the pillar's top), the floor ring's size and tilt, the person's chest, the pillar's width
const AY = -82;
const RX = 14;
const SY = 0.26;
const CHEST = -14;
const HW = 11;
// the story: the sky breaks, light pours, the hit (frame 3 at 15 fps), the hold, the fold to a thread, the light
// lifts away. Times sit a little before frame times so float sums of 1/15 never miss them.
const POUR = 0.095;
const HIT = 0.195;
const FOLD = 1.13;
const SHUT = 1.36;
const LIFT = 1.53;
const RINGS = [0.26, 0.46, 0.66];
// the rays inside the pillar (share of the half-width) and when light runs down them
const RAYS = [
  { q: -0.6, ph: 0.1 },
  { q: -0.15, ph: 0.55 },
  { q: 0.3, ph: 0.3 },
  { q: 0.68, ph: 0.8 },
];

const NEAR = (g) => Math.sin(g) >= 0;
const FAR = (g) => Math.sin(g) < 0;
/** The person stands here: light over it stays thin so the face reads. */
const onPerson = (x, y) => Math.abs(x) < 10 && y > -30 && y < -1;

/**
 * A soft feather from its centre (x, y) along ang: a leaf of a vane, widest in the middle, a little curved, white
 * along its top edge, cream inside, a lavender underside, a lemon quill. k (0..1) shrinks it as it goes.
 */
function softFeather(p, x, y, ang, len, wid, k, C, A) {
  const L = len * (0.55 + 0.45 * k);
  const W = wid * (0.6 + 0.4 * k);
  if (L < 2) return p.px(x, y, C[5]);
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const x0 = x - (ca * L) / 2;
  const y0 = y - (sa * L) / 2;
  const pad = W + 1;
  p.shade(
    Math.min(x0, x0 + ca * L) - pad,
    Math.min(y0, y0 + sa * L) - pad,
    Math.max(x0, x0 + ca * L) + pad,
    Math.max(y0, y0 + sa * L) + pad,
    (px, py) => {
      const dx = px - x0;
      const dy = py - y0;
      const u = (dx * ca + dy * sa) / L;
      if (u < -0.05 || u > 1.05) return 0;
      // the vane curves a little, so it reads as a feather and not a dash
      const v = -dx * sa + dy * ca - 0.12 * L * (u - 0.5) ** 2 + 0.03 * L;
      const hw = (W / 2) * Math.pow(Math.max(0, Math.sin(Math.PI * clamp(u * 1.08))), 0.55);
      if (Math.abs(v) > hw + 0.3) return 0;
      if (u < 0.16) return C[3];
      if (v < -hw + 0.75) return WHITE;
      if (v > hw - 0.75) return A[3];
      return u > 0.8 ? A[5] : C[5];
    },
  );
}

/** A four-point wink with no glow: arms of n px, a white heart. */
function wink(p, x, y, n, c, tip) {
  const X = Math.round(x);
  const Y = Math.round(y);
  for (let d = 1; d <= n; d++) {
    const cc = d === n ? tip : c;
    p.px(X + d, Y, cc);
    p.px(X - d, Y, cc);
    p.px(X, Y + d, cc);
    p.px(X, Y - d, cc);
  }
  p.px(X, Y, WHITE);
}

export function create(o) {
  const C = fit(o.palette, 7);
  const A = fit(o.accent, 7);
  const R = new Rng(o.seed);
  const PUFF = fit(DEN.puff, 6);
  const ps = new Particles({ rng: R, ground: () => 0, sparks: [WHITE, C[5], C[3], C[2]] });
  const lights = new Lights();
  const feathers = new Feathers(R, 0);
  // the burst of feathers from round the person: thrown out and up, braking hard, then rocking down
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + ((i - 4) / 4) * 1.9 + R.range(-0.12, 0.12);
    const sp = R.range(36, 62);
    feathers.add({
      x: Math.cos(a) * 9,
      y: CHEST + Math.sin(a) * 9,
      vx: Math.cos(a) * sp * 0.8,
      vy: Math.sin(a) * sp * 0.85 - 8,
      a: a + R.range(-0.5, 0.5),
      len: R.range(6, 7.5),
      wid: R.range(2.6, 3.2),
      life: R.range(1.35, 1.7),
      delay: HIT + R.range(0, 0.04),
      sink: R.range(18, 28),
      amp: R.range(4, 7),
    });
  }
  // sparkles that linger round the person after the fold, each winking once, on an oval clear of the face
  const winks = Array.from({ length: 14 }, (_, i) => {
    // right side round from above the head (-1.35) to beside the knees (0.75); the left side mirrors it
    const g = R.range(-1.35, 0.75);
    const a = i % 2 ? g : Math.PI - g;
    const rr = R.range(0.95, 1.15);
    return { x: Math.cos(a) * 14 * rr, y: CHEST - 2 + Math.sin(a) * 17 * rr, i };
  }).map(({ x, y, i }) => ({
    x,
    y,
    t0: lerp(1.18, 1.86, i / 13) + R.range(-0.04, 0.04),
    life: R.range(0.22, 0.32),
    arm: R.range(2, 3.2),
    c: i % 3 === 0 ? A[4] : i % 3 === 1 ? C[4] : C[5],
  }));
  let t = 0;
  let hit = false;
  let shut = false;

  // how far the light has poured down, and how far it has lifted away at the end
  const frontY = (tt) => lerp(AY, 1, ease.inQuad(seg(tt, POUR, HIT)));
  const liftY = (tt) => lerp(1, AY, ease.inQuad(seg(tt, SHUT, LIFT)));
  // the pillar bulges at the hit, then folds to a thread
  const widthK = (tt) =>
    (tt >= HIT ? 1 + 0.3 * Math.exp(-(tt - HIT) / 0.08) : 1) *
    lerp(1, 0.06, ease.inOutCubic(seg(tt, FOLD, SHUT)));
  // where the two dashes of light running down a ray are now
  const dashes = (ph) => [0, 0.5].map((k) => AY + (((((t - HIT) / 0.55 + ph + k) % 1) + 1) % 1) * -AY);

  function pillar(p) {
    if (t < POUR || t > LIFT) return;
    const yEnd = Math.min(frontY(t), liftY(t));
    const hw = HW * widthK(t);
    const white = t >= HIT && t < HIT + 0.05;
    const warm = t >= HIT + 0.05 && t < HIT + 0.12;
    if (hw < 1.6) {
      // folded to a thread of light
      for (let y = Math.ceil(AY); y < yEnd; y++) {
        p.px(-1, y, C[3]);
        p.px(0, y, WHITE);
      }
      return;
    }
    const W = Math.ceil(hw) + 2;
    const rayAt = new Set(RAYS.map((r) => Math.round(r.q * hw - 0.5)));
    for (let y = Math.ceil(AY); y < yEnd; y++) {
      const top = smooth(AY - 1, AY + 8, y);
      const head = t < HIT && y > yEnd - 6;
      for (let x = -W; x < W; x++) {
        const e = hw - Math.abs(x + 0.5);
        if (e < -1.5) continue;
        if (white) {
          // the hero frame: white through the middle, cream and lemon at the sides
          if (e >= -0.5) p.px(x, y, e < 0.5 ? C[3] : Math.abs(x + 0.5) < hw * 0.72 ? WHITE : C[5]);
          continue;
        }
        if (e < -0.5) {
          // a soft haze just outside the pillar
          p.blend(x, y, C[4], 0.35 * top);
          continue;
        }
        if (e < 0.5) {
          p.dot(x, y, head ? WHITE : C[3], top);
          continue;
        }
        if (warm) {
          p.blend(x, y, Math.abs(x + 0.5) < hw * 0.6 ? WHITE : C[5], 0.65);
          continue;
        }
        const thin = onPerson(x + 0.5, y);
        if (head) p.blend(x, y, WHITE, 0.7 * top);
        else if (e < 1.5) p.blend(x, y, C[5], (thin ? 0.45 : 0.62) * top);
        else if (rayAt.has(x)) p.blend(x, y, WHITE, (thin ? 0.2 : 0.42) * top);
        else p.blend(x, y, C[5], (thin ? 0.06 : 0.14) * top);
      }
    }
    if (white || warm || t < HIT) return;
    // light runs down the rays and the edges as short bright dashes (kept off the face)
    for (const r of RAYS) {
      const x = Math.round(r.q * hw - 0.5);
      for (const Y of dashes(r.ph))
        for (let d = 0; d < 4; d++) {
          const y = Math.round(Y) - d;
          if (y < AY + 4 || y >= yEnd || (y > -31 && y < -5 && Math.abs(x) < 10)) continue;
          p.px(x, y, d === 0 ? WHITE : C[5]);
        }
    }
    for (const [x, ph] of [
      [-Math.ceil(hw - 0.5), 0.05],
      [Math.ceil(hw - 0.5) - 1, 0.6],
    ])
      for (const Y of dashes(ph))
        for (let d = 0; d < 5; d++) {
          const y = Math.round(Y) - d;
          if (y >= AY + 4 && y < yEnd) p.px(x, y, WHITE);
        }
  }

  // a little cloud: three lobes, a white top, a lavender-grey belly
  function cloud(p, cx, cy, s) {
    const lobes = [
      [-3.4, 0.7, 2.5],
      [0, -0.8, 3.4],
      [3.3, 0.8, 2.3],
    ].map(([x, y, r]) => [cx + x * s, cy + y * s, r * s]);
    const inside = (x, y) => lobes.some(([lx, ly, r]) => (x - lx) ** 2 + (y - ly) ** 2 <= r * r);
    p.shade(cx - 7 * s, cy - 5 * s, cx + 7 * s, cy + 4 * s, (x, y) => {
      if (!inside(x, y)) return 0;
      return !inside(x, y + 1.1) ? PUFF[2] : !inside(x, y - 1.1) ? WHITE : PUFF[4];
    });
  }

  // the sky breaks: two clouds part with a burst of light, hold apart, close again as the light lifts away
  function sky(p) {
    const part = ease.outBack(seg(t, 0.02, 0.16), 1.6) * (1 - ease.inOutCubic(seg(t, SHUT, LIFT + 0.06)));
    const off = 3 + 9 * part;
    const gone = ease.inBack(seg(t, LIFT + 0.08, LIFT + 0.32), 1.4);
    if (t < LIFT + 0.32) {
      cloud(p, -off - 4, AY - 3, 1 - 0.75 * gone);
      cloud(p, off + 4, AY - 2, 0.9 * (1 - 0.75 * gone));
    }
    // glints carry their light in colour: a glow here would cost more bytes than it shows on a pastel floor
    if (t > 0.04 && t < 0.2) sparkle(p, 0, AY - 2, 7 * Math.sin(Math.PI * seg(t, 0.04, 0.2)), WHITE, C[4], 0);
    if (t > LIFT && t < LIFT + 0.24) sparkle(p, 0, AY - 2, 5 * (1 - (t - LIFT) / 0.24), WHITE, C[4], 0);
  }

  // the floor ring: it burns round from the front at the hit, white, then lemon, cooling to lavender
  function floorRing(p) {
    if (t < HIT) return;
    const u = seg(t, HIT, HIT + 0.14);
    const out = 1 - smooth(SHUT - 0.15, SHUT + 0.35, t);
    const heat = 1 - smooth(HIT + 0.1, FOLD, t);
    if (out <= 0) return;
    const burnt = (g) =>
      Math.abs(((((g - Math.PI / 2 + Math.PI) % TAU) + TAU) % TAU) - Math.PI) <= u * Math.PI + 0.01;
    const col = (g) =>
      t < HIT + 0.07 ? WHITE : Math.sin(g) > 0.85 ? WHITE : heat > 0.5 ? C[4] : heat > 0.2 ? C[3] : A[3];
    oval(p, 0, 0, RX, RX * SY, col, out, burnt);
    oval(p, 0, 0, RX * 0.62, RX * 0.62 * SY, A[4], out * 0.85, burnt);
    for (let j = 0; j < 8; j++) {
      const g = t * 0.8 + (j * TAU) / 8;
      if (!burnt(g)) continue;
      p.dot(Math.cos(g) * RX * 0.81, Math.sin(g) * RX * 0.81 * SY, j % 2 ? A[4] : C[4], out);
    }
  }

  // rings that climb the pillar, near half bright, far half dim behind the person
  function rings(p) {
    RINGS.forEach((t0, i) => {
      const u = seg(t, t0, t0 + 0.62);
      if (u <= 0 || u >= 1 || t > SHUT) return;
      const y = Math.round(lerp(-3, AY + 20, ease.outCubic(u)));
      const rx = HW * widthK(t) + 2.5;
      const ry = rx * 0.3;
      const a = 1 - smooth(0.6, 1, u);
      oval(p, 0, y, rx, ry, i === 1 ? C[4] : A[4], a * 0.6, FAR);
      // the near half is a band two pixels thick: a bright top line and a lavender one under it
      oval(p, 0, y + 1, rx, ry, A[3], a, NEAR);
      oval(p, 0, y, rx, ry, (g) => (Math.abs(Math.cos(g)) < 0.32 ? WHITE : i === 1 ? C[4] : A[4]), a, NEAR);
    });
  }

  return {
    update(dt) {
      t += dt;
      // light gathers into the gap as the clouds part
      if (t < 0.12 && R.chance(0.5)) {
        const a = R.range(0, TAU);
        const d = R.range(10, 16);
        const T = R.range(0.1, 0.16);
        const v = ((d - 3) * 3) / (Math.exp(3 * T) - 1);
        ps.spawn(
          P.STREAK,
          Math.cos(a) * d,
          AY + Math.sin(a) * d * 0.6,
          -Math.cos(a) * v,
          -Math.sin(a) * v * 0.6,
          T,
          R.chance(0.5) ? C[5] : A[4],
        );
      }
      if (!hit && t >= HIT) {
        hit = true;
        lights.add(0, -12, 18, C[5], 0.3, 0.2);
        for (let i = 0; i < 14; i++) {
          const a = -Math.PI / 2 + R.range(-1.3, 1.3);
          const sp = R.range(50, 120);
          ps.spawn(P.SPARK, R.range(-3, 3), -1, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.2, 0.45));
        }
      }
      // the fold: a scatter of stars all along it
      if (!shut && t >= SHUT) {
        shut = true;
        for (let i = 0; i < 9; i++)
          ps.spawn(
            P.STAR,
            R.range(-5, 5),
            R.range(AY + 6, -34),
            R.range(-14, 14),
            R.range(-6, 6),
            R.range(0.35, 0.6),
            R.chance(0.5) ? WHITE : C[5],
            R.range(2, 3),
          );
      }
      ps.update(dt);
      feathers.update(dt);
      lights.update(dt);
    },
    draw(p) {
      pillar(p);
      sky(p);
      floorRing(p);
      rings(p);
      if (t >= HIT && t < HIT + 0.2) sparkle(p, 0, CHEST, 7 * (1 - (t - HIT) / 0.2), WHITE, C[4], 0.2);
      for (const w of winks) {
        const u = (t - w.t0) / w.life;
        if (u < 0 || u >= 1) continue;
        const n = Math.round(w.arm * Math.sin(Math.PI * u));
        if (n < 1) p.px(w.x, w.y, w.c);
        else wink(p, w.x, w.y - u * 2, n, w.c, A[3]);
      }
      for (const f of feathers.list) {
        if (f.delay > 0) continue;
        softFeather(p, f.x, f.y, f.a, f.len, f.wid, Math.min(1, f.life / 0.4, f.age / 0.05), C, A);
      }
      // sparks and stars without their glow (bytes), only the hit's own flash of light
      const k = p.lightK;
      p.lightK = 0;
      ps.draw(p);
      p.lightK = k;
      lights.draw(p);
    },
  };
}
