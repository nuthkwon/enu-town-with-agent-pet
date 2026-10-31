// Adapted from pixelfx arcane/rune-circle (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The specks rising off the floor ring follow Sprite Fusion's open-source mana heal
// (https://www.spritefusion.com/pixel-art-vfx/heal), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, cycle, ease, fit, smooth } from '../_core.js';

// The circle aura/party-cast leaves behind, turning quietly while the meeting lasts: the same rings (plane px, the
// floor squashes depth by SY), a carousel of rune ticks riding one step round a loop, a single light chasing round
// and lighting the ticks it passes, a few motes rising. Low contrast so the room stays calm; seamless.
const D = 3.6,
  R = 44,
  R2 = 36,
  RI = 22,
  SY = 0.3,
  NT = 20;

export const meta = {
  name: 'Rune ring',
  desc: 'The meeting circle keeps turning on the floor while the meeting lasts: thin rings, a carousel of rune ticks lit by one chasing light, a few motes rising. Lavender, very low contrast, 3.6 s loop under the people.',
  tags: ['aura', 'meeting', 'party', 'circle', 'rune', 'loop'],
  size: [96, 40],
  origin: [48, 20],
  duration: D,
  loop: true,
  fps: 10,
  bg: 'ground',
  options: { palette: DEN.lavender, seed: 8 },
  den: { surface: 'town', anchor: 'free', depth: 'under', from: 'arcane/rune-circle' },
};

// how far behind the light angle g is (0 at the light, growing back along its trail)
const behind = (g, light) => (((light - g) % TAU) + TAU) % TAU;
const onFloor = (g, r) => [Math.cos(g) * r, Math.sin(g) * r * SY];

// a ring lying on the floor, 1 px at any size; col(g) its color at angle g (0: leave a gap)
function ring(p, r, col) {
  const ry = r * SY;
  p.shade(-r - 1, -ry - 1, r + 1, ry + 1, (x, y) => {
    const nx = x / r,
      ny = y / ry,
      d = Math.hypot(nx, ny);
    if (d < 1e-6 || Math.abs(d - 1) / (Math.hypot(nx / r, ny / ry) / d) > 0.5) return;
    return col(Math.atan2(ny, nx));
  });
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7),
    ph = t / D;
  // the ticks alternate dash and dot, so they ride two steps a loop to come back to the same pattern
  const light = Math.PI / 2 + ph * TAU,
    spin = (2 * ph * TAU) / NT;
  // the light's trail on the outer ring: white at the light, pale behind it, then the ring's own quiet tone
  const trail = (g) => {
    const b = behind(g, light);
    return b < 0.06 ? C[6] : b < 0.35 ? C[5] : C[4];
  };
  ring(p, R, trail);
  ring(p, R2, (g) => (behind(g, light) < 0.3 ? C[5] : C[4]));
  // the inner ring is dashed, so the middle stays quiet
  ring(p, RI, (g) => (Math.floor(((g + TAU) * 18) / TAU) % 2 ? C[4] : 0));
  // the rune ticks ride round, dash and dot by turns; the light wakes each one as it passes
  for (let k = 0; k < NT; k++) {
    const g = spin + ((k + 0.5) * TAU) / NT,
      b = behind(g, light),
      c = b < 0.15 ? C[6] : b < 0.8 ? C[5] : C[4];
    if (k % 2) {
      const [x, y] = onFloor(g, (R + R2) / 2);
      p.px(x, y, c);
      continue;
    }
    const [x0, y0] = onFloor(g, R2 + 2),
      [x1, y1] = onFloor(g, R - 2);
    p.line(x0, y0, x1, y1, c);
  }
  // the light itself: a small glint running round
  const [lx, ly] = onFloor(light, R);
  p.px(lx, ly - 1, C[6]);
  p.px(lx - 1, ly, C[5]);
  p.px(lx + 1, ly, C[5]);
  p.glow(lx, ly, 5, C[5], 0.12);
  // a few motes rising off the rings, swaying in
  cycle(
    t,
    D,
    9,
    o.seed * 7 + 1,
    (g) => g.range(1.4, 2.2),
    (age, life, r) => {
      const q = age / life,
        g = r.range(0, TAU),
        rr = r.pick([R, R, R2, RI]) * (1 - 0.1 * q),
        [x, y] = onFloor(g, rr);
      // they rise less off the far side, where the canvas ends just above the ring
      const h = 1 + ease.outQuad(q) * Math.min(r.range(8, 15), y + 17),
        a = Math.min(1, q * 4) * (1 - smooth(0.6, 1, q));
      // a mote: a bright head over a pale tail, rising
      const head = r.chance(0.4) ? C[6] : C[5];
      p.dot(x, y - h, head, a);
      p.dot(x, y - h + 1, C[4], a * 0.8);
      if (head === C[6]) p.glow(x, y - h, 3, C[5], 0.1 * a);
    },
  );
}
