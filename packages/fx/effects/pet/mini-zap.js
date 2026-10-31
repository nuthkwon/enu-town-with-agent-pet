import { DEN, TAU, WHITE, burst, ease, fit, fly, rng, seg } from '../_core.js';

export const meta = {
  name: 'Mini zap',
  desc: 'The familiar shows a tiny lightning spell: sparks streak in to a crackling point above its head that pulses faster and swells, flashes, then pops into a little zigzag bolt with sparks flying off. Volt ramp, 1 s.',
  tags: ['pet', 'familiar', 'spell', 'lightning', 'electric', 'charge', 'one-shot'],
  size: [32, 32],
  origin: [16, 28],
  duration: 1,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.volt, seed: 4 },
  den: { surface: 'pet', stand: 'companion', anchor: 'feet', depth: 'over' },
};

const CX = 0;
const CY = -23; // just above the ears (the head tops out at y = -20)
const SWELL = 0.4; // the charge is full and starts to swell
const POP = 0.525; // it pops (the white frame lands on 0.55)

// the zigzag it pops into, as a polygon: a slanted top, a jog to the right, a point down to the left
const BOLT = [
  [-0.5, -5],
  [4, -5],
  [1.5, -1],
  [4, -1],
  [-1.5, 5],
  [0, 0.5],
  [-3, 0.5],
];

/** Draw the shape `inside` with a 1 px rim and `fill` inside. */
function blob(p, x0, y0, x1, y1, inside, fill, rim) {
  p.shade(x0, y0, x1, y1, (x, y) => {
    if (!inside(x, y)) return 0;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return rim;
    return fill(x, y);
  });
}

