// Adapted from pixelfx impacts/crit-hit (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The star, its key frames and the spark spray are adapted from Sprite Fusion's open-source impact
// (https://www.spritefusion.com/pixel-art-vfx/impact), MIT License, Copyright (c) 2026 Hugo Duprez.
//
// ENU Den's combo (a high five returned within 10 s): a comic critical-hit starburst between the two people, and
// never a word, number or score in it. A jagged two-tone star slams in white and overshoots, boils, snaps away into
// tumbling shards; a ring breaks into flying arcs; sparks streak; speed lines flick out; twinkles; then nothing.
import {
  B,
  Bits,
  DEN,
  Lights,
  P,
  Particles,
  Rng,
  TAU,
  WHITE,
  clamp,
  ease,
  fit,
  rand,
  smooth,
} from '../_core.js';
import { brokenRing } from '../_lib/impacts.js';

export const meta = {
  den: { surface: 'town', anchor: 'free', depth: 'over', from: 'impacts/crit-hit' },
  name: 'High five combo',
  desc: 'A returned high five: a jagged two-tone comic starburst slams in white and overshoots, boils, then snaps away into tumbling shards while a ring breaks into flying arcs, sparks streak and speed lines flick out. Coral and lemon, 0.8 s, 64x64, no words.',
  tags: ['spell', 'combo', 'high-five', 'crit', 'comic', 'burst', 'one-shot'],
  size: [64, 64],
  origin: [32, 32],
  duration: 0.8,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.coral, accent: DEN.lemon, seed: 3 },
};

const FPS = 20;
const N = 12; // spikes
const RT = 14; // tip radius at rest: big, yet clear of faces either side
// the star's key frames: scale and look per frame (w: white slam, 2: two-tone, f: paling, o: a hollow pop)
const KEYS = [
  [1.18, 'w'],
  [1.0, '2'],
  [1.07, '2'],
  [0.97, '2'],
  [1.03, '2'],
  [0.98, 'f'],
  [1.14, 'o'],
];

// the burst star: per pixel, the edge at each angle runs from spike tip to notch. Saturated colour only in lines
// and dots (a deep coral rim, a coral line inside it, halftone on the shaded lower right); the bodies stay pale: a
// peach band, a pale lemon inner star with an amber edge, a cream-white heart
function burst(p, s, look, rad, K, L) {
  const outer = RT * s;
  const M = N * 2;
  p.shade(-outer - 3, -outer - 3, outer + 3, outer + 3, (x, y) => {
    const d = Math.hypot(x, y);
    const u = ((((Math.atan2(y, x) + 0.13) / TAU) % 1) + 1) % 1;
    const i = Math.floor(u * M) % M;
    const f = u * M - Math.floor(u * M);
    const r = (rad[i] + (rad[(i + 1) % M] - rad[i]) * f) * outer;
    if (d > r + 1.2) return;
    if (look === 'w') return d > r - 0.2 ? K[3] : WHITE;
    if (look === 'o') return d > r - 1.2 ? (d > r - 0.2 ? K[3] : K[4]) : undefined;
    const fade = look === 'f';
    if (d > r - 0.2) return fade ? K[3] : K[1];
    if (d > r - 1.2) return fade ? K[4] : K[3];
    const inner = r * 0.6;
    if (d > inner + 0.8) {
      if (fade) return K[5];
      const shaded = x * 0.6 + y * 0.8 > outer * 0.15;
      return shaded && (Math.floor(x) + Math.floor(y) * 2) % 4 === 0 && Math.floor(y) % 2 === 0 ? K[3] : K[4];
    }
    if (d > inner) return fade ? L[3] : L[2];
    if (d < inner * 0.45) return fade ? L[5] : WHITE;
    return fade ? L[5] : L[4];
  });
}

