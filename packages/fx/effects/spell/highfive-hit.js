// Adapted from pixelfx impacts/parry (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The star's key frames and the spark spray are adapted from Sprite Fusion's open-source impact
// (https://www.spritefusion.com/pixel-art-vfx/impact), MIT License, Copyright (c) 2026 Hugo Duprez.
//
// ENU Den's 하이파이브: a comic slap of light, not a clash of blades. Two crescent swooshes cross into an X, a white
// four-point star and slap lines ring out, a ring snaps out and breaks into lemon-and-pink arcs, lemon sparks fan up
// and rain down onto the floor line at the feet.
import { DEN, Lights, P, Particles, Rng, TAU, WHITE, clamp, ease, fit, smooth } from '../_core.js';
import { brokenRing, star } from '../_lib/impacts.js';

export const meta = {
  den: { surface: 'town', anchor: 'chest', depth: 'over', from: 'impacts/parry' },
  name: 'High five',
  desc: '하이파이브: two crescent swooshes cross into an X, a white four-point star and slap lines ring out, a ring snaps out and breaks into arcs, lemon sparks fan up and rain down. Lemon and pink, 0.6 s, 48x48 on the chest.',
  tags: ['spell', 'high-five', 'slap', 'impact', 'comic', 'one-shot'],
  size: [48, 48],
  origin: [24, 24],
  duration: 0.6,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.lemon, accent: DEN.pink, seed: 11 },
};

const FPS = 20;
const FEET = 14; // the floor line, below the chest anchor
const SW_R = 24; // the swooshes' radius: crescents, so they read as motion and not as a mark
const SW_HALF = 0.56; // half their sweep (radians): arms of about 13 px either side of the centre

// one crescent swoosh through the centre, heading `dir` (radians), bulging to one side; u0..u1 is how much of its
// sweep is drawn; cols [inner rim, body, leading edge]
function swoosh(p, dir, bulge, w, u0, u1, cols, a = 1) {
  const nx = -Math.sin(dir) * bulge;
  const ny = Math.cos(dir) * bulge;
  const cx = nx * SW_R;
  const cy = ny * SW_R;
  const mid = Math.atan2(-cy, -cx);
  const a0 = mid - SW_HALF * bulge;
  const span = 2 * SW_HALF;
  const lo = Math.min(a0, a0 + span * bulge);
  const s0 = lo + span * (bulge > 0 ? u0 : 1 - u1);
  const s1 = lo + span * (bulge > 0 ? u1 : 1 - u0);
  p.arc(
    cx,
    cy,
    SW_R + w / 2,
    (u) => w * Math.sin(Math.PI * clamp(u)),
    s0,
    s1,
    (u, v) => (v > 0.72 ? cols[2] : v > 0.3 ? cols[1] : cols[0]),
    a,
  );
}

