// Adapted from pixelfx explosions/firework-rocket (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The flare, the twinkling glitter and the crackle are adapted from Sprite Fusion's open-source sparkle
// (https://www.spritefusion.com/pixel-art-vfx/sparkle), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, Lights, Rng, TAU, WHITE, clamp, ease, fit } from '../_core.js';

export const meta = {
  den: { surface: 'town', from: 'explosions/firework-rocket', anchor: 'feet', depth: 'over' },
  name: 'Celebration fireworks',
  desc: 'The celebration spell: a little rocket fizzes up from beside the feet on a sparkling trail, bursts high above in a white flash into a palm of pink, lemon and sky stars that droop, crackle into white pops and leave glitter that fades.',
  tags: ['spell', 'fireworks', 'celebration', 'rocket', 'sparkle', 'one-shot'],
  size: [64, 96],
  origin: [32, 92],
  duration: 1.8,
  loop: false,
  fps: 15,
  bg: 'ground',
  options: { palette: DEN.pink, lemon: DEN.lemon, sky: DEN.sky, seed: 12 },
};

const FLY = 0.5; // the climb (s)
const X0 = 12,
  Y0 = -2; // launch: beside the right foot
const XB = 2,
  YB = -67; // the burst
const DRAG = 2.5,
  G = 62,
  TRAIL = 0.42;

