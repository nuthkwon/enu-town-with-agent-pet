// Adapted from pixelfx arcane/spell-charge (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The charge recipe (motes spiralling in, pulse rings collapsing onto a layered ball with flickering rays, short
// crackling sparks) is adapted from Sprite Fusion's open-source energy charge
// (https://www.spritefusion.com/pixel-art-vfx/energy), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, WHITE, ease, fit, rng, seg, smooth } from '../_core.js';

export const meta = {
  den: { surface: 'town', from: 'arcane/spell-charge', anchor: 'free', depth: 'over', stand: 'none' },
  name: 'Spell charge',
  desc: "The caster's wand-tip charge: lavender motes spiral in and swell a tiny orb, a pink glint, a white flash, then a ring snaps out and it's gone.",
  tags: ['spell', 'charge', 'cast', 'wand', 'arcane', 'orb', 'one-shot'],
  size: [32, 32],
  origin: [16, 16],
  duration: 0.5,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.lavender, glint: DEN.pink, seed: 3 },
};

// the orb sits on the pixel at the origin (the wand tip)
const X = 0.5,
  Y = 0.5;
const MOTES = 10;
const FLASH = 0.28; // the white hero frame is the frame at t = 0.30
const RING = [0.29, 0.47];

/** The orb's radius: it swells as the motes land, pulls in a hair just before the flash. */
function orbR(t) {
  if (t < 0.22) return 0.5 + 2.6 * ease.inQuad(seg(t, 0, 0.22));
  return 3.1 - 0.8 * smooth(0.22, 0.27, t);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7),
    G = fit(o.glint, 7),
    S = o.seed;
  const r = orbR(t);

  // motes swirling in on one spin, faster as they near the orb, each trailing a curved tail that shows the
  // swirl; a white pop on the orb's skin as each one lands
  for (let i = 0; i < MOTES; i++) {
    const R = rng(S, i, 11);
    const born = -0.06 + (i / MOTES) * 0.15 + R.range(-0.01, 0.01),
      life = R.range(0.15, 0.2);
    const a0 = (i / MOTES) * TAU * 2.3 + R.range(-0.25, 0.25),
      r0 = R.range(9.5, 12.5),
      spin = R.range(2, 2.7);
    const pink = i % 4 === 1;
    const u = (t - born) / life;
    if (u < 0) continue;
    const at = (q) => {
      const rr = orbR(born + q * life) + 1;
      const d = rr + (r0 - rr) * (1 - ease.inQuad(q)),
        a = a0 + spin * (0.45 * q + 0.55 * q * q);
      return [X + Math.cos(a) * d, Y + Math.sin(a) * d * 0.92];
    };
    if (u < 1) {
      const a = Math.min(1, 0.55 + u * 2);
      const cols = pink ? [WHITE, G[4], G[3], G[2]] : [WHITE, C[4], C[3], C[2]];
      // the tail: the last stretch of its path, newest first, cooling and thinning
      let prev = at(u);
      for (let k = 1; k <= 4; k++) {
        const q = u - k * 0.09;
        if (q < -0.05) break;
        const pt = at(Math.max(0, q));
        p.line(prev[0], prev[1], pt[0], pt[1], cols[k - 1], k < 3 ? a : a * 0.55);
        prev = pt;
      }
      const [x, y] = at(u);
      p.px(x, y, cols[0]);
      p.glow(x, y, 3, pink ? G[3] : C[4], 0.16 * a);
    } else if (u < 1.3 && t < FLASH) {
      const [x, y] = at(1);
      p.px(x, y, WHITE);
    }
  }

  if (t < FLASH) {
    // the orb: a violet rim, a lilac body, a white heart lit from the top left
    if (r < 1) {
      p.px(X, Y, WHITE);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.dot(X + dx, Y + dy, C[4], r * 1.4);
    } else {
      p.circle(X, Y, r + 0.9, C[3]);
      p.circle(X, Y, r, C[4]);
      p.circle(X - r * 0.15, Y - r * 0.15, r * 0.66, C[5]);
      p.circle(X - r * 0.12, Y - r * 0.12, r * 0.34 + 0.2, WHITE);
    }
    p.glow(X, Y, 5 + r * 2.2, C[4], 0.12 + 0.06 * r);
    // the pink glint winks on its shoulder just before it goes
    const g = seg(t, 0.17, 0.27);
    if (g > 0) {
      const gx = X - r * 0.75,
        gy = Y - r * 0.75,
        arm = Math.round(1 + 2 * Math.sin(Math.PI * Math.min(1, g * 1.1)));
      for (let d = 1; d <= arm; d++)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          p.px(gx + dx * d, gy + dy * d, d === arm ? G[3] : G[4]);
      p.px(gx, gy, WHITE);
      p.glow(gx, gy, 4, G[3], 0.2);
    }
  }

  // the flash: a white disc and a four-point star with pink tips, for one frame
  const f = t - FLASH;
  if (f >= 0 && f < 0.05) {
    p.circle(X, Y, 3.7, WHITE);
    for (let d = 4; d <= 8; d++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.px(X + dx * d, Y + dy * d, d > 6 ? G[3] : WHITE);
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      p.px(X + dx * 3, Y + dy * 3, G[4]);
    p.glow(X, Y, 12, C[4], 0.35);
  } else if (f >= 0.05 && f < 0.1) {
    // the star collapsing back to a spark
    p.circle(X, Y, 1.6, WHITE);
    for (let d = 2; d <= 4; d++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.px(X + dx * d, Y + dy * d, d > 3 ? G[3] : C[5]);
    p.glow(X, Y, 8, C[4], 0.22);
  }

  // the ring snapping out: white, then lilac with a violet edge, thinning and dithering away
  const q = seg(t, RING[0], RING[1]);
  if (t >= FLASH + 0.05 && q < 1) {
    const R0 = 4 + 6.5 * ease.outQuad(q),
      w = q < 0.45 ? 2 : 1,
      a = q < 0.7 ? 1 : 1.25 - q;
    p.ring(X, Y, R0, w, (v) => (q < 0.4 ? (v > 0.5 ? C[4] : WHITE) : v > 0.5 || w === 1 ? C[3] : C[5]), a);
    p.glowRing(X, Y, R0, 3, C[4], 0.2 * (1 - q));
  }

  // bits flung off by the flash, slowing as they go and twinkling out
  if (f > 0.02) {
    for (let i = 0; i < 6; i++) {
      const R = rng(S, i, 23);
      const a = (i / 6) * TAU + R.range(-0.35, 0.35) + 0.4,
        v = R.range(9, 12),
        life = R.range(0.13, 0.17);
      const u = (f - 0.02) / life;
      if (u >= 1) continue;
      const d = 3 + v * ease.outCubic(u),
        x = X + Math.cos(a) * d,
        y = Y + Math.sin(a) * d;
      const c = i % 3 === 0 ? G[4] : u < 0.5 ? WHITE : C[5];
      if (u > 0.7 && (i + Math.floor(t * 40)) % 2) continue;
      p.px(x, y, c);
      if (u < 0.5) p.dot(x - Math.cos(a), y - Math.sin(a), i % 3 === 0 ? G[3] : C[4], 0.8);
    }
  }
}
