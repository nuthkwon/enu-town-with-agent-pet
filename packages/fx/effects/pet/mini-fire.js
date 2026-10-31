import { DEN, TAU, WHITE, burst, clamp, ease, fit, fly, seg } from '../_core.js';

export const meta = {
  name: 'Mini fire',
  desc: 'The familiar shows a tiny fire spell: a spark winks above its head, puffs up into a little comic fireball that wobbles, squashes and pops into heart-shaped embers that float down and wink out. Ember ramp, 1 s.',
  tags: ['pet', 'familiar', 'spell', 'fire', 'fireball', 'heart', 'one-shot'],
  size: [32, 32],
  origin: [16, 28],
  duration: 1,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.ember, smoke: DEN.puff, seed: 3 },
  den: { surface: 'pet', stand: 'companion', anchor: 'feet', depth: 'over' },
};

// where the ball sits: just above the companion's ears (its head tops out at y = -20)
const BX = 0;
const BY = -22.5;
const WINK = 0.1; // the first spark
const PUFF = 0.26; // the ball has puffed up
const SQUASH = 0.47; // it winds up
const POP = 0.525; // it bursts (between frames, so the white frame lands on 0.55)

// a 5x4 heart and a 3x3 one: 'a' highlight, 'b' body, 'c' shade
const HEART5 = ['ba.bc', 'babbc', '.bbc.', '..c..'];
const HEART3 = ['b.c', 'bbc', '.c.'];

/** Draw the union shape `inside` with a 1 px rim (the silhouette) and `fill` inside. */
function blob(p, x0, y0, x1, y1, inside, fill, rim) {
  p.shade(x0, y0, x1, y1, (x, y) => {
    if (!inside(x, y)) return 0;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) return rim(x, y);
    return fill(x, y);
  });
}

// which side of the line a-b the point is on
const side = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

function fireball(p, C, x, y, rx, ry, sway, tip, hot) {
  // a teardrop: a round body and a pointed lick of flame on top, its tip swaying
  const ax = x - rx * 0.9;
  const bx = x + rx * 0.9;
  const by = y - ry * 0.35;
  const tx = x + sway;
  const ty = y - ry - tip;
  const inside = (px, py) => {
    const dx = (px - x) / rx;
    const dy = (py - y) / ry;
    if (dx * dx + dy * dy <= 1) return true;
    if (hot || py > by) return false;
    const s1 = side(ax, by, tx, ty, px, py);
    const s2 = side(tx, ty, bx, by, px, py);
    return s1 >= 0 && s2 >= 0;
  };
  const fill = (px, py) => {
    if (hot) return WHITE;
    // light from the upper left: a white heart, then yellow, amber, orange, red low on the right
    const d = Math.hypot((px - (x - rx * 0.25)) / rx, (py - (y - ry * 0.1)) / ry);
    return d < 0.34 ? WHITE : d < 0.62 ? C[5] : d < 0.92 ? C[4] : d < 1.2 ? C[3] : C[2];
  };
  const rim = (px, py) => (hot ? C[5] : py > y + ry * 0.3 && px > x - rx * 0.3 ? C[1] : C[2]);
  blob(p, x - rx - 1, ty - 1, x + rx + 1, y + ry + 1, inside, fill, rim);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7);
  const S = fit(o.smoke, 6);
  const seed = o.seed;

  // 1. a spark winks where the ball will be
  if (t < WINK + 0.05) {
    const k = seg(t, 0, WINK);
    p.px(BX, BY, k < 0.5 ? C[3] : WHITE);
    if (k >= 0.5)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.px(BX + dx, BY + dy, C[3]);
    p.glow(BX, BY, 5, C[4], 0.3);
  }

  // 2. it puffs up into a ball (overshoot), wobbles with its tip licking side to side, squashes, goes white
  if (t >= WINK && t < POP + 0.05) {
    const grow = ease.outBack(seg(t, WINK, PUFF), 2.2);
    const wob = Math.sin((t - PUFF) * TAU * 6) * seg(t, PUFF - 0.04, PUFF + 0.04) * 0.8;
    const sq = ease.inQuad(seg(t, SQUASH, POP));
    const hot = t >= POP;
    const r = hot ? 3.9 : 3.1 * grow;
    const rx = r * (1 + wob * 0.15 + sq * 0.25);
    const ry = r * (1 - wob * 0.15 - sq * 0.22);
    const sway = Math.round(Math.sin((t - WINK) * TAU * 4.5) * 1.3);
    const tip = Math.min(2, 2 * grow) * (1 - sq);
    if (r >= 0.6) fireball(p, C, BX, BY + sq, Math.max(0.8, rx), Math.max(0.8, ry), sway, tip, hot);
    if (!hot) p.glow(BX, BY, 9, C[4], 0.22 + 0.13 * sq); // the pop brings its own light
  }

  // 3. the pop: a white flash, a ring of heat, a puff of smoke rising
  const q = t - POP;
  if (q >= 0) {
    // the flash frame gets a flat ring; the next one comic pop lines flying out sideways
    if (q < 0.05) p.ellipse(BX, BY, 6, 3.4, C[5], (d) => (d > 0.72 ? 1 : 0));
    else if (q < 0.15) {
      const k = (q - 0.05) / 0.1;
      for (const a of [0, 0.6, -0.6, Math.PI, Math.PI - 0.6, Math.PI + 0.6]) {
        const ca = Math.cos(a);
        const sa = Math.sin(a) * 0.65;
        const r0 = 5 + 3 * k;
        p.line(
          BX + ca * r0,
          BY + sa * r0,
          BX + ca * (r0 + 2.5 - 2 * k),
          BY + sa * (r0 + 2.5 - 2 * k),
          k < 0.5 ? C[3] : C[2],
        );
      }
    }
    for (let i = 0; i < 2; i++) {
      const life = 0.32 + i * 0.06;
      const k = clamp(q / life);
      if (k >= 1) continue;
      const sx = BX + (i ? 2 : -2) * (0.5 + k);
      const sy = BY - 0.5 - 1.5 * ease.outQuad(k);
      p.disc(sx, sy, 1.5 + 1 * k, S[3], 0.55 * (1 - k));
    }
    p.glow(BX, BY, 10, C[4], 0.35 * Math.max(0, 1 - q / 0.15));
  }

  // 4. heart embers: thrown out of the ball both ways, slowing fast, then floating down as they cool and wink out
  if (q >= 0)
    burst(4, seed, (r, i) => {
      const dir = i % 2 ? 1 : -1;
      const outer = i < 2;
      const vx = dir * (outer ? r.range(54, 60) : r.range(24, 30));
      const vy = outer ? -r.range(16, 22) : -r.range(38, 42);
      const life = outer ? r.range(0.4, 0.43) : r.range(0.34, 0.38);
      const k = q / life;
      if (q < 0.04 || k >= 1) return; // they come out of the flash, not on it
      const [x, y] = fly(BX + dir * (outer ? 3 : 1), BY, vx, vy, q, 300, 4.5);
      const pal = { a: C[5], b: k < 0.6 ? C[4] : C[3], c: k < 0.6 ? C[3] : C[2] };
      if (k > 0.8 && Math.round(t * 20) % 2) return; // winks before it goes
      if (k > 0.28 && k < 0.65) p.sprite(HEART5, pal, Math.round(x) - 2, Math.round(y) - 2);
      else if (k < 0.88) p.sprite(HEART3, pal, Math.round(x) - 1, Math.round(y) - 1);
      else p.px(x, y, C[2]);
      p.glow(x, y, 4, C[4], 0.25 * (1 - k));
    });
}