export function create(o) {
  const PK = fit(o.palette, 7),
    LE = fit(o.lemon, 7),
    SK = fit(o.sky, 7),
    R = new Rng(o.seed);
  const RAMPS = [PK, LE, SK];
  const lights = new Lights();
  const fronds = [],
    pops = [],
    sparks = [],
    glitter = [];
  const at = (tt) => {
    const u = clamp(tt / FLY);
    return [
      X0 + (XB - X0) * ease.inOutSine(u) + Math.sin(tt * 34) * 0.4 * u,
      Y0 + (YB - Y0) * ease.outQuad(u),
    ];
  };
  let t = 0,
    burst = false,
    acc = 0;

  // ignition: a little spray off the floor
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + R.range(-1.1, 1.1),
      sp = R.range(30, 70);
    sparks.push({
      x: X0,
      y: Y0,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * 0.6,
      life: R.range(0.12, 0.25),
      age: 0,
      c: LE,
    });
  }
  lights.add(X0, Y0 - 2, 10, LE[4], 0.3, 0.25);

  return {
    update(dt) {
      t += dt;
      if (t < FLY) {
        // the climb: hot sparks spat down from the tail, glitter left hanging behind
        const [x, y] = at(t);
        for (acc += dt * 60; acc > 1; acc--) {
          const a = Math.PI / 2 + R.range(-0.5, 0.5),
            sp = R.range(20, 55);
          sparks.push({
            x,
            y: y + 3,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: R.range(0.1, 0.24),
            age: 0,
            c: LE,
          });
          if (R.chance(0.4))
            glitter.push({
              x: x + R.range(-1, 1),
              y: y + R.range(2, 5),
              vx: R.range(-4, 4),
              vy: R.range(2, 10),
              life: R.range(0.3, 0.6),
              age: 0,
              c: R.chance(0.6) ? LE[2] : PK[3],
              ph: R.range(0, 6.3),
              big: false,
            });
        }
      } else if (!burst) {
        burst = true;
        lights.add(XB, YB, 22, LE[4], 0.3, 0.6);
        lights.add(XB, YB, 10, WHITE, 0.3, 0.1);
        // the palm: fronds thrown up and out in a fan, two low ones to the sides; each its own colour
        const N = 11;
        for (let i = 0; i < N; i++) {
          const f = i / (N - 1) - 0.5,
            a = -Math.PI / 2 + f * 3.2 + R.range(-0.08, 0.08);
          const sp = R.range(60, 68) * (1 - 0.15 * Math.abs(f) * 2);
          fronds.push({
            x: XB,
            y: YB,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            age: 0,
            life: R.range(0.72, 0.9),
            ramp: RAMPS[i % 3],
            pts: [],
            acc: R.next(),
            seed: R.range(0, 100),
          });
        }
        // a spray of short sparks at the heart of the burst
        for (let i = 0; i < 14; i++) {
          const a = R.range(0, TAU),
            sp = R.range(30, 80);
          sparks.push({
            x: XB,
            y: YB,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: R.range(0.1, 0.25),
            age: 0,
            c: LE,
          });
        }
      }
      for (let i = fronds.length - 1; i >= 0; i--) {
        const f = fronds[i];
        f.age += dt;
        const k = f.age / f.life;
        if (k >= 1) {
          // it crackles out in a few white pops
          for (let j = 0; j < 3; j++)
            pops.push({
              x: f.x + R.range(-3, 3),
              y: f.y + R.range(-3, 3),
              t0: t + R.range(0, 0.16),
              life: R.range(0.08, 0.13),
              c: j === 0 ? WHITE : f.ramp[3],
            });
          fronds.splice(i, 1);
          continue;
        }
        f.vx -= f.vx * DRAG * dt;
        f.vy -= f.vy * DRAG * dt - G * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.pts.push(f.x, f.y, t);
        while (f.pts.length > 3 && t - f.pts[2] > TRAIL) f.pts.splice(0, 3);
        // glitter shed along the way: specks that hang, twinkle and drift down
        for (f.acc += dt * 14; f.acc > 1; f.acc--)
          glitter.push({
            x: f.x,
            y: f.y,
            vx: f.vx * 0.1 + R.range(-3, 3),
            vy: R.range(0, 8),
            life: Math.min(R.range(0.4, 0.75), 1.72 - t),
            age: 0,
            c: R.chance(0.6) ? f.ramp[3] : f.ramp[2],
            ph: R.range(0, 6.3),
            big: R.chance(0.12),
          });
      }
      for (let i = pops.length - 1; i >= 0; i--) if (t > pops[i].t0 + pops[i].life) pops.splice(i, 1);
      for (const list of [sparks, glitter])
        for (let i = list.length - 1; i >= 0; i--) {
          const s = list[i];
          s.age += dt;
          if (s.age >= s.life) {
            list.splice(i, 1);
            continue;
          }
          const g = list === sparks ? 300 : 18,
            d = list === sparks ? 3 : 2;
          s.vx -= s.vx * d * dt;
          s.vy += g * dt - s.vy * d * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
        }
      lights.update(dt);
    },
    draw(p) {
      // glitter: specks that twinkle and wink out
      for (const s of glitter) {
        const k = 1 - s.age / s.life,
          tw = Math.sin(t * 28 + s.ph);
        if (k < 0.35 && tw < 0) continue;
        p.px(s.x, s.y, tw > 0.6 ? WHITE : s.c);
        if (s.big && k > 0.4)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            p.dot(s.x + dx, s.y + dy, s.c, 0.7);
      }
      // sparks: short hot streaks
      for (const s of sparks) {
        const k = 1 - s.age / s.life,
          sp = Math.hypot(s.vx, s.vy) || 1,
          ux = s.vx / sp,
          uy = s.vy / sp,
          len = Math.min(3, 0.5 + sp * 0.03);
        p.line(s.x - ux * len, s.y - uy * len, s.x, s.y, k > 0.5 ? s.c[3] : s.c[2]);
        p.px(s.x, s.y, k > 0.5 ? WHITE : s.c[3]);
      }
      if (t < FLY) {
        // the rocket: a little pink tube with a white tip, a white-hot tail flickering under it
        const [x, y] = at(t);
        // its hot streak: the last stretch of its path, white near the rocket, gold, then thinning out
        let prev = [x, y + 2];
        for (let i = 1; i <= 7; i++) {
          const [px, py] = at(Math.max(0, t - i * 0.012));
          const q = i / 7;
          p.line(
            prev[0],
            prev[1],
            px,
            py + 2,
            q < 0.3 ? WHITE : q < 0.65 ? LE[3] : LE[2],
            q < 0.6 ? 1 : 1.4 - q,
          );
          prev = [px, py + 2];
        }
        p.rect(x - 0.5, y - 2, 2, 4, PK[3]);
        p.px(x - 0.5, y - 2, PK[5]);
        p.px(x + 0.5, y - 3, WHITE);
        const fl = 2 + (Math.floor(t * 60) % 2);
        p.line(x, y + 2, x, y + 2 + fl, (u) => (u < 0.5 ? WHITE : LE[4]));
        p.glow(x, y + 3, 6, LE[4], 0.3);
      }
      // the fronds: a trail from the head back along where it has been, hot near the head, cooling and
      // dithering out; the head white-hot at first, then its colour; late on it flickers before it pops
      for (const f of fronds) {
        const k = f.age / f.life,
          P2 = f.pts,
          n = P2.length / 3,
          C = f.ramp;
        for (let j = n - 1; j > 0; j--) {
          const u = (t - P2[j * 3 + 2]) / TRAIL;
          if (u >= 1) break;
          const c = u < 0.12 ? C[4] : u < 0.35 ? C[3] : C[2];
          p.line(
            P2[j * 3],
            P2[j * 3 + 1],
            P2[j * 3 - 3],
            P2[j * 3 - 2],
            c,
            u < 0.3 ? 1 : Math.pow((1 - u) / 0.7, 1.5) * (1.15 - k * 0.4),
          );
        }
        if (k > 0.8 && Math.sin(t * 55 + f.seed) < 0) continue;
        p.px(f.x, f.y, k < 0.4 ? WHITE : C[4]);
        if (k < 0.55)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            p.px(f.x + dx, f.y + dy, C[3]);
        p.glow(f.x, f.y, 5, C[4], 0.25 * (1 - k * 0.6));
      }
      // the crackle: white pops with tinted tips
      for (const q of pops) {
        const u = (t - q.t0) / q.life;
        if (u < 0 || u > 1) continue;
        const arm = Math.round(2 * Math.sin(Math.PI * u));
        p.px(q.x, q.y, WHITE);
        for (let d = 1; d <= arm; d++)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            p.px(q.x + dx * d, q.y + dy * d, d === arm ? q.c : WHITE);
        p.glow(q.x, q.y, 4, q.c, 0.2);
      }
      // the burst: a white heart for a frame, a turning flare of lemon and white rays
      const b = t - FLY;
      if (b >= 0 && b < 0.2) {
        const u = b / 0.2,
          L = 13 * Math.pow(1 - u, 1.3);
        for (let i = 0; i < 8; i++) {
          const diag = i % 2 === 1,
            an = u * 0.5 + (i * TAU) / 8,
            len = diag ? L * 0.5 : L,
            ca = Math.cos(an),
            sa = Math.sin(an);
          for (let d = 0; d <= len; d += 0.5) {
            const v = d / len;
            p.dot(
              XB + ca * d,
              YB + sa * d,
              v < 0.35 ? WHITE : diag ? PK[4] : LE[4],
              v < 0.7 ? 1 : 1 - (v - 0.7) / 0.35,
            );
          }
        }
        if (b < 0.08) p.circle(XB + 0.5, YB + 0.5, 3, WHITE);
      }
      lights.draw(p);
    },
  };
}
