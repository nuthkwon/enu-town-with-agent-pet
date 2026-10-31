// Adapted from pixelfx explosions/firework-burst (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The flare, the twinkling crosses and the glitter are adapted from Sprite Fusion's open-source sparkle
// (https://www.spritefusion.com/pixel-art-vfx/sparkle), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, Lights, Rng, TAU, WHITE, ease, fit, mix, seg } from '../_core.js';

export const meta = {
  den: { surface: 'town', from: 'explosions/firework-burst', anchor: 'chest', depth: 'over' },
  name: 'Cheer fireball hit',
  desc: 'The cheer fireball lands on the chest and bursts into encouragement: a white flash, a ring snapping out, heart-shaped embers flying and floating, sparks that fall and bounce once on the floor, soft pink puffs, then clean.',
  tags: ['spell', 'fireball', 'cheer', 'hit', 'hearts', 'burst', 'one-shot'],
  size: [64, 64],
  origin: [32, 40],
  duration: 0.9,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.ember, pink: DEN.pink, seed: 7 },
};

const FLOOR = 14; // the chest anchor sits 14 px above the feet
const DRAG = 5.5,
  LIFT = 46; // hearts: fast out, then they slow and float up
const SPARK_G = 480,
  SPARK_DRAG = 4.2;

// a 7 x 6 heart with an outline (o), a body (f) and a highlight (h)
const HEART_BIG = ['.oo.oo.', 'ohfoffo', 'offfffo', '.offfo.', '..ofo..', '...o...'];
// a 5 x 4 heart
const HEART_SMALL = ['.f.f.', 'fhfff', '.ffo.', '..o..'];

