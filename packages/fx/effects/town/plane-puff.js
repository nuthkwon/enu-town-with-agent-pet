// Adapted from pixelfx spawn/poof (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The soft, top-lit smoke puffs (a body, a denser core, a lit cap) follow Sprite Fusion's open-source explosion
// (https://www.spritefusion.com/pixel-art-vfx/explosion), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, WHITE, burst, clamp, ease, fit, fly } from '../_core.js';

export const meta = {
  den: { surface: 'town', from: 'spawn/poof', anchor: 'free', depth: 'over', stand: 'none' },
  name: 'Plane puff',
  desc: 'A DM paper plane takes off or lands: a tiny white pop, a soft lumpy puff of round cloud balls with three sky speed lines and two tiny stars, thinning away ball by ball.',
  tags: ['town', 'dm', 'plane', 'puff', 'cloud', 'one-shot'],
  size: [32, 24],
  origin: [16, 18],
  duration: 0.5,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.sky, puff: DEN.puff, seed: 2 },
};

const CY = -5;
const LINES = [-150, -90, -30].map((d) => (d * Math.PI) / 180);

export function draw(p, t, o) {
  const S = fit(o.palette, 7);
  const F = fit(o.puff, 6);

  // the balls: a ring thrown out and braked hard, a fat one or two in the middle, each swelling then going out
  const balls = [];
  burst(7, o.seed, (r, i) => {
    const ring = i < 5;
    // the ring evenly round (a little jitter), the middle ones only lifted, so the cloud stays centred
    // (one ball at the bottom and two humps on top: a cloud's silhouette, not a creature's legs)
    const a = ring
      ? (i / 5) * TAU + r.range(-0.15, 0.15) + Math.PI / 2
      : -Math.PI / 2 + (i === 5 ? -0.6 : 0.6);
    const sp = ring ? r.range(38, 46) : r.range(8, 12);
    const r1 = ring ? r.range(1.7, 2.4) : r.range(2.5, 2.9);
    const life = r.range(0.3, 0.44);
    const age = t - 0.03 - r.range(0, 0.03);
    if (age < 0 || age >= life) return;
    // thrown out sideways and up more than down, then lifted as it thins
    const down = Math.sin(a) > 0 ? 0.35 : 0.8;
    const [x, y] = fly(
      Math.cos(a) * 1.5,
      CY + Math.sin(a) * 1.5,
      Math.cos(a) * sp,
      Math.sin(a) * sp * down,
      age,
      -90,
      10,
    );
    const u = age / life;
    const grow = r1 * (0.5 + 0.5 * ease.outBack(clamp(age / 0.1), 2));
    const rad = grow * (u < 0.5 ? 1 : 1 - ease.inBack(clamp((u - 0.5) / 0.5), 1.2));
    if (rad > 0.6) balls.push({ x, y, r: rad, lit: age < 0.06 });
  });
  // shade, body, cap: neighbouring balls merge into one lumpy cloud, lit from the top left
  for (const b of balls) p.disc(b.x + b.r * 0.25, b.y + b.r * 0.3, b.r, b.lit ? F[3] : F[2], 0.8);
  for (const b of balls) p.disc(b.x - b.r * 0.12, b.y - b.r * 0.14, b.r * 0.8, b.lit ? WHITE : F[4], 0.92);
  for (const b of balls) p.disc(b.x - b.r * 0.32, b.y - b.r * 0.38, b.r * 0.4, WHITE, 0.9);

  // the pop: a white ball for a frame
  if (t < 0.05) {
    p.circle(0, CY, 3, S[4]);
    p.circle(0, CY, 2.2, WHITE);
    p.glow(0, CY, 10, S[4], 0.3);
  }
  // three speed lines flicked out and gone
  LINES.forEach((a, i) => {
    const q = (t - 0.02 - i * 0.012) / 0.16;
    if (q <= 0 || q >= 1) return;
    const r0 = 5;
    const r1 = 11;
    const head = r0 + (r1 - r0) * ease.outExpo(clamp(q / 0.6));
    const tail = r0 + (r1 - r0) * ease.inCubic(q);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    p.line(ca * tail, CY + sa * tail, ca * head, CY + sa * head, (v) => (v > 0.6 ? WHITE : S[2]));
  });
  // two tiny stars spun off
  burst(2, o.seed + 9, (r, i) => {
    const s = i ? 1 : -1;
    const age = t - 0.05;
    const life = r.range(0.3, 0.38);
    if (age < 0 || age >= life) return;
    const [x, y] = fly(s * 4, CY - 3, s * r.range(40, 55), -r.range(40, 55), age, 0, 5);
    const X = Math.round(x);
    const Y = Math.round(y);
    const k = 1 - age / life;
    const tw = Math.sin(age * 40 + i * 2) > -0.2;
    if (k > 0.3 && tw)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.px(X + dx, Y + dy, S[2]);
    p.px(X, Y, k > 0.3 ? WHITE : S[2]);
  });
}
