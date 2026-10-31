// Adapted from pixelfx lightning/zap-hit (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The arc's halo-body-core inking, its flicker and the light that strobes as it dies follow Sprite Fusion's
// open-source lightning (https://www.spritefusion.com/pixel-art-vfx/lightning), MIT License, Copyright (c) 2026 Hugo Duprez.
//
// ENU Den's after-crackle of 칭찬 번개: comic "찌릿" marks round the person, not a burn. No fern, no ozone smoke:
// little zigzag shock marks that pop out round the head and shoulders on two jolts, arcs that hop along the sides,
// star twinkles, a few sparks, and it is clean before it ends. The face stays clear: everything sits outside it.
import { DEN, Lights, P, Particles, Rng, WHITE, fit, rng, sparkle } from '../_core.js';
import { zigzag } from '../_lib/lightning.js';

export const meta = {
  den: { surface: 'town', anchor: 'chest', depth: 'over', from: 'lightning/zap-hit' },
  name: 'Praise lightning crackle',
  desc: 'The after-crackle of 칭찬 번개: tiny zigzag shock marks pop out round the head and shoulders on two jolts, little arcs hop along the sides, star twinkles pop, a few sparks spit off; volt ramp, 0.6 s, 48x40 on the chest.',
  tags: ['spell', 'lightning', 'zap', 'crackle', 'shock', 'comic', 'one-shot'],
  size: [48, 40],
  origin: [24, 24],
  duration: 0.6,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.volt, seed: 3 },
};

const FPS = 20;
// the person's outline round the chest anchor (the head dome sits above it, the feet 14 px below)
const CX = 0;
const CY = -2;
const RX = 12.5;
const RY = 13;
// marks per frame and their heat: a big jolt on frame 0, a smaller one on frame 5, then it settles
const MARKS = [5, 5, 3, 2, 2, 4, 4, 2, 2, 1, 0, 0];
const HEAT = [1, 1, 0.7, 0.5, 0.35, 0.9, 0.7, 0.5, 0.35, 0.25, 0, 0];
// twinkles: [first frame, angle, distance, size]
const TWINKLES = [
  [1, -2.3, 15, 2],
  [2, -0.6, 16, 2],
  [4, -1.6, 17, 1.5],
  [6, -2.8, 14, 2],
  [7, -0.2, 15, 1.5],
  [9, -1.2, 16, 1.5],
];

// where a mark sits: on the arc over the head from one side (a little below the shoulder) to the other, spread
// evenly and turned on every frame so the marks hop about; never low on the legs, so the floor stays clean
function spot(r, i, n, F) {
  const u = (i + 0.5 + r.range(-0.15, 0.15)) / n;
  return -Math.PI - 0.5 + ((u + F * 0.37) % 1) * (Math.PI + 1);
}

// a comic shock mark, one glyph every time: a mini bolt pointing away from the person (a long stroke out, a short
// stroke back across, a long stroke out), a lemon-white core over a blue shadow, a white tip
function mark(p, x, y, g, L, heat, C, side) {
  const c = Math.cos(g);
  const s = Math.sin(g);
  const nx = -s * side;
  const ny = c * side;
  const pts = [
    [x - nx * 1.2, y - ny * 1.2],
    [x + c * L * 0.48 + nx * 1.2, y + s * L * 0.48 + ny * 1.2],
    [x + c * L * 0.52 - nx * 1.2, y + s * L * 0.52 - ny * 1.2],
    [x + c * L + nx * 1.2, y + s * L + ny * 1.2],
  ];
  const core = heat > 0.8 ? WHITE : heat > 0.45 ? C[5] : C[4];
  const shade = heat > 0.3 ? C[2] : C[3];
  for (let i = 0; i < 3; i++)
    p.line(pts[i][0] + 1, pts[i][1] + 1, pts[i + 1][0] + 1, pts[i + 1][1] + 1, shade);
  for (let i = 0; i < 3; i++) p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], core);
  p.px(pts[3][0], pts[3][1], WHITE);
  p.glow(x + c * L * 0.5, y + s * L * 0.5, 5, C[4], 0.18 * heat);
}

