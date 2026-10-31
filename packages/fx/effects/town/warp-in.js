// Adapted from pixelfx scifi/warp-in (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The column (bands of the ramp across it, a guide thread before it lands, rings riding it) is adapted from
// Sprite Fusion's open-source holy light (https://www.spritefusion.com/pixel-art-vfx/holy-light), MIT License,
// Copyright (c) 2026 Hugo Duprez.
import { DEN, TAU, band, burst, clamp, ease, fit, fly, lerp, smooth } from '../_core.js';

// A colleague arrives: a thin beam slams down onto the spot, two rings run down it over the person, sparkles scan
// off their edges, and the beam pinches shut into a thread that snaps back up, leaving a few sparks. Bigger and
// longer than the 16 px, 0.4 s sparkle it replaces: a 32×64 px strip against the 32 px avatar (as wide, twice as
// tall), 0.7 s (14 frames at 20 fps). The beam stays thin and keeps the face readable: over the body it is only its
// core and a veil of light.
const TOP = -60,
  HEAD = -27,
  W = 2.6;
const SLAM = 0.08,
  RINGS = [0.14, 0.25],
  RUN = 0.2,
  PINCH = 0.42,
  SNAP = 0.5,
  END = 0.7;

export const meta = {
  name: 'Warp in',
  desc: 'A colleague arrives: a thin sky beam slams down on the spot, two lavender rings run down over them shedding sparkles, and the beam pinches shut into a thread that snaps up in a few sparks. 0.7 s, on the feet.',
  tags: ['town', 'arrive', 'warp', 'beam', 'teleport', 'one-shot'],
  size: [32, 64],
  origin: [16, 60],
  duration: END,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.sky, accent: DEN.lavender, seed: 3 },
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'scifi/warp-in' },
};

// the beam's half width: overshoots as it lands, then pinches to a thread
function widthAt(t) {
  if (t < SLAM) return 0;
  if (t < PINCH) return W * (1 + 0.6 * Math.exp(-(t - SLAM) * 30));
  return lerp(W, 0.5, ease.outCubic(clamp((t - PINCH) / (SNAP - PINCH))));
}

function beam(p, C, A, t) {
  const w0 = widthAt(t);
  if (w0 <= 0 || t >= SNAP + 0.1) return;
  // it falls from the sky as it lands and snaps back up into it at the end
  const bottom = t > SNAP ? lerp(0, TOP, ease.inCubic(clamp((t - SNAP) / 0.1))) : 0;
  const hero = t - SLAM < 0.05;
  for (let y = TOP; y < bottom; y++) {
    // brightest where it meets the person; toward the sky it narrows, pales and turns to a veil (no dither)
    const up = clamp((y - TOP) / 30),
      sky = clamp((y - TOP) / 26) ** 1.5,
      w = w0 * (0.55 + 0.45 * up);
    const body = y > HEAD + 2 && y < -1 && !hero;
    for (let x = Math.floor(-w * 1.3); x <= Math.ceil(w * 1.3) - 1; x++) {
      const q = Math.abs(x + 0.5) / w;
      if (q > 1.3) continue;
      let c;
      if (hero) c = q < 0.6 ? C[6] : q < 1 ? C[5] : C[3];
      else if (w0 < 1.2) c = q < 0.9 ? C[6] : 0;
      else if (body) {
        // over the person: the white core, and a thin veil of light either side
        if (q < 0.3) p.px(x, y, C[6]);
        else if (q < 1) p.blend(x + 0.5, y + 0.5, C[5], 0.32);
        continue;
      } else
        c = q < 0.3 ? (up > 0.5 ? C[6] : C[5]) : q < 0.65 ? (up > 0.5 ? C[5] : C[4]) : q < 1 ? C[4] : C[3];
      if (!c) continue;
      const a = q < 1 ? 1 : 0.55;
      if (sky < 1 || a < 1) p.blend(x + 0.5, y + 0.5, c, a * (0.08 + 0.92 * sky));
      else p.px(x, y, c);
    }
  }
}

// two rings run down the beam over the person, and sparkles flick off their ends as they pass
function rings(p, C, A, t) {
  for (const t0 of RINGS) {
    const k = (t - t0) / RUN;
    if (k < 0 || k >= 1) continue;
    const y = lerp(HEAD - 3, -1, ease.inOutSine(k)),
      rx = 8 + 1.5 * Math.sin(k * Math.PI),
      ry = 2;
    const n = Math.ceil(rx * 6);
    for (let j = 0; j < n; j++) {
      const g = (j / n) * TAU,
        near = Math.sin(g) > 0;
      p.dot(Math.cos(g) * rx, y + Math.sin(g) * ry, k < 0.2 ? C[6] : near ? A[5] : A[4], near ? 1 : 0.6);
    }
    p.glowLine(-rx, y, rx, y, 3, A[4], 0.2);
  }
}

