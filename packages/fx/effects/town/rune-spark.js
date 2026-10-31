// Adapted from pixelfx arcane/mana-burst (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The release (a white disc, a cross, two rings, a big light and a spray of motes and stars) is adapted from
// Sprite Fusion's open-source energy charge (https://www.spritefusion.com/pixel-art-vfx/energy),
// MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, WHITE, burst, clamp, ease, fit, fly } from '../_core.js';

export const meta = {
  den: { surface: 'town', from: 'arcane/mana-burst', anchor: 'head', depth: 'over' },
  name: 'Rune spark',
  desc: "A colleague's Claude wrote their log: a small sky rune is traced above the head, blinks once and breaks into four lavender glints that drift up and wink out. Neutral and calm.",
  tags: ['town', 'log', 'rune', 'glint', 'neutral', 'one-shot'],
  size: [32, 32],
  origin: [16, 24],
  duration: 0.8,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.sky, glints: DEN.lavender, seed: 5 },
};

// the rune: a diamond traced from its top point down both sides, then its heart (offsets from its centre)
const STROKE = [
  [0, -2],
  [-1, -1],
  [1, -1],
  [-2, 0],
  [2, 0],
  [-1, 1],
  [1, 1],
  [0, 2],
];
const TIPS = [
  [0, -2],
  [-2, 0],
  [2, 0],
  [0, 2],
];
const ON = new Set([...STROKE, [0, 0]].map(([x, y]) => `${x},${y}`));
const NEAR = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const TRACE = 0.15;
const BLINK = 0.25;
const BREAK = 0.35;

const runeY = (t) => Math.round(-8 - 2 * ease.outCubic(clamp(t / BREAK)));

function glint(p, x, y, arm, core, tip) {
  const X = Math.round(x);
  const Y = Math.round(y);
  for (let d = 1; d <= arm; d++) {
    p.px(X + d, Y, tip);
    p.px(X - d, Y, tip);
    p.px(X, Y + d, tip);
    p.px(X, Y - d, tip);
  }
  p.px(X, Y, core);
}

export function draw(p, t, o) {
  const S = fit(o.palette, 7);
  const L = fit(o.glints, 7);
  if (t < BREAK) {
    const cy = runeY(t);
    const n = t < TRACE ? Math.floor((t / TRACE) * STROKE.length) + 1 : STROKE.length;
    const blink = t >= BLINK && t < BLINK + 0.05;
    // the blink: the rune goes white inside a 1 px sky halo, so it flares on the pale floors too
    if (blink)
      for (const [x, y] of STROKE)
        for (const [dx, dy] of NEAR) if (!ON.has(`${x + dx},${y + dy}`)) p.px(x + dx, cy + y + dy, S[3]);
    for (let i = 0; i < n; i++) {
      const [x, y] = STROKE[i];
      const lead = t < TRACE && i >= n - 2;
      p.px(x, cy + y, blink ? WHITE : lead ? S[3] : S[2]);
    }
    if (t >= TRACE) p.px(0, cy, blink ? WHITE : S[5]);
    p.glow(0.5, cy + 0.5, blink ? 9 : 7, S[3], blink ? 0.3 : 0.18);
    return;
  }
  const cy = runeY(BREAK);
  // the break: for a frame the strokes go pale and the four points crack off; then only the glints are left
  if (t - BREAK < 0.05) for (const [x, y] of STROKE) p.dot(x, cy + y, L[4], 0.75);
  burst(TIPS.length, o.seed, (r, i) => {
    const age = t - BREAK;
    const life = 0.27 + i * 0.045 + r.range(0, 0.03);
    if (age >= life) return;
    const [tx, ty] = TIPS[i];
    // a kick away from the rune, braked hard; then each one floats up at its own pace, swaying a little
    const out = r.range(30, 38);
    const vx = tx * 0.5 * out + r.range(-3, 3);
    const vy = ty > 0 ? 6 : ty * 0.5 * out - r.range(4, 10);
    const [fx, y] = fly(tx * 1.5, cy + ty * 1.5, vx, vy, age, -r.range(130, 230), 6);
    const x = fx + Math.sin(age * r.range(9, 13) + i * 1.7) * 0.9;
    const k = 1 - age / life;
    if (age < 0.05) {
      p.px(Math.round(x), Math.round(y), WHITE);
      return;
    }
    if (k < 0.25) {
      if (Math.sin(age * 70 + i * 3) > -0.2) p.px(Math.round(x), Math.round(y), L[2]);
      return;
    }
    // a pale lilac heart with deeper arms: it reads on the pale carpet as well as at night
    const arm = Math.sin(age * 32 + i * 2.1) > -0.4 ? 1 : 0;
    glint(p, x, y, arm, arm ? L[4] : L[3], L[2]);
    p.glow(Math.round(x) + 0.5, Math.round(y) + 0.5, 4, L[4], 0.15 * k);
  });
}