// a little arc hopping between two points of the outline, re-struck every frame
function hop(p, r, g0, heat, C) {
  const g1 = g0 + r.sign() * r.range(0.35, 0.6);
  const at = (g, k) => [CX + Math.cos(g) * RX * k, CY + Math.sin(g) * RY * k];
  const [x0, y0] = at(g0, r.range(0.95, 1.08));
  const [x1, y1] = at(g1, r.range(0.95, 1.08));
  const pts = zigzag(r, x0, y0, x1, y1, 0.5, 0).paths[0].pts;
  for (let i = 0; i < pts.length - 1; i++)
    p.line(pts[i][0], pts[i][1] + 1, pts[i + 1][0], pts[i + 1][1] + 1, C[2]);
  for (let i = 0; i < pts.length - 1; i++)
    p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], heat > 0.6 ? WHITE : C[4]);
}

export function create(o) {
  const C = fit(o.palette, 7);
  const R = new Rng(o.seed);
  const ps = new Particles({ rng: R, ground: () => 14, sparks: [C[6], C[4], C[3], C[2]] });
  const lights = new Lights();
  let T = 0;
  let fired = -1;

  const jolt = (k) => {
    // light only off the sides of the head, never a haze over the face
    lights.add(-RX, CY, 9, C[4], 0.2 * k, 0.15);
    lights.add(RX, CY, 9, C[4], 0.2 * k, 0.15);
    for (let j = 0; j < Math.round(6 * k); j++) {
      const g = -Math.PI / 2 + R.range(-1.6, 1.6);
      const sp = R.range(70, 120);
      ps.spawn(
        P.SPARK,
        CX + Math.cos(g) * RX,
        CY + Math.sin(g) * RY,
        Math.cos(g) * sp,
        Math.sin(g) * sp - 20,
        R.range(0.12, 0.24),
      );
    }
  };

  return {
    update(dt) {
      T += dt;
      const F = Math.floor(T * FPS + 1e-3);
      if (F >= 0 && fired < 0) {
        fired = 0;
        jolt(1);
      }
      if (F >= 5 && fired < 5) {
        fired = 5;
        jolt(0.7);
      }
      ps.update(dt);
      ps.list = ps.list.filter((q) => q.x > -22 && q.x < 22 && q.y > -22 && q.y < 15);
      lights.update(dt);
    },
    draw(p) {
      const F = Math.floor(T * FPS + 1e-3);
      if (F >= MARKS.length) return;
      const lk = p.lightK;
      const r = rng(o.seed, 5, F);
      const n = MARKS[F];
      const heat = HEAT[F];
      // the shock marks pop out round the outline, a little further out on a jolt's second frame
      for (let i = 0; i < n; i++) {
        const g = spot(r, i, n, F);
        const out = F === 1 || F === 6 ? 1.5 : 0;
        const x = CX + Math.cos(g) * (RX + out);
        const y = CY + Math.sin(g) * (RY + out);
        mark(p, x, y, g, r.range(6, 7.5) * (0.75 + 0.25 * heat), heat, C, r.sign());
      }
      // arcs hop along the sides of the head and body
      if (heat > 0.3 && F !== 0 && F !== 5)
        hop(p, r, (r.chance(0.5) ? 0 : Math.PI) + r.range(-0.9, 0.5) * (r.chance(0.5) ? 1 : -1), heat, C);
      // star twinkles: pop, peak, shrink
      for (const [f0, g, d, s] of TWINKLES) {
        const age = F - f0;
        if (age < 0 || age > 2) continue;
        const arm = [s, s + 1, s - 0.5][age];
        sparkle(
          p,
          CX + Math.cos(g) * d,
          CY + Math.sin(g) * d * 0.9,
          arm,
          age === 1 ? C[5] : C[4],
          C[3],
          0.22,
        );
      }
      p.lightK = lk * 0.6;
      ps.draw(p);
      p.lightK = lk;
      lights.draw(p);
    },
  };
}
