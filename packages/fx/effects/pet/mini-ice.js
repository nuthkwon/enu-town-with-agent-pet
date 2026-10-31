import { DEN, TAU, WHITE, burst, ease, fit, fly, seg, sparkle } from '../_core.js';

export const meta = {
  name: 'Mini ice',
  desc: 'The familiar shows a tiny ice spell: frost swirls in above its head and gathers into a little faceted crystal that glints, flashes and bursts into snowflakes drifting slowly down. Sky ramp, 1 s.',
  tags: ['pet', 'familiar', 'spell', 'ice', 'crystal', 'snowflake', 'one-shot'],
  size: [32, 32],
  origin: [16, 28],
  duration: 1,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.sky, seed: 5 },
  den: { surface: 'pet', stand: 'companion', anchor: 'feet', depth: 'over' },
};

const CX = 0;
const CY = -22.5; // just above the ears (the head tops out at y = -20)
const GROW0 = 0.16; // the crystal starts to form
const GROW1 = 0.36; // fully formed
const POP = 0.525; // it bursts (the white frame lands on 0.55)

// the crystal at three sizes as it forms, hand-placed so the facets read at 1 px: k rim, K shadowed rim,
// w the lit ridge, l the pale left facet, m the middle, r the right facet, d its shaded edge
const GEM = [
  ['.k.', 'krk', 'kwd', 'kdK', '.K.'],
  ['..k..', '.kwk.', 'kwrdk', 'kwrdk', 'kmrdK', '.kdK.', '..K..'],
  [
    '...k...',
    '..kwk..',
    '.kwlmk.',
    'kwllmrk',
    'kwlmmrk',
    'kwlmrdk',
    'klmmrdK',
    '.kmrdK.',
    '..kdK..',
    '...K...',
  ],
];

// draws one of the gems centred on (x, y): `white` flashes it, `shine` sweeps a diagonal highlight (x offset)
function gem(p, C, size, x, y, white, shine) {
  const rows = GEM[size];
  const h = rows.length;
  const w = rows[0].length;
  const x0 = Math.round(x - (w - 1) / 2);
  const y0 = Math.round(y - h / 2);
  const pal = { k: C[1], K: C[0], w: WHITE, l: C[5], m: C[4], r: C[3], d: C[2] };
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const ch = rows[j][i];
      if (ch === '.') continue;
      const rim = ch === 'k' || ch === 'K';
      let c = pal[ch];
      if (white) c = rim ? C[3] : WHITE;
      else if (!rim && shine !== null && Math.abs(i - (w - 1) / 2 + (j - h / 2) * 0.6 - shine) < 0.8)
        c = WHITE;
      p.px(x0 + i, y0 + j, c);
    }
}