export function create(o) {
  const E = fit(o.palette, 7),
    K = fit(o.pink, 7),
    R = new Rng(o.seed);
  const PUFF = fit(DEN.puff, 6);
  const lights = new Lights();
  const PUFFC = mix(K[5], PUFF[3], 0.25),
    PUFFCORE = mix(K[4], PUFF[3], 0.3);
  const hearts = [],
    sparks = [];
  let t = 0;

  // the hearts: thrown all round, a little more up than down, each its own size, speed and life
  const NH = 8;
  for (let i = 0; i < NH; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / NH - 0.5) * 4.2 + R.range(-0.2, 0.2);
    const low = Math.sin(a) > -0.1;
    const v = R.range(120, 160) * (low ? 0.75 : 1);
    hearts.push({
      x: 0,
      y: 0,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v * 0.9,
      t0: R.range(0.02, 0.05),
      life: R.range(0.62, 0.82),
      big: i % 3 === 0,
      pink: i % 2 === 0,
      ph: R.range(0, 6.3),
    });
  }
  // the sparks: hot streaks thrown out and up, falling to the floor and bouncing once
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 + R.range(-1.8, 1.8),
      v = R.range(70, 125);
    sparks.push({
      x: 0,
      y: 0,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      t0: R.range(0.01, 0.06),
      life: R.range(0.45, 0.7),
      age: 0,
      bounced: false,
    });
  }
  // soft pink puffs where it popped: they roll out sideways at chest height (clear of the face), swell and thin
  const puffs = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1,
      a = R.range(0.1, 0.9);
    puffs.push({
      x: side * R.range(1, 3),
      y: R.range(2, 5),
      vx: side * Math.cos(a) * R.range(40, 70),
      vy: -Math.sin(a) * R.range(0, 8),
      t0: R.range(0.03, 0.09),
      life: R.range(0.42, 0.58),
      s: R.range(2.6, 3.8),
    });
  }
  lights.add(0, 0, 22, E[4], 0.35, 0.3);

  return {
    update(dt) {
      t += dt;
      for (const h of hearts) {
        if (t < h.t0) continue;
        h.vx -= h.vx * DRAG * dt;
        h.vy -= h.vy * DRAG * dt + LIFT * dt;
        h.x += h.vx * dt;
        h.y += h.vy * dt;
      }
      for (const s of sparks) {
        if (t < s.t0) continue;
        s.age += dt;
        s.vy += SPARK_G * dt;
        s.vx -= s.vx * SPARK_DRAG * dt;
        s.vy -= s.vy * SPARK_DRAG * dt;
        const ny = s.y + s.vy * dt;
        s.x += s.vx * dt;
        if (!s.bounced && s.vy > 0 && ny >= FLOOR) {
          // one bounce, then it skids and dies
          s.bounced = true;
          s.y = FLOOR - 0.25;
          s.vy = -s.vy * 0.42;
          s.vx *= 0.6;
          s.life = Math.min(s.life, s.age + 0.18);
        } else s.y = s.bounced ? Math.min(FLOOR - 0.25, ny) : ny;
      }
      for (const q of puffs) {
        if (t < q.t0) continue;
        q.vx -= q.vx * 5 * dt;
        q.vy -= q.vy * 4 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
      }
      lights.update(dt);
    },
    draw(p) {
      // soft puffs first, behind everything: a pink-lilac body, a denser core, a lit cap while young
      for (const q of puffs) {
        const age = (t - q.t0) / q.life;
        if (age < 0 || age >= 1) continue;
        const r = q.s * (0.6 + 0.7 * ease.outQuad(age)),
          a = Math.min(1, age * 8) * Math.pow(1 - age, 1.2);
        p.disc(q.x, q.y, r, PUFFC, 0.5 * a);
        p.disc(q.x + r * 0.08, q.y + r * 0.1, r * 0.7, PUFFCORE, 0.55 * a);
        if (age < 0.55) p.disc(q.x - r * 0.25, q.y - r * 0.3, r * 0.5, WHITE, 0.35 * a * (1 - age / 0.55));
      }

      // the pop: a white hero frame with rays, then the fireball's hot heart collapsing
      if (t < 0.025) {
        p.circle(0, 0, 4.6, WHITE);
        for (let i = 0; i < 8; i++) {
          const an = (i * TAU) / 8,
            len = i % 2 ? 6 : 10,
            ca = Math.cos(an),
            sa = Math.sin(an);
          for (let d = 4; d <= len; d += 0.5) {
            const u = d / len;
            p.dot(ca * d, sa * d, u < 0.6 ? WHITE : i % 2 ? K[4] : E[5], u < 0.8 ? 1 : 0.6);
          }
        }
        p.glow(0, 0, 16, E[5], 0.35);
      } else if (t < 0.2) {
        const q = seg(t, 0.025, 0.2),
          r = 3.8 * (1 - ease.inQuad(q));
        if (r > 0.6) {
          p.circle(0, 0, r + 1, E[3]);
          p.circle(-0.3, -0.3, r, E[5]);
          if (r > 1.6) p.circle(-0.5, -0.5, r * 0.45, WHITE);
        }
      }

      // the ring snapping out: white, then gold, then pink, thinning and dithering away
      const rq = seg(t, 0.03, 0.26);
      if (t >= 0.025 && rq < 1) {
        const r = 5 + 13 * ease.outCubic(rq),
          w = rq < 0.35 ? 2 : 1,
          a = rq < 0.6 ? 1 : 1.3 - rq * 0.9;
        p.ring(
          0,
          0,
          r,
          w,
          (v) => (rq < 0.3 ? (v > 0.5 ? E[5] : WHITE) : rq < 0.6 ? (v > 0.5 ? K[3] : E[5]) : K[3]),
          a,
        );
        p.glowRing(0, 0, r, 3, E[5], 0.18 * (1 - rq));
      }

      // the sparks: hot streaks along their flight, cooling to pink
      for (const s of sparks) {
        if (t < s.t0 || s.age >= s.life) continue;
        const k = 1 - s.age / s.life,
          sp = Math.hypot(s.vx, s.vy) || 1,
          ux = s.vx / sp,
          uy = s.vy / sp;
        const len = Math.min(5, 0.6 + sp * 0.025),
          head = k > 0.7 ? WHITE : k > 0.45 ? E[5] : k > 0.2 ? E[4] : K[3];
        if (k < 0.2 && Math.floor(t * 40 + s.x) % 2) continue;
        p.line(
          s.x - ux * len,
          s.y - uy * len,
          s.x - ux * len * 0.4,
          s.y - uy * len * 0.4,
          k > 0.5 ? E[3] : K[2],
          0.9,
        );
        p.line(s.x - ux * len * 0.4, s.y - uy * len * 0.4, s.x, s.y, head);
        p.glow(s.x, s.y, 3, E[4], 0.22 * k);
      }

      // the hearts: white-hot for a beat, then their own colour; they twinkle out at the end
      for (const h of hearts) {
        const age = t - h.t0;
        if (age < 0 || age >= h.life) continue;
        const k = 1 - age / h.life;
        if (k < 0.3 && Math.floor(age * 30 + h.ph) % 2) continue;
        const hot = age < 0.06;
        const big = h.big && k > 0.22;
        const pal = hot
          ? { o: h.pink ? K[3] : E[4], f: WHITE, h: WHITE }
          : h.pink
            ? { o: K[2], f: K[3], h: K[5] }
            : big
              ? { o: E[2], f: E[4], h: E[5] }
              : { o: E[2], f: E[3], h: E[5] };
        const rows = big ? HEART_BIG : HEART_SMALL;
        const W = rows[0].length,
          Hh = rows.length;
        const sway = Math.sin(age * 10 + h.ph) * Math.min(1, age * 3);
        p.sprite(rows, pal, Math.round(h.x + sway - W / 2), Math.round(h.y - Hh / 2));
        p.glow(h.x, h.y, 5, h.pink ? K[3] : E[4], 0.16 * k);
      }

      lights.draw(p);
    },
  };
}