function sparkles(p, C, A, t, S) {
  // the scan: sparkles thrown off the edges of the rings as they run down
  burst(14, S * 13 + 1, (r, i) => {
    const t0 = RINGS[i % 2],
      tb = t0 + r.range(0.05, 0.95) * RUN,
      life = r.range(0.14, 0.24),
      age = t - tb;
    if (age < 0 || age >= life) return;
    const kb = (tb - t0) / RUN,
      y0 = lerp(HEAD - 3, -1, ease.inOutSine(kb)),
      s = r.sign();
    const [x, y] = fly(
      s * (8 + 1.5 * Math.sin(kb * Math.PI)),
      y0,
      s * r.range(8, 18),
      -r.range(4, 16),
      age,
      0,
      4,
    );
    const k = 1 - age / life;
    p.px(x, y, k > 0.5 ? C[6] : A[4]);
    if (k > 0.6 && r.chance(0.5)) {
      p.px(x - 1, y, A[5]);
      p.px(x + 1, y, A[5]);
      p.px(x, y - 1, A[5]);
      p.px(x, y + 1, A[5]);
    }
  });
  // the slam kicks a few sparks along the floor; the snap leaves a few rising off the spot
  burst(8, S * 13 + 2, (r) => {
    const tb = SLAM + r.range(0, 0.03),
      life = r.range(0.14, 0.24),
      age = t - tb,
      s = r.sign();
    if (age < 0 || age >= life) return;
    const [x, y] = fly(s * r.range(1, 4), -1, s * r.range(30, 50), -r.range(20, 60), age, 300, 5);
    p.px(x, Math.min(-1, y), age / life < 0.5 ? C[6] : C[4]);
  });
  burst(8, S * 13 + 3, (r) => {
    const tb = SNAP + r.range(0, 0.05),
      life = Math.min(r.range(0.12, 0.2), END - 0.02 - tb),
      age = t - tb;
    if (age < 0 || age >= life) return;
    const [x, y] = fly(r.range(-2, 2), -r.range(1, 20), r.range(-30, 30), -r.range(10, 40), age, 0, 3);
    const k = 1 - age / life;
    p.px(x, y, k > 0.5 ? C[6] : A[4]);
    if (k > 0.7) p.glow(x, y, 3, A[4], 0.2);
  });
}

// the floor where the beam stands: a target closing in, the slam's ring, a pool of light, the snap's last ring
function floor(p, C, A, t) {
  if (t < SLAM) {
    const k = t / SLAM,
      rx = lerp(11, 5, ease.outCubic(k));
    for (let i = 0; i < 24; i++) {
      const g = (i / 24) * TAU + t * 8;
      if (Math.floor(i / 3) % 2) continue;
      p.dot(Math.cos(g) * rx, Math.sin(g) * rx * 0.3, A[4], 0.5 + 0.5 * k);
    }
    return;
  }
  const ks = (t - SLAM) / 0.22;
  if (ks < 1)
    band(
      p,
      0,
      0,
      lerp(4, 13, ease.outCubic(ks)),
      0.3,
      Math.max(1, 2 * (1 - ks)),
      1.1 - ks,
      [C[2], C[4], C[5], C[6]],
      () => true,
      ks < 0.3,
    );
  const on = 1 - smooth(PINCH, SNAP + 0.05, t);
  if (on > 0) p.glow(0, -1, 8, C[5], 0.3 * on);
  const kn = (t - SNAP) / 0.18;
  if (kn >= 0 && kn < 1)
    band(p, 0, 0, lerp(2, 9, ease.outCubic(kn)), 0.3, 1, 1 - kn, [A[3], A[4], A[5], C[6]], () => true);
}

export function draw(p, t, o) {
  if (t >= END) return;
  const C = fit(o.palette, 7),
    A = fit(o.accent, 7),
    S = o.seed;
  // the guide thread pricks down to the spot before the beam lands
  if (t < SLAM) {
    const head = lerp(TOP, 0, ease.outCubic(t / SLAM));
    for (let y = TOP; y < head; y += 2) p.px(0, y, C[4]);
    p.px(0, head, C[6]);
  }
  floor(p, C, A, t);
  beam(p, C, A, t);
  rings(p, C, A, t);
  sparkles(p, C, A, t, S);
  if (t >= SLAM && t < SLAM + 0.06) p.glow(0, -12, 12, C[5], 0.3);
}
