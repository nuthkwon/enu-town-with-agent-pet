// Adapted from pixelfx pickups/collect-burst (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The pop (a white flash, a ring snapping out, star sparks with short trails) follows Sprite Fusion's
// open-source pickup (https://www.spritefusion.com/pixel-art-vfx/pickup), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, WHITE, burst, clamp, ease, fit, fly } from '../_core.js';

export const meta = {
  den: { surface: 'town', from: 'pickups/collect-burst', anchor: 'chest', depth: 'over' },
  name: 'Heart burst',
  desc: 'A wave lands: a white pop at the chest, a ring snaps out and a ring of little pink hearts bursts out, brakes, hangs, then floats up shrinking away among twinkles.',
  tags: ['town', 'wave', 'heart', 'burst', 'social', 'one-shot'],
  size: [48, 48],
  origin: [24, 30],
  duration: 0.8,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.pink, seed: 4 },
};

// hearts from big to small: 'b' body, 'h' highlight, 'm' shade
const BIG = ['.bb.bb.', 'bhbbbbb', 'bbbbbbb', '.bbbbm.', '..bbm..', '...m...'];
const SMALL = ['.b.b.', 'bhbbb', '.bbm.', '..m..'];
const TINY = ['b.b', 'bbm', '.m.'];

const N = 7;

function heart(p, rows, x, y, pal) {
  const w = rows[0].length;
  const h = rows.length;
  p.sprite(rows, pal, Math.round(x - w / 2), Math.round(y - h / 2));
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const lit = { b: C[3], h: WHITE, m: C[2] };
  const white = { b: WHITE, h: WHITE, m: C[4] };

  // the pop: a white disc in a pink rim and a cross of light, gone in two frames
  if (t < 0.1) {
    const k = 1 - t / 0.1;
    p.circle(0, 0, 1.2 * k + 1.8, C[4]);
    p.circle(0, 0, 1.2 * k + 0.8, WHITE);
    const L = 5 * k;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      p.line(dx * 3, dy * 3, dx * (3 + L), dy * (3 + L), (u) => (u < 0.5 ? WHITE : C[4]));
    p.glow(0, 0, 14, C[4], 0.3 * k);
  }
  // a thin ring snapping out ahead of the hearts
  const u = t / 0.25;
  if (u < 1) {
    const r = 4 + 12 * ease.outExpo(u);
    p.ring(0, 0, r, 1, u < 0.3 ? WHITE : C[4], 1.3 - u * 1.2);
    p.glowRing(0, 0, r, 3, C[4], 0.25 * (1 - u));
  }
  // the hearts: thrown out round the chest, braked hard, hanging, then floating up as they shrink
  burst(N, o.seed, (r, i) => {
    // a ring with a gap at the feet, wider than tall, so they burst clear of the face and body
    const a = -Math.PI / 2 + ((i - (N - 1) / 2) / (N - 1)) * TAU * 0.62 + r.range(-0.1, 0.1);
    const rx = r.range(15, 18);
    const ry = Math.sin(a) > 0 ? r.range(6, 8) : r.range(13, 15);
    const d = r.range(0, 0.04);
    const life = r.range(0.55, 0.72);
    const age = t - 0.03 - d;
    if (age < 0 || age >= life) return;
    const drag = 11;
    // born on the rim of the pop as a white spark; it blooms into a heart once it is clear of the face
    const at = (q) =>
      fly(
        Math.cos(a) * 4,
        Math.sin(a) * 3,
        Math.cos(a) * (rx - 4) * drag,
        Math.sin(a) * (ry - 3) * drag,
        q,
        0,
        drag,
      );
    const [bx, by] = at(age);
    const away = (q) => {
      const [qx, qy] = at(q);
      return Math.hypot(qx / rx, qy / ry) > 0.62;
    };
    if (!away(age)) {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      p.line(bx - ux * 3, by - uy * 3, bx, by, (v) => (v > 0.5 ? WHITE : C[4]));
      return;
    }
    const rise = r.range(6, 9) * ease.inQuad(clamp((age - 0.25) / (life - 0.25)));
    const x = bx + Math.sin(age * 9 + i) * clamp((age - 0.25) * 4) * 1.2;
    const y = by - rise;
    const k = 1 - age / life;
    const big = i % 3 === 0;
    const rows = k > 0.5 ? (big ? BIG : SMALL) : k > 0.22 ? (big ? SMALL : TINY) : null;
    if (!rows) {
      if (Math.sin(age * 60 + i) > -0.3) p.px(Math.round(x), Math.round(y), C[3]);
      return;
    }
    heart(p, rows, x, y, away(age - 0.04) ? lit : white);
    p.glow(Math.round(x) + 0.5, Math.round(y) + 0.5, 5, C[4], 0.12 * k);
  });
  // twinkles winking among them
  burst(5, o.seed + 77, (r, i) => {
    const t0 = 0.12 + i * 0.08 + r.range(0, 0.04);
    const life = r.range(0.12, 0.2);
    const age = t - t0;
    if (age < 0 || age >= life) return;
    const a = r.range(0, TAU);
    const R = r.range(9, 17);
    const X = Math.round(Math.cos(a) * R);
    const Y = Math.round(Math.sin(a) * R * 0.9 - 3 - age * 10);
    const arm = Math.sin((age / life) * Math.PI) > 0.6 ? 2 : 1;
    for (let s = 1; s <= arm; s++) {
      const c = s === arm && arm > 1 ? C[4] : C[3];
      p.px(X + s, Y, c);
      p.px(X - s, Y, c);
      p.px(X, Y + s, c);
      p.px(X, Y - s, c);
    }
    p.px(X, Y, WHITE);
  });
}