export function create(o) {
  const L = fit(o.palette, 7);
  const K = fit(o.accent, 7);
  const R = new Rng(o.seed);
  const ps = new Particles({ rng: R, ground: () => FEET, sparks: [WHITE, L[4], L[3], L[2]] });
  // a few pink sparks among the lemon ones
  const pink = new Particles({ rng: R, ground: () => FEET, sparks: [WHITE, K[4], K[3], K[2]] });
  const lights = new Lights();
  // a hard four-point star: long arms on the axes, short ones between
  const sp = [];
  for (let i = 0; i < 8; i++)
    sp.push({
      a: (i * Math.PI) / 4 + R.range(-0.04, 0.04),
      len: i % 2 ? R.range(3.5, 4.5) : i % 4 === 0 ? R.range(10, 11.5) : R.range(8, 9.5),
      w: i % 2 ? 0.9 : 1.7,
    });
  const segs = Array.from({ length: 6 }, (_, i) => ({
    a: (i / 6) * TAU + R.range(-0.1, 0.1),
    gap: R.range(0.55, 0.8),
    dr: R.range(0.1, 0.3),
  }));
  // slap lines: short comic strokes between the star's arms
  const slaps = Array.from({ length: 8 }, (_, i) => ({
    a: ((i + 0.5) / 8) * TAU + R.range(-0.12, 0.12),
    r: R.range(12, 14),
    L: R.range(4, 6),
  }));
  let T = 0;
  let fired = false;

  return {
    update(dt) {
      T += dt;
      const F = Math.floor(T * FPS + 1e-3);
      if (F >= 1 && !fired) {
        fired = true;
        lights.add(0, 0, 18, L[4], 0.3, 0.25);
        lights.add(0, 0, 7, WHITE, 0.3, 0.08);
        // the fan: sparks thrown up and out to both sides, arcing over and raining onto the floor line
        for (let i = 0; i < 20; i++) {
          const s = i % 2 ? 1 : -1;
          const a = -Math.PI / 2 + s * R.range(0.3, 1.3);
          const v = R.range(70, 150);
          const sys = i % 4 === 3 ? pink : ps;
          sys.spawn(
            P.SPARK,
            s * R.range(1, 3),
            0,
            Math.cos(a) * v,
            Math.sin(a) * v,
            R.range(0.32, 0.44),
            WHITE,
            1,
            i > 13 ? R.range(0.03, 0.08) : 0,
          );
        }
        for (let i = 0; i < 4; i++) {
          const a = R.range(0, TAU);
          const d = R.range(10, 16);
          ps.spawn(
            P.STAR,
            Math.cos(a) * d,
            Math.sin(a) * d * 0.8 - 3,
            0,
            -3,
            R.range(0.16, 0.24),
            i % 2 ? K[3] : L[4],
            R.range(1.4, 2.2),
            R.range(0.08, 0.22),
          );
        }
      }
      for (const sys of [ps, pink]) {
        sys.update(dt);
        sys.list = sys.list.filter((q) => q.x > -22 && q.x < 22 && q.y > -22 && q.y < 22);
      }
      lights.update(dt);
    },
    draw(p) {
      const F = Math.floor(T * FPS + 1e-3);
      const t = F / FPS;
      const lk = p.lightK;
      // the swooshes: a lemon X of crescents on frame 0, flashing white on frame 1, thinning to pink on frame 2
      const dirs = [
        [Math.PI / 4, 1],
        [(3 * Math.PI) / 4, -1],
      ];
      if (F === 0) for (const [d, b] of dirs) swoosh(p, d, b, 3.6, 0, 1, [K[3], L[3], WHITE]);
      else if (F === 1) for (const [d, b] of dirs) swoosh(p, d, b, 4.2, 0, 1, [K[3], WHITE, WHITE]);
      else if (F === 2) for (const [d, b] of dirs) swoosh(p, d, b, 2, 0.12, 1, [K[2], K[3], L[4]]);
      // the ring: rings out off the star and breaks into arcs that fly on and cool from lemon to pink
      const u = (t - 0.08) / 0.3;
      if (u >= 0 && u < 1) {
        const r = 7 + 9.5 * ease.outCubic(u);
        const brk = smooth(0.12, 0.6, u);
        const outer = u < 0.15 ? WHITE : u < 0.4 ? L[4] : u < 0.7 ? L[3] : K[3];
        const inner = u < 0.4 ? K[3] : K[2];
        brokenRing(
          p,
          0,
          0,
          r,
          Math.max(1, 2.4 * Math.pow(1 - u, 1.2)),
          segs,
          brk,
          outer,
          inner,
          u < 0.65 ? 1 : (1 - u) / 0.35,
          1,
          FEET + 4,
        );
        if (u < 0.5) p.glowRing(0, 0, r, 4, L[4], 0.22 * (1 - u / 0.5));
      }
      // slap lines snap outward on the hero frame and the next
      if (F === 1 || F === 2)
        for (const s of slaps) {
          const r0 = s.r + (F === 2 ? 4 : 0);
          const len = F === 2 ? s.L * 0.6 : s.L;
          const c = Math.cos(s.a);
          const sn = Math.sin(s.a);
          p.line(c * r0, sn * r0, c * (r0 + len), sn * (r0 + len), (v) => (v < 0.5 ? WHITE : K[3]));
        }
      p.lightK = lk * 0.6;
      ps.draw(p);
      pink.draw(p);
      p.lightK = lk;
      // the star: white, then bigger and lemon as it thins, then a glint
      if (F === 1) star(p, 0, 0, sp, 1, 1, [K[3], WHITE, WHITE, WHITE], 1, 2.4);
      else if (F === 2) star(p, 0, 0, sp, 1.25, 0.65, [K[2], L[3], L[5], WHITE], 1, 2.2);
      else if (F === 3) star(p, 0, 0, sp, 0.7, 0.35, [K[2], L[3], L[4], L[5]], 1, 1.4);
      if (F >= 1 && F <= 2) {
        p.glow(0, 0, 16, L[4], F === 1 ? 0.3 : 0.18);
        p.glow(0, 0, 6, WHITE, F === 1 ? 0.25 : 0.1);
      }
      lights.draw(p);
    },
  };
}
