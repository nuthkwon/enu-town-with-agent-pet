// Adapted from pixelfx holy/divine-shield (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
//
// Shown the whole time someone is in focus mode, so it stays quiet: a thin bubble round the person with a rim lit
// at the top left, a film you only see near the rim (the person stays fully readable), a sheen sweeping across
// once a loop, two glints winking at different times, the near half of a seal on the floor. A function of t.
import { DEN, TAU, WHITE, clamp, fit } from '../_core.js';
import { oval } from '../_lib/holy.js';

export const meta = {
  name: 'Focus shield',
  desc: 'A quiet bubble round someone in focus: a thin lavender rim lit at the top left, a film only near the rim, a slow sheen sweeping across and two glints winking in turn; 2 s loop.',
  tags: ['aura', 'focus', 'shield', 'bubble', 'status', 'loop'],
  size: [40, 48],
  origin: [20, 44],
  duration: 2,
  loop: true,
  fps: 12,
  bg: 'ground',
  options: { palette: DEN.lavender, accent: DEN.sky, seed: 8 },
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'holy/divine-shield' },
};

const CY = -15;
const RAD = 18;
const FLOOR_SY = 0.24;
// the two glints: where on the rim (angle), when in the loop they wink (phase), how big
const GLINTS = [
  { g: 3.75, at: 0.12, arm: 3 },
  { g: 5.55, at: 0.6, arm: 2.6 },
];

// the sheen: a diagonal band crossing the bubble in the first part of the loop, then a rest
const sheen = (ph) => -1.6 + 3.2 * clamp(ph / 0.5);
// how far along the diagonal (top left -1 .. bottom right 1) a point is
const diag = (x, y) => (x + (y - CY)) / (RAD * 1.414);

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const K = fit(o.accent, 7);
  const ph = (((t / meta.duration) % 1) + 1) % 1;
  const sw = sheen(ph);

  // the film: clear where the bubble faces us, a breath of sky toward the rim, a little brighter in the sheen
  p.each(-RAD, CY - RAD, RAD, CY + RAD, (x, y, sx, sy) => {
    const d = Math.hypot(x, y - CY) / RAD;
    if (d >= 0.97) return;
    const hot = Math.max(0, 1 - Math.abs(diag(x, y) - sw) / 0.16);
    const a = 0.2 * Math.pow(d, 8) + 0.24 * hot * clamp((d - 0.55) / 0.35);
    if (a > 0.02) p.blendPx(sx, sy, hot > 0.5 ? WHITE : K[5], a);
  });

  // the rim: one pixel, white where the light sits (top left) and where the sheen crosses, lavender round the
  // side, a deeper lavender underneath so it holds on a pastel floor
  for (let j = 0, n = Math.ceil(RAD * TAU * 1.3); j < n; j++) {
    const g = (j / n) * TAU;
    const x = Math.cos(g) * RAD;
    const y = CY + Math.sin(g) * RAD;
    if (y > 2) continue;
    const lit = Math.cos(g + 2.36);
    const hot = Math.abs(diag(x, y) - sw) < 0.12;
    p.px(x, y, hot || lit > 0.8 ? WHITE : lit > 0.1 ? C[4] : lit > -0.65 ? C[3] : K[3]);
  }

  // a soap bubble's shine: a short bright curl inside the rim at the top left
  for (let g = 3.6; g < 4.15; g += 0.05)
    p.px(Math.cos(g) * (RAD - 2.5), CY + Math.sin(g) * (RAD - 2.5), g > 3.75 && g < 4.0 ? WHITE : C[5]);

  // where it meets the floor: the near half of a faint seal
  const rf = Math.sqrt(RAD * RAD - CY * CY);
  oval(
    p,
    0,
    0,
    rf,
    rf * FLOOR_SY,
    (g) => (Math.sin(g) > 0.7 ? C[4] : C[3]),
    0.7,
    (g) => Math.sin(g) >= 0,
  );

  // two glints wink on the rim, one after the other
  for (const s of GLINTS) {
    const u = (((ph - s.at) % 1) + 1) % 1;
    if (u > 0.22) continue;
    const k = Math.sin((Math.PI * u) / 0.22);
    const n = Math.round(s.arm * k + 0.3);
    const X = Math.round(Math.cos(s.g) * RAD);
    const Y = Math.round(CY + Math.sin(s.g) * RAD);
    p.px(X, Y, WHITE);
    for (let d = 1; d <= n; d++) {
      const c = d === n ? C[3] : d === n - 1 ? C[5] : WHITE;
      p.px(X + d, Y, c);
      p.px(X - d, Y, c);
      p.px(X, Y + d, c);
      p.px(X, Y - d, c);
    }
  }
}
