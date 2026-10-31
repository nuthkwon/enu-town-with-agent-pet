// Adapted from pixelfx arcane/blink-out (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The blink (a crackling outline as it gathers, a white flash, the silhouette squeezed into a line, a ring on the
// floor) is adapted from Sprite Fusion's open-source blink (https://www.spritefusion.com/pixel-art-vfx/movement),
// MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, band, burst, ease, fit, flare, fly, lerp, rand } from '../_core.js';
import { squeezed } from '../_lib/arcane.js';

// A colleague leaves (or steps away): the spot crackles with gathering light round them, flashes white, squeezes
// into a vertical line of light that collapses to a point and pops away in a few sparks. Same footprint and
// loudness as the small sparkle it replaces; the flash covers the avatar as it fades out.
const OUT = 0.22,
  SQUEEZE = 0.1,
  COLLAPSE = 0.07,
  POP = OUT + SQUEEZE + COLLAPSE,
  END = 0.7;
const CHEST = -13;

export const meta = {
  name: 'Blink out',
  desc: 'A colleague leaves: the spot crackles with gathering light, flashes white, squeezes into a line of light that collapses and pops away in a few sparks. Lavender, 0.7 s, on the feet.',
  tags: ['town', 'leave', 'blink', 'vanish', 'teleport', 'one-shot'],
  size: [40, 56],
  origin: [20, 52],
  duration: END,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.lavender, seed: 11 },
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'arcane/blink-out' },
};

// our avatar's silhouette (a big round head over a small body, feet on y = 0), the shape the light takes
const ROWS = [
  '.......######.......',
  '.....##########.....',
  '....############....',
  '...##############...',
  '..################..',
  '.##################.',
  '.##################.',
  '.##################.',
  '.##################.',
  '.##################.',
  '####################',
  '####################',
  '.##################.',
  '..################..',
  '...##############...',
  '....############....',
  '.....##########.....',
  '....############....',
  '....############....',
  '....############....',
  '....############....',
  '.....##########.....',
  '.....##########.....',
  '.....##########.....',
  '.....##########.....',
  '......###..###......',
];
const AW = ROWS[0].length,
  AH = ROWS.length;
const MASK = { w: AW, h: AH, data: Uint8Array.from(ROWS.join(''), (ch) => (ch === '#' ? 1 : 0)) };
const BODY = { x: -AW / 2, y: -AH, w: AW, h: AH, mask: MASK };
const on = (x, y) => x >= 0 && y >= 0 && x < AW && y < AH && MASK.data[y * AW + x] === 1;
// 1 on the silhouette's rim, 2 inside: the squeeze draws the rim in the edge color
const SHADES = Uint8Array.from({ length: AW * AH }, (_, i) => {
  const x = i % AW,
    y = Math.floor(i / AW);
  if (!on(x, y)) return 0;
  return on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1) ? 2 : 1;
});
// the pixels just outside it, where the gathering light crackles
const RIM = [];
for (let y = -1; y <= AH; y++)
  for (let x = -1; x <= AW; x++)
    if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) && y < AH)
      RIM.push([BODY.x + x, BODY.y + y]);

function gather(p, C, t, S) {
  if (t >= OUT) return;
  const k = t / OUT,
    f = Math.floor(t * 40);
  // the outline crackles, thicker as it gathers
  for (const [x, y] of RIM)
    if (rand(x + 40, y + 60, f, S) < 0.12 + 0.55 * k * k)
      p.px(x, y, k > 0.6 && rand(x, y, 7) < 0.5 ? C[6] : C[5]);
  // little arcs crackle off it, more as it gathers: a white zigzag with a violet edge
  const n = 1 + Math.floor(3 * k);
  for (let i = 0; i < n; i++) {
    const j = Math.floor(rand(f, i, S, 5) * RIM.length),
      [x0, y0] = RIM[j],
      len = 3 + Math.floor(rand(f, i, S, 6) * 3);
    const dx = x0 - 0,
      dy = y0 - CHEST,
      d = Math.hypot(dx, dy) || 1,
      ux = dx / d,
      uy = dy / d;
    let x = x0,
      y = y0;
    for (let s = 0; s < len; s++) {
      const side = (s % 2 ? 1 : -1) * (rand(f, i, s, S) < 0.7 ? 1 : 0);
      x += ux - uy * side * 0.8;
      y += uy + ux * side * 0.8;
      p.px(x + uy, y - ux, C[3]);
      p.px(x, y, s === len - 1 ? C[5] : C[6]);
    }
    p.glow(x0, y0, 4, C[5], 0.25);
  }
  // the body fills with light
  if (k > 0.3)
    for (let y = 0; y < AH; y++)
      for (let x = 0; x < AW; x++)
        if (SHADES[y * AW + x] === 2) p.light(BODY.x + x, BODY.y + y, C[6], 0.3 * ((k - 0.3) / 0.7) ** 2);
  // light rushes in to the chest
  burst(10, S * 17 + 1, (r) => {
    const tb = r.range(0, OUT - 0.08),
      T = r.range(0.07, 0.11),
      age = t - tb;
    if (age < 0 || age >= T) return;
    const g = r.range(0, TAU),
      D = r.range(14, 19),
      sx = Math.cos(g) * D,
      sy = CHEST + Math.sin(g) * D * 0.9;
    const u = ease.inQuad(age / T),
      u0 = ease.inQuad(Math.max(0, age - 0.03) / T);
    p.line(lerp(sx, 0, u0), lerp(sy, CHEST, u0), lerp(sx, 0, u), lerp(sy, CHEST, u), C[4]);
    p.px(lerp(sx, 0, u), lerp(sy, CHEST, u), C[6]);
  });
  p.glow(0, CHEST, 14, C[5], 0.3 * k);
}