// a tiny snowflake: six arms when big enough, else a plus that flips to a cross as it turns
function flake(p, C, x, y, r, rot, hot) {
  const X = Math.round(x);
  const Y = Math.round(y);
  if (r < 1.5) {
    p.px(X, Y, hot ? C[1] : C[2]);
    return;
  }
  if (r < 2.5) {
    const pose = Math.floor(rot / (Math.PI / 4)) % 2;
    const arms = pose
      ? [
          [1, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
        ]
      : [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
    for (const [dx, dy] of arms) p.px(X + dx, Y + dy, C[2]);
    p.px(X, Y, hot ? WHITE : C[4]);
    return;
  }
  const g0 = Math.round(rot / (Math.PI / 6)) * (Math.PI / 6);
  for (let k = 0; k < 6; k++) {
    const g = g0 + (k * TAU) / 6;
    const ex = X + 0.5 + Math.cos(g) * r;
    const ey = Y + 0.5 + Math.sin(g) * r;
    p.line(X + 0.5, Y + 0.5, ex, ey, C[2]);
    p.px(ex, ey, C[1]);
  }
  p.px(X, Y, hot ? WHITE : C[4]);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const seed = o.seed;

  // 1. frost swirls in on a flat spiral and is drawn into the heart
  burst(8, seed, (r, i) => {
    const t0 = r.range(0, 0.12) + (i % 2) * 0.04;
    const T = r.range(0.14, 0.2);
    const u = (t - t0) / T;
    if (u < 0 || u >= 1) return;
    const a0 = Math.PI * (0.62 + (i / 7) * 1.76) + r.range(-0.15, 0.15);
    const R0 = r.range(8, 11);
    const at = (uu) => {
      const rad = R0 * (1 - ease.inQuad(uu));
      const a = a0 + 1.6 * uu;
      return [CX + Math.cos(a) * rad, CY + Math.sin(a) * rad * 0.38];
    };
    const [x, y] = at(u);
    const [bx, by] = at(Math.max(0, u - 0.12));
    p.line(bx, by, x, y, C[3]);
    p.px(x, y, C[2]);
  });

  // 2. a seed of ice, then the crystal forms in three steps, bobs, a shine sweeps it and a glint winks
  if (t >= 0.05 && t < GROW0) {
    p.px(CX, CY, C[2]);
    if (t > 0.1)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.px(CX + dx, CY + dy, C[3]);
  }
  if (t >= GROW0 && t < POP + 0.05) {
    const size = t < GROW0 + 0.05 ? 0 : t < GROW0 + 0.1 ? 1 : 2;
    const bob = t > GROW1 ? Math.round(Math.sin((t - GROW1) * TAU * 2.5) * 0.7) : 0;
    const sh = seg(t, 0.37, 0.47);
    const shine = sh > 0 && sh < 1 ? -5 + 10 * sh : null;
    gem(p, C, size, CX, CY + bob, t >= POP, shine);
    if (t < POP) p.glow(CX, CY, 10, C[3], 0.18 + 0.12 * seg(t, GROW1, POP)); // the burst brings its own light
    const g = seg(t, 0.42, 0.52);
    if (g > 0 && g < 1)
      sparkle(p, CX - 4, CY - 3 + bob, Math.round(3 * Math.sin(g * Math.PI)), C[2], C[3], 0.3);
  }

  // 3. the burst: a flat ring of frost and shards flicked out
  const q = t - POP;
  if (q >= 0 && q < 0.1) {
    const k = q / 0.1;
    const rx = 5 + 5 * ease.outCubic(k);
    const ry = 2.5 + 1.5 * ease.outCubic(k);
    p.ellipse(CX, CY, rx, ry, k < 0.5 ? C[3] : C[2], (d, a) =>
      d > 1 - 1.1 / ry && (k < 0.5 || Math.sin(a * 6) > 0.3) ? 1 : 0,
    );
    p.glow(CX, CY, 10, C[4], 0.35 * (1 - k));
  }

  // 4. snowflakes: flung out to both sides, slowing fast, then drifting down slowly, swaying, twinkling, melting away
  if (q >= 0.02)
    burst(6, seed + 7, (r, i) => {
      const dir = i % 2 ? 1 : -1;
      const big = i < 2;
      const vx = dir * (big ? r.range(56, 62) : i < 4 ? r.range(30, 36) : r.range(12, 16));
      const vy = big ? r.range(-6, 0) : i < 4 ? -r.range(14, 18) : r.range(16, 22);
      const life = r.range(0.41, 0.44);
      const k = q / life;
      if (k >= 1) return;
      const [x0, y] = fly(CX + dir, CY, vx, vy, q, 66, 6);
      const x = x0 + Math.sin(q * 10 + i * 1.7) * 0.7;
      const rad = (big ? 3 : i < 4 ? 2 : 1) * (k < 0.75 ? 1 : 0.6);
      const tw = Math.floor(q * 20 + i) % 4 === 0;
      if (k > 0.82 && Math.round(t * 20) % 2) return; // winks out
      flake(p, C, x, y, rad, q * (big ? 5 : 8) + i, tw);
    });
}
