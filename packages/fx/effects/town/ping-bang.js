// Adapted from pixelfx ui/exclamation (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
import { DEN, TAU, WHITE, burst, clamp, ease, fit, fly } from '../_core.js';

export const meta = {
  den: { surface: 'town', from: 'ui/exclamation', anchor: 'head', depth: 'over' },
  name: 'Ping bang',
  desc: 'Someone pings me: a bold lemon ! with a coral rim springs up off my head, stretching as it shoots up and squashing as it lands; surprise ticks flick out, it wobbles, then pops away in stars.',
  tags: ['town', 'ping', 'alert', 'surprise', 'emote', 'one-shot'],
  size: [24, 40],
  origin: [12, 38],
  duration: 1.2,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.lemon, rim: DEN.coral, seed: 6 },
};

const REST = -5; // the mark's foot (the bottom of its dot) at rest, above the head
const MID = REST - 7; // the middle of the mark, where the ticks flick out from
const POP = 0.9;

// the foot's height: a damped spring shot up off the head (closed form, so any t can be drawn)
const W0 = 30;
const G = 7;
const WD = Math.sqrt(W0 * W0 - G * G);
const footY = (t) => {
  const x0 = 0 - REST;
  const v0 = -260;
  const b = (v0 + G * x0) / WD;
  return REST + Math.exp(-G * t) * (x0 * Math.cos(WD * t) + b * Math.sin(WD * t));
};

// the mark: a bar tapering to its foot over a round dot, a coral rim, lit down its left side; scaled about
// its foot by (sx, sy) and turned by a
function bang(p, L, K, y, sx, sy, a, white) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // (pixel rows at rest: a bar 2/4/4/4/4/2/2/2 wide, a row of floor, a round 4x4 dot)
  const hw = (V) => 1 + (-V - 6.6) * 0.14;
  const inBar = (U, V) =>
    V > -14.6 && V < -6.6 && Math.abs(U) < hw(V) && !(V < -14 && Math.abs(U) > hw(V) - 0.9);
  const inDot = (U, V) => Math.hypot(U, V + 2) < 1.9;
  const inside = (U, V) => inBar(U, V) || inDot(U, V);
  p.shade(-11, y - 24, 11, y + 4, (px, py) => {
    const dx = px;
    const dy = py - y;
    const u = (dx * ca + dy * sa) / sx;
    const v = (-dx * sa + dy * ca) / sy;
    const ex = 1 / sx;
    const ey = 1 / sy;
    if (!inside(u, v))
      return inside(u - ex, v) || inside(u + ex, v) || inside(u, v - ey) || inside(u, v + ey)
        ? K[1]
        : undefined;
    if (white) return WHITE;
    if (inDot(u, v))
      return Math.hypot(u + 0.6, v + 2.6) < 0.8
        ? WHITE
        : u + (v + 2) < -0.6
          ? L[5]
          : u + (v + 2) < 1
            ? L[3]
            : L[2];
    const w = hw(v);
    const q = (u + w) / (2 * w);
    if (q < 0.34) return v < -12 ? WHITE : L[5];
    if (q > 0.7) return L[2];
    return L[3];
  });
}

export function draw(p, t, o) {
  const L = fit(o.palette, 7);
  const K = fit(o.rim, 7);

  // surprise ticks: three flick out each side as it lands, and again on a second beat
  for (const [t0, len] of [
    [0.1, 3.5],
    [0.5, 2.5],
  ]) {
    const u = (t - t0) / 0.25;
    if (u <= 0 || u >= 1) continue;
    for (const s of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const an = -Math.PI / 2 + s * (0.52 + i * 0.44);
        const r0 = 6.5 + 2 * ease.outCubic(u);
        const l = len * Math.sin(u * Math.PI) * (i === 1 ? 1 : 0.75);
        if (l < 0.8) continue;
        const c = Math.cos(an);
        const n = Math.sin(an);
        p.line(c * r0, MID + n * r0, c * (r0 + l), MID + n * (r0 + l), (q) => (q < 0.5 ? K[3] : K[2]));
      }
  }

  if (t < POP + 0.05) {
    if (t < 0.05) {
      // the spark it springs from
      p.circle(0, -2, 1.5, WHITE);
      p.glow(0, -2, 8, L[4], 0.3);
    } else {
      const y = footY(t);
      const vel = (footY(t + 0.004) - footY(t - 0.004)) / 0.008;
      const up = clamp(-vel / 260);
      const sq = clamp((y - REST) / 2.5);
      let sx = 1 - 0.28 * up + 0.3 * sq;
      let sy = 1 + 0.4 * up - 0.25 * sq;
      // it crouches for a frame, then stretches up white and bursts
      const crouch = t >= POP - 0.05 && t < POP;
      if (crouch) {
        sx = 1.25;
        sy = 0.8;
      }
      const pop = t >= POP;
      if (pop) {
        sx = 0.85;
        sy = 1.3;
      }
      const wob = t > 0.2 ? 0.2 * Math.exp(-(t - 0.2) * 3) * Math.sin((t - 0.2) * 18) : 0;
      bang(p, L, K, Math.round(y), sx, sy, wob, t < 0.1 || pop);
      p.glow(0.5, y - 8, 12, L[4], pop ? 0.35 : 0.22);
      // a glint twinkles on the bar while it hangs
      if (t > 0.6 && t < 0.75) {
        const g = Math.sin(((t - 0.6) / 0.15) * Math.PI);
        const gx = -1;
        const gy = Math.round(y) - 12;
        p.px(gx, gy, WHITE);
        if (g > 0.5)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            p.px(gx + dx, gy + dy, L[5]);
      }
    }
  }
  // the burst: a white flash and a tight ring, little stars thrown out past it (taller than wide, like the
  // canvas), braked hard, winking out within a few frames
  const age = t - POP - 0.05;
  const k = age / 0.1;
  if (k >= 0 && k < 1) {
    p.ring(0.5, MID, 2.5 + 4 * ease.outExpo(k), 1, k < 0.5 ? WHITE : L[4], 1.3 - k * 1.2);
    if (k < 0.5) p.circle(0.5, MID, 2.2 * (1 - k / 0.5) + 0.6, WHITE);
  }
  burst(7, o.seed, (r, i) => {
    const life = r.range(0.12, 0.17);
    if (age < 0 || age >= life) return;
    const a = (i / 7) * TAU + r.range(-0.2, 0.2) - Math.PI / 2;
    const sp = r.range(75, 95);
    // thrown up and out more than down, so none of them lands on the head
    const vy = Math.sin(a) * sp * (Math.sin(a) > 0 ? 0.6 : 1.3);
    const [x, y] = fly(Math.cos(a) * 3, MID + Math.sin(a) * 4, Math.cos(a) * sp * 0.75, vy, age, 0, 9);
    const X = Math.round(x);
    const Y = Math.round(y);
    const c = i % 3 === 0 ? K[2] : L[2];
    const q = age / life;
    if (q < 0.7)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.px(X + dx, Y + dy, c);
    p.px(X, Y, q < 0.7 ? WHITE : c);
  });
}