function blink(p, C, t) {
  if (t < OUT || t >= POP) return;
  if (t < OUT + 0.04) {
    // the flash: the whole shape white-hot
    squeezed(p, BODY, SHADES, 1, C[6], C[5]);
    p.glow(0, CHEST, 18, C[5], 0.35);
  } else if (t < OUT + SQUEEZE) {
    // squeezed into a line, a little taller as it thins
    const q = ease.inCubic((t - OUT - 0.04) / (SQUEEZE - 0.04));
    squeezed(p, BODY, SHADES, 1 - q, C[6], C[5]);
    p.glow(0, CHEST, 14, C[5], 0.3);
  } else {
    // a line of light from the floor to over the head, shrinking to a point at the chest
    const q = ease.inQuad((t - OUT - SQUEEZE) / COLLAPSE),
      top = lerp(-AH - 4, CHEST, q),
      bot = lerp(-1, CHEST, q);
    for (let y = Math.round(top); y <= Math.round(bot); y++) {
      const end = y - top < 2 || bot - y < 2;
      p.px(0, y, end ? C[5] : C[6]);
      if (!end && bot - top > 8) {
        p.px(-1, y, C[4]);
        p.px(1, y, C[4]);
      }
    }
    p.glow(0, (top + bot) / 2, 10, C[5], 0.3);
  }
}

function pop(p, C, t, S) {
  if (t < POP) return;
  const u = t - POP;
  if (u < 0.15) {
    const q = u / 0.15;
    flare(p, 0, CHEST, 9 * Math.pow(1 - q, 1.5) + 1, 1 - q, C);
    if (q < 0.35) p.circle(0, CHEST, 2.5 * (1 - q / 0.35) + 0.6, C[6]);
    p.glow(0, CHEST, 12, C[5], 0.32 * (1 - q));
  }
  // a little ring on the floor where they stood
  const kr = u / 0.28;
  if (kr < 1)
    band(
      p,
      0,
      0,
      lerp(3, 12, ease.outCubic(kr)),
      0.3,
      Math.max(1, 2 * (1 - kr)),
      1.1 - kr,
      [C[3], C[4], C[5], C[6]],
      () => true,
      kr < 0.25,
    );
  // sparks pop out and fall away; a few glints drift up
  burst(12, S * 17 + 2, (r) => {
    const life = Math.min(r.range(0.16, 0.28), END - 0.02 - POP),
      age = u - r.range(0, 0.02);
    if (age < 0 || age >= life) return;
    const g = r.range(0, TAU),
      sp = r.range(40, 80),
      [x, y] = fly(0, CHEST, Math.cos(g) * sp, Math.sin(g) * sp - 25, age, 260, 3);
    const k = 1 - age / life,
      [px, py] = fly(0, CHEST, Math.cos(g) * sp, Math.sin(g) * sp - 25, Math.max(0, age - 0.025), 260, 3);
    p.line(px, py, x, y, k > 0.5 ? C[5] : C[4]);
    p.px(x, y, k > 0.4 ? C[6] : C[5]);
  });
  burst(6, S * 17 + 3, (r) => {
    const life = Math.min(r.range(0.2, 0.3), END - 0.02 - POP),
      age = u - r.range(0.02, 0.06);
    if (age < 0 || age >= life) return;
    const [x, y] = fly(
      r.range(-4, 4),
      CHEST + r.range(-6, 6),
      r.range(-14, 14),
      -r.range(18, 34),
      age,
      0,
      2.5,
    );
    const k = 1 - age / life,
      tw = Math.sin(age * 40 + r.range(0, TAU)) > -0.3;
    if (!tw) return;
    p.px(x, y, C[6]);
    if (k > 0.5) {
      p.px(x - 1, y, C[4]);
      p.px(x + 1, y, C[4]);
      p.px(x, y - 1, C[4]);
      p.px(x, y + 1, C[4]);
    }
  });
}

export function draw(p, t, o) {
  if (t >= END) return;
  const C = fit(o.palette, 7),
    S = o.seed;
  gather(p, C, t, S);
  blink(p, C, t);
  pop(p, C, t, S);
}
