// Adapted from pixelfx arcane/rune-circle (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The floor glow and the specks rising off it follow Sprite Fusion's open-source mana heal
// (https://www.spritefusion.com/pixel-art-vfx/heal), MIT License, Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, WHITE, burst, ease, fit, seg } from '../_core.js';
import { floorRing } from '../_lib/arcane.js';

export const meta = {
  den: { surface: 'pet', from: 'arcane/rune-circle', stand: 'companion', depth: 'under' },
  name: 'Familiar summon circle',
  desc: 'A reply arrives: a flat rune circle flashes on under the familiar (rings, a turning square, little runes riding round, studs), glints rise off it, and it is wiped away from the front round to the back; 1 s, drawn under the familiar.',
  tags: ['pet', 'familiar', 'reply', 'summon', 'rune', 'circle', 'arcane', 'ground', 'one-shot'],
  size: [48, 24],
  origin: [24, 16],
  duration: 1.0,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.lavender, seed: 8 },
};

// the circle on the floor: outer band, inner ring, the track the runes stand on, studs (rx, ry in px)
const RO = [19, 5.2];
const RI = [10, 2.7];
const RR = [14.5, 4];
const RS = [21, 6.2];
// little original runes, 3 x 3, standing upright round the outside
const RUNES = [
  ['.#.', '#.#', '.#.'],
  ['#.#', '###', '.#.'],
  ['#..', '###', '..#'],
  ['.#.', '###', '#.#'],
  ['##.', '#.#', '.##'],
  ['.#.', '##.', '.##'],
];
// the angle round the ellipse, measured from the front (0) to the back (pi) either way
const fromFront = (g) => Math.abs(Math.atan2(Math.sin(g - Math.PI / 2), Math.cos(g - Math.PI / 2)));

// a four-point twinkle: arms of arm px, a white heart
function twinkle(p, x, y, arm, c, tip) {
  const X = Math.round(x);
  const Y = Math.round(y);
  for (let d = 1; d <= arm; d++) {
    const k = d === arm && arm > 1 ? tip : c;
    p.px(X + d, Y, k);
    p.px(X - d, Y, k);
    p.px(X, Y + d, k);
    p.px(X, Y - d, k);
  }
  p.px(X, Y, arm > 0 ? WHITE : c);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  // it flashes on fast (rings snapping out to size), holds, then is wiped away from the front round to the back
  const grow = ease.outQuart(seg(t, 0, 0.15));
  const flash = t < 0.1;
  const wipe = Math.PI * ease.inOutQuad(seg(t, 0.6, 0.92));
  if (wipe >= Math.PI) return;
  const shown = (g) => fromFront(g) >= wipe;
  const spin = t * 1.4;
  const k = 0.25 + 0.75 * grow;
  const ring = ([rx, ry], s, c) => floorRing(p, 0, 0, rx * s, ry / rx, c, (g) => (shown(g) ? 1 : 0));
  p.glow(0, 0, 22 * grow, C[4], (flash ? 0.35 : 0.2) * (1 - wipe / Math.PI));
  // the flash it opens from: a streak of light across the floor with a spike of light up through it
  if (t < 0.1) {
    const q = t / 0.1;
    const L = 8 + 14 * ease.outQuad(q);
    p.line(-L, 0, L, 0, (u) => (Math.abs(u - 0.5) < 0.12 ? C[5] : Math.abs(u - 0.5) < 0.3 ? C[4] : C[3]));
    if (q < 0.6) p.line(0, -6 * (1 - q), 0, 2 * (1 - q), (u) => (u < 0.3 ? C[3] : C[4]));
  }
  ring(RO, k, flash ? C[2] : C[3]);
  ring([RO[0] - 1, RO[1] - 0.8], k, flash ? WHITE : C[5]);
  if (t > 0.1) {
    const k3 = ease.outBack(seg(t, 0.1, 0.24), 2.2);
    ring(RI, k3, C[3]);
    // a square turning the other way inside the inner ring, its corners touching it
    const pts = [0, 1, 2, 3].map((q) => -spin + Math.PI / 4 + (q * TAU) / 4);
    for (let q = 0; q < 4; q++) {
      const g0 = pts[q];
      const g1 = pts[(q + 1) % 4];
      if (!shown((g0 + g1) / 2)) continue;
      p.line(
        Math.cos(g0) * RI[0] * k3,
        Math.sin(g0) * RI[1] * k3,
        Math.cos(g1) * RI[0] * k3,
        Math.sin(g1) * RI[1] * k3,
        C[4],
      );
    }
  }
  // studs round the outside, popping on in turn
  for (let j = 0; j < 10; j++) {
    const g = -spin * 0.5 + (j * TAU) / 10;
    if (t < 0.1 + j * 0.012 || !shown(g)) continue;
    p.px(Math.cos(g) * RS[0] * k, Math.sin(g) * RS[1] * k, t < 0.16 + j * 0.012 ? C[2] : C[3]);
  }
  // runes standing in the band and riding round, each flaring as it lights; the far ones dimmer
  for (let j = 0; j < RUNES.length; j++) {
    const g = spin * 0.8 + (j * TAU) / RUNES.length + 0.3;
    const lit = t - (0.12 + j * 0.03);
    if (lit < 0 || !shown(g)) continue;
    const x = Math.round(Math.cos(g) * RR[0] * k) - 1;
    const y = Math.round(Math.sin(g) * RR[1] * k) - 2 - (lit < 0.1 ? 1 : 0);
    const far = Math.sin(g) < 0;
    p.sprite(RUNES[j], {}, x, y, { tint: lit < 0.05 ? C[4] : far ? C[3] : C[2] });
    if (lit < 0.1) p.glow(x + 1, y + 1, 5, C[4], 0.3);
  }
  // glints rise off the circle beside the familiar, twinkling
  burst(9, o.seed, (r, i) => {
    const t0 = 0.12 + i * 0.05 + r.range(0, 0.04);
    const life = r.range(0.32, 0.45);
    const u = (t - t0) / life;
    if (u < 0 || u >= 1) return;
    const side = i % 2 ? 1 : -1;
    const x0 = side * r.range(11, 18);
    const y0 = r.range(-1.5, 2.5);
    const x = x0 + Math.sin(u * 5 + i) * 0.8;
    const y = y0 - 15 * ease.outQuad(u);
    const arm = u < 0.15 || u > 0.8 ? 0 : u < 0.55 ? 2 : 1;
    twinkle(p, x, y, arm, i % 3 ? C[3] : C[4], C[2]);
    p.glow(x, y, 4, C[4], 0.25 * Math.sin(Math.PI * u));
  });
}
