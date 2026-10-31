// Adapted from pixelfx pickups/potion (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// 힐링 포션 in flight: the game carries it along its arc (anchor free) and plays spell/heal where it lands. From the
// library potion: the brew keeps level in the world while the glass turns, light through the glass, a lit streak
// on it. Ours: a small flask tumbling end over end, mint brew, a glint and a short trail of sparkles. It faces
// right (the trail streams left); mirror it for a throw to the left.
import { DEN, TAU, WHITE, clamp, cycle, fit, hex } from '../_core.js';

export const meta = {
  name: 'Healing potion (flying)',
  desc: 'A small round flask of glowing mint brew tumbles end over end, its brew sloshing level, a glint on the glass and a short trail of sparkles behind it.',
  tags: ['spell', 'potion', 'flask', 'heal', 'projectile', 'loop'],
  size: [24, 24],
  origin: [12, 12],
  duration: 0.4,
  loop: true,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.mint, seed: 5 },
  den: { surface: 'town', anchor: 'free', depth: 'over', stand: 'none', from: 'pickups/potion' },
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

const D = meta.duration;
const RB = 4.6,
  BY = 1.6; // the bulb: radius, and its centre below the turning point (flask space)
const INK = hex(DEN.mint[0]);
const CORK = DEN.coffee.slice(1, 5).map(hex); // dark roast, caramel, latte, crema

// the flask in its own frame (u across, v down): 1 bulb, 2 neck, 3 lip, 4 cork, 0 outside
function part(u, v) {
  if (Math.hypot(u, v - BY) <= RB) return 1;
  const au = Math.abs(u);
  if (v >= -4.3 && v < -2 && au <= 1.45) return 2;
  if (v >= -5.1 && v < -4.3 && au <= 2.25) return 3;
  if (v >= -7.3 && v < -5.1 && au <= 1.5) return 4;
  return 0;
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7),
    ph = t / D;
  const th = ph * TAU,
    ct = Math.cos(th),
    st = Math.sin(th);
  // the bulb's centre in the world: it swings round the turning point as the flask tumbles
  const bx = -st * BY,
    by = ct * BY;
  const toFlask = (x, y) => [x * ct + y * st, -x * st + y * ct];
  // the brew's surface stays level in the world, sloshing a little behind the turn
  const level = (x) => by - 0.7 + 0.3 * Math.sin(th - 0.9) + 0.35 * Math.sin(x * 0.9 + th * 2);

  // a short trail of sparkles left behind, twinkling out
  cycle(
    t,
    D,
    9,
    o.seed,
    (g) => g.range(0.24, 0.36),
    (age, life, r) => {
      const k = age / life,
        x = r.range(-3.5, -1) - r.range(15, 21) * age,
        y = r.range(-3, 3) + r.range(-6, 6) * age;
      const c = k < 0.35 ? WHITE : C[4],
        big = r.chance(0.55) && k < 0.6;
      if (big) {
        // a little four-point twinkle: white heart, mint arms
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          dot(p, x + dx, y + dy, k < 0.3 ? C[4] : C[3], 1.2 - k);
        dot(p, x, y, WHITE, 1.3 - k);
      } else dot(p, x, y, c, 1.3 - k);
      p.glow(x + 0.5, y + 0.5, 3, C[4], 0.25 * (1 - k));
    },
  );

  // the brew glows through the glass: a halo hugging the bulb, light that leaves the brew's colours alone
  p.glowRing(bx, by + 0.5, RB + 1.5, 3.5, C[3], 0.26);
  p.glow(bx, by + 1.5, 6, C[3], 0.1);

  // the flask, pixel by pixel in its own frame; a 1 px rim, ink on the shaded side
  for (let y = -10; y <= 10; y++)
    for (let x = -10; x <= 10; x++) {
      if (!IN(x, y)) continue;
      const cx = x + 0.5,
        cy = y + 0.5,
        [u, v] = toFlask(cx, cy),
        k = part(u, v);
      if (!k) {
        let near = 0;
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const [uu, vv] = toFlask(cx + ox, cy + oy),
            q = part(uu, vv);
          if (q) near = near === 4 ? near : q;
        }
        if (near) p.px(x, y, (cx - bx) * 0.6 + (cy - by) * 0.8 > 0.5 ? INK : near === 4 ? CORK[0] : C[1]);
        continue;
      }
      if (k === 4) {
        // the cork: a pale top, a lit left side, a shaded right side
        p.px(x, y, v < -6.6 ? CORK[3] : u < -0.5 ? CORK[2] : u > 0.6 ? CORK[0] : CORK[1]);
        continue;
      }
      if (k === 3) {
        p.px(x, y, u < 0 ? WHITE : C[5]);
        continue;
      }
      if (k === 2) {
        p.px(x, y, Math.abs(u) > 0.7 ? (u < 0 ? WHITE : C[4]) : C[5]);
        continue;
      }
      // the bulb: a glass wall round the brew, the brew level in the world, empty glass above it
      const dx = cx - bx,
        dy = cy - by,
        d = Math.hypot(dx, dy),
        lit = (-dx * 0.62 - dy * 0.78) / Math.max(0.5, d);
      if (d > RB - 1) {
        p.px(x, y, lit > 0.55 ? WHITE : cy > level(cx) ? C[3] : C[5]);
        continue;
      }
      const depth = cy - level(cx);
      if (depth > 0) {
        // the brew: a bright skin, a glowing heart, deep mint at its edge, deepest at the lower right
        const core = 1 - Math.hypot(dx * 0.9, dy - 1) / (RB - 1);
        let c = depth < 0.9 ? (dx < -0.6 ? WHITE : C[4]) : core > 0.62 ? C[3] : C[2];
        if (depth >= 0.9 && dx + dy > 3.2) c = C[1];
        p.px(x, y, c);
      } else if (IN(x, y)) p.blend(x, y, lit > 0.2 ? WHITE : C[5], 0.6);
    }

  // a curved streak of light on the glass, fixed to the world's upper left, and a pin of light
  for (let a = 3.5; a < 4.35; a += 0.12) {
    const lx = bx + Math.cos(a) * (RB - 1.6),
      ly = by + Math.sin(a) * (RB - 1.6);
    dot(p, lx, ly, a > 3.75 && a < 4.15 ? WHITE : C[5]);
  }
  // a glint flashes once a turn
  const g = clamp((ph - 0.08) / 0.2);
  if (g > 0 && g < 1) {
    const arm = Math.round(1 + 2 * Math.sin(Math.PI * g)),
      gx = Math.floor(bx - 3),
      gy = Math.floor(by - 4);
    for (let d = 1; d <= arm; d++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        dot(p, gx + dx * d, gy + dy * d, d === arm ? C[5] : WHITE);
    dot(p, gx, gy, WHITE);
    p.glow(gx + 0.5, gy + 0.5, 5, C[5], 0.3 * Math.sin(Math.PI * g));
  }
}