export function create(o) {
  const K = fit(o.palette, 7);
  const L = fit(o.accent, 7);
  const R = new Rng(o.seed);
  const ps = new Particles({ rng: R, sparks: [WHITE, L[4], L[3], K[2]] });
  const bits = new Bits({});
  const lights = new Lights();
  const base = Array.from({ length: N * 2 }, (_, i) => (i % 2 ? R.range(0.5, 0.6) : R.range(0.84, 1.04)));
  const segs = Array.from({ length: 7 }, (_, i) => ({
    a: (i / 7) * TAU + R.range(-0.15, 0.15),
    gap: R.range(0.55, 0.85),
    dr: R.range(0.06, 0.24),
  }));
  const lines = Array.from({ length: 14 }, (_, i) => ({
    a: ((i + R.range(0.2, 0.8)) / 14) * TAU,
    r: R.range(0.92, 1.05),
    L: R.range(5, 8),
  }));
  let T = 0;
  let fired = -1;

  const shards = (n, r0, sp) => {
    for (let i = 0; i < n; i++) {
      const a = R.range(0, TAU);
      const v = R.range(sp[0], sp[1]);
      bits.add({
        kind: B.SHARD,
        x: Math.cos(a) * r0,
        y: Math.sin(a) * r0,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 25,
        g: 0.28,
        drag: 2.4,
        life: R.range(0.32, 0.5),
        a: R.range(0, TAU),
        va: R.range(-22, 22),
        s: R.range(3, 5),
        c: R.pick([L[2], L[3], K[2], K[3]]),
      });
    }
  };

  return {
    update(dt) {
      T += dt;
      const F = Math.floor(T * FPS + 1e-3);
      if (F >= 0 && fired < 0) {
        fired = 0;
        lights.add(0, 0, 30, L[4], 0.32, 0.35);
        lights.add(0, 0, 12, WHITE, 0.3, 0.1);
        for (let i = 0; i < 26; i++) {
          const a = R.range(0, TAU);
          const v = R.range(130, 220);
          ps.spawn(
            P.SPARK,
            Math.cos(a) * 5,
            Math.sin(a) * 5,
            Math.cos(a) * v,
            Math.sin(a) * v - 20,
            R.range(0.14, 0.24),
            WHITE,
            1,
            R.chance(0.3) ? R.range(0, 0.05) : 0,
          );
        }
        shards(5, 8, [80, 130]);
      }
      if (F >= 6 && fired < 6) {
        fired = 6;
        // the star snaps away: its spikes fly off as shards, glints pop round where it was
        shards(9, 12, [50, 110]);
        for (let i = 0; i < 6; i++) {
          const a = R.range(0, TAU);
          const d = R.range(10, 22);
          ps.spawn(
            P.STAR,
            Math.cos(a) * d,
            Math.sin(a) * d,
            Math.cos(a) * 12,
            Math.sin(a) * 12 - 6,
            R.range(0.18, 0.3),
            i % 2 ? L[4] : K[4],
            R.range(1.4, 2.4),
            R.range(0, 0.12),
          );
        }
      }
      ps.update(dt);
      ps.list = ps.list.filter((q) => Math.abs(q.x) < 29 && Math.abs(q.y) < 29);
      bits.update(dt);
      bits.list = bits.list.filter((b) => Math.abs(b.x) < 28 && Math.abs(b.y) < 28);
      lights.update(dt);
    },
    draw(p) {
      const F = Math.floor(T * FPS + 1e-3);
      const t = F / FPS;
      const lk = p.lightK;
      // the ring: swells off the star, then breaks into arcs that fly on and cool from lemon to coral
      const u = clamp((t - 0.05) / 0.36);
      if (t >= 0.05 && u < 1) {
        const r = 16 + 8 * ease.outCubic(u);
        const brk = smooth(0.15, 0.6, u);
        const outer = u < 0.15 ? WHITE : u < 0.35 ? L[4] : u < 0.6 ? L[3] : K[3];
        brokenRing(
          p,
          0,
          0,
          r,
          Math.max(1, 3 * Math.pow(1 - u, 1.2)),
          segs,
          brk,
          outer,
          K[2],
          u < 0.6 ? 1 : (1 - u) / 0.4,
        );
        if (u < 0.5) p.glowRing(0, 0, r, 5, L[4], 0.25 * (1 - u / 0.5));
      }
      // speed lines flick outward round the burst
      for (const q of lines) {
        const v = (t - 0.04) / 0.2;
        if (v <= 0 || v >= 1) continue;
        const r0 = (20 + 5 * ease.outCubic(v)) * q.r;
        const len = q.L * (1 - v) * 0.8;
        const c = Math.cos(q.a);
        const s = Math.sin(q.a);
        p.line(c * r0, s * r0, c * (r0 + len), s * (r0 + len), (w) => (w < 0.5 ? WHITE : K[3]));
      }
      p.lightK = lk * 0.6;
      bits.draw(p);
      ps.draw(p);
      p.lightK = lk;
      // the starburst: slams in white past full size, boils as it settles, pales, then pops as a hollow outline
      if (F < KEYS.length) {
        const [s, look] = KEYS[F];
        const boil = Math.floor(F / 2);
        const rad = base.map((b, i) => b * (1 + (rand(i, boil, o.seed) - 0.5) * 0.1));
        burst(p, s, look, rad, K, L);
        if (F < 2) p.glow(0, 0, 26, L[4], F === 0 ? 0.32 : 0.2);
      }
      lights.draw(p);
    },
  };
}