function inPoly(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function bolt(p, C, x, y, s, white) {
  const pts = BOLT.map(([bx, by]) => [x + bx * s, y + by * s]);
  const inside = (px, py) => inPoly(pts, px, py);
  // lemon body, its upper left edge catching the light
  const fill = (px, py) =>
    white || (inPoly(pts, px + 1, py + 1) && !inPoly(pts, px - 1, py - 1)) ? WHITE : C[4];
  blob(p, x - 4 * s, y - 6 * s, x + 5 * s, y + 6 * s, inside, fill, C[1]);
}

// a crackle: a 1 px zigzag from (x0, y0) out to (x1, y1) with its corners kicked sideways
function crackle(p, r, x0, y0, x1, y1, c) {
  const n = 3;
  let px = x0;
  let py = y0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const off = i < n ? r.range(-1.3, 1.3) : 0;
    const qx = x0 + dx * u + (-dy / L) * off;
    const qy = y0 + dy * u + (dx / L) * off;
    p.line(px, py, qx, qy, c);
    px = qx;
    py = qy;
  }
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const seed = o.seed;
  const f = Math.round(t * 20); // the frame, for flicker that changes every frame
  const charge = seg(t, 0.03, SWELL);

  // 1. sparks streak in from round about, faster as they come, more and more of them
  if (t < POP)
    burst(12, seed, (r, i) => {
      const t0 = 0.02 + 0.36 * Math.pow(i / 12, 0.8) + r.range(-0.015, 0.015);
      const T = r.range(0.12, 0.16) * (1 - 0.3 * (i / 12));
      const u = (t - t0) / T;
      if (u < 0 || u >= 1) return;
      const a = r.range(0, TAU);
      const R0 = r.range(10, 13);
      const at = (uu) => {
        const e = ease.inQuad(Math.max(0, uu));
        return [CX + Math.cos(a) * R0 * (1 - e), CY + Math.sin(a) * R0 * 0.36 * (1 - e)];
      };
      const [x, y] = at(u);
      const [bx, by] = at(u - 0.3);
      p.line(
        bx,
        by,
        x,
        y,
        (v) => (v > 0.6 ? C[1] : C[2]),
        (v) => (v > 0.3 ? 1 : 0.4 + v * 2),
      );
    });

  // 2. the core: a point that crackles and pulses faster as it fills, then swells and shakes
  if (t >= 0.05 && t < POP) {
    const phase = 1.5 * t + 9 * t * t;
    const pulse = 0.5 + 0.5 * Math.sin(phase * TAU);
    const sw = ease.inQuad(seg(t, SWELL, POP));
    const r = 0.5 + 1.4 * charge * charge + 0.5 * pulse * charge + 0.8 * sw;
    const jx = sw > 0.2 ? (f % 2 ? 1 : -1) : 0;
    const x = CX + jx;
    if (r > 1.2) {
      p.circle(x, CY, r + 1, C[1]);
      p.circle(x, CY, r, C[2]);
      p.circle(x - 0.3, CY - 0.3, r * 0.6, C[4]);
    } else
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.px(x + dx, CY + dy, C[1]);
    p.px(x, CY, WHITE);
    // short crackles spitting off its sides, a new set every frame
    if (charge > 0.25) {
      const fr = rng(seed, 77, f);
      const n = 1 + ((f + 1) % 2) + (charge > 0.8 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const side = fr.chance(0.5) ? 0 : Math.PI;
        const a = side + fr.range(-0.7, 0.7) + (fr.chance(0.3) ? 0.6 : 0);
        const L = 1.5 + 2 * charge + sw;
        const ca = Math.cos(a);
        const sa = Math.sin(a) * 0.6;
        crackle(
          p,
          fr,
          x + ca * (r + 1),
          CY + sa * (r + 1),
          x + ca * (r + 1 + L),
          CY + sa * (r + 1 + L),
          i % 2 ? C[1] : C[2],
        );
      }
    }
    p.glow(x, CY, 6 + 6 * charge, C[4], 0.15 + 0.2 * charge);
  }

  // 3. the pop: a white flash, a flat ring, then the zigzag jumps out and buzzes before it blinks away
  const q = t - POP;
  if (q < 0) return;
  if (q < 0.05) {
    // the flash: a white-hot ball with a lemon ring, rays shooting out sideways and on the diagonals
    for (const [dx, dy, L] of [
      [1, 0, 6],
      [-1, 0, 6],
      [1, 1, 3],
      [-1, 1, 3],
      [1, -1, 2],
      [-1, -1, 2],
    ])
      p.line(CX + dx * 4, CY + dy * 3, CX + dx * (4 + L), CY + dy * (3 + L * 0.5), (u) =>
        u < 0.5 ? C[2] : C[1],
      );
    p.circle(CX, CY, 4.5, C[1]);
    p.circle(CX, CY, 3.5, C[4]);
    p.circle(CX, CY, 2.5, WHITE);
    p.glow(CX, CY, 10, C[4], 0.35);
  } else if (q < 0.15) {
    const k = (q - 0.05) / 0.1;
    for (const a of [0, 0.55, -0.55, Math.PI, Math.PI - 0.55, Math.PI + 0.55]) {
      const ca = Math.cos(a);
      const sa = Math.sin(a) * 0.6;
      const r0 = 6 + 3 * k;
      p.line(
        CX + ca * r0,
        CY + sa * r0,
        CX + ca * (r0 + 2.5 - 2 * k),
        CY + sa * (r0 + 2.5 - 2 * k),
        k < 0.5 ? C[2] : C[1],
      );
    }
  }
  if (q >= 0.04 && q < 0.36) {
    const buzz = q < 0.25 ? (f % 2 ? 1 : 0) : 0;
    if (q < 0.28 || f % 2) bolt(p, C, CX + buzz - 0.5, CY + 0.5, 1, q < 0.09);
    p.glow(CX, CY, 8, C[4], 0.25 * (1 - q / 0.36));
  }
  // sparks thrown off both ways, falling as they cool
  burst(8, seed + 3, (r, i) => {
    const life = r.range(0.25, 0.38);
    const k = q / life;
    if (k >= 1) return;
    const dir = i % 2 ? 1 : -1;
    const vx = dir * r.range(30, 60);
    const vy = -r.range(5, 35);
    const [x, y] = fly(CX + dir * 2, CY, vx, vy, q, 220, 5);
    const [x0, y0] = fly(CX + dir * 2, CY, vx, vy, Math.max(0, q - 0.025), 220, 5);
    if (k > 0.75 && (f + i) % 2) return;
    p.line(x0, y0, x, y, k < 0.5 ? C[2] : C[3]);
    p.px(x, y, i % 3 ? C[1] : C[4]);
  });
}
