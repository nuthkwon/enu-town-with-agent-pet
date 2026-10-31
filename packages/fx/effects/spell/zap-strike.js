// Adapted from pixelfx lightning/lightning-strike (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// The stepped leader, the stroke flicker, the cooling channel and the scorch follow Sprite Fusion's open-source
// lightning (https://www.spritefusion.com/pixel-art-vfx/lightning), MIT License, Copyright (c) 2026 Hugo Duprez.
//
// ENU Den's 칭찬 번개 (praise lightning): a friendly comic zap, not a real storm. No scorch, soot or darkened sky:
// a small sigil, a chunky zigzag bolt with a white hero frame, arcs on the floor, sparks, twinkles, then nothing.
import { DEN, Lights, P, Particles, Rng, TAU, WHITE, clamp, fit, rng } from '../_core.js';
import { zigzag } from '../_lib/lightning.js';

export const meta = {
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'lightning/lightning-strike' },
  name: 'Praise lightning strike',
  desc: '칭찬 번개: a small sigil glows at the feet, a chunky comic zigzag slams down onto it with a white hero frame, little arcs crawl out along the floor, sparks bounce and twinkle out. Volt ramp, 0.8 s, 48x96 on the feet.',
  tags: ['spell', 'lightning', 'zap', 'praise', 'strike', 'comic', 'one-shot'],
  size: [48, 96],
  origin: [24, 92],
  duration: 0.8,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.volt, seed: 5 },
};

// The choreography is in frames of the 20 fps strip: charge 0-3, the white hero frame on 4, a flicker, a
// re-strike on 7, the channel gone by 10, sparks and twinkles out by 15.
const FPS = 20;
const HIT = 4;
const TOP = -89; // the bolt fades in from the canvas top
const LEGS = 7;

// the bolt: a chunky zigzag (sharp elbows on alternate sides, narrower near the floor), a pixel of jitter per leg
function makeKeys(R) {
  const x0 = R.range(-4, 4);
  const keys = [[x0, TOP]];
  let side = R.sign();
  for (let i = 1; i < LEGS; i++) {
    const u = i / LEGS + R.range(-0.03, 0.03);
    keys.push([x0 * (1 - u) + side * R.range(4.5, 7) * (1 - 0.45 * u), TOP + (-1 - TOP) * u]);
    side = -side;
  }
  keys.push([0, -1]);
  return keys;
}

function jitter(R, keys, j = 0.45) {
  const pts = [keys[0]];
  for (let i = 1; i < keys.length; i++) {
    const [ax, ay] = keys[i - 1];
    const [bx, by] = keys[i];
    for (let s = 1; s <= 3; s++) {
      const u = s / 3;
      pts.push([ax + (bx - ax) * u + (s < 3 ? R.range(-j, j) : 0), ay + (by - ay) * u]);
    }
  }
  return pts;
}

// short forks off the upper elbows, pointing out and down
function makeForks(R, keys) {
  const out = [];
  for (let i = 1; i <= 3; i++) {
    if (!R.chance(0.6)) continue;
    const [x, y] = keys[i];
    const s = Math.sign(x - keys[i - 1][0]) || 1;
    const L = R.range(7, 11);
    const mid = [x + s * L * 0.45, y + L * 0.35];
    out.push([[x, y], mid, [mid[0] + s * R.range(-1, 2), mid[1] + L * 0.5]]);
  }
  return out;
}

const fadeTop = (y) => clamp((y - TOP) / 14);

/** The bolt in passes (rims, bodies, cores) so a fork's rim never covers the trunk's body. */
function inkBolt(p, trunk, forks, [rim, body, core], wRim, wBody, from = -Infinity, a = 1) {
  const legs = (pts, fn) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      if (by < from) continue;
      fn(ax, ay, bx, by, fadeTop(ay) * a);
    }
  };
  for (const f of forks) legs(f, (ax, ay, bx, by, q) => p.beam(ax, ay, bx, by, wRim * 0.62, rim, q));
  if (wRim > 1) legs(trunk, (ax, ay, bx, by, q) => p.beam(ax, ay, bx, by, wRim, rim, q));
  if (wBody > 0) legs(trunk, (ax, ay, bx, by, q) => p.beam(ax, ay, bx, by, wBody, body, q));
  for (const f of forks) legs(f, (ax, ay, bx, by, q) => p.line(ax, ay, bx, by, body, q));
  legs(trunk, (ax, ay, bx, by, q) => p.line(ax, ay, bx, by, core, q));
}

// 0 at the front of the ring (towards the viewer), 1 at the back: the ring draws itself in from the front
const fromFront = (g) => Math.abs(((((g - Math.PI / 2) % TAU) + TAU + Math.PI) % TAU) - Math.PI) / Math.PI;

// the sigil: a lock-on ring that draws itself in from the front and tightens onto the feet as it charges (sky,
// lemon, cream), four ticks turning, a pulsing heart; it flashes white with the hit, swells flat and dithers away.
// The far half is skipped where the legs stand, so it reads as behind them although the strip is drawn over the
// person. The canvas has 4 px of floor under the feet: the ring stays flat.
const RING_X = [16, 13.5, 11.5, 10, 10, 12, 13.5, 14.5, 15];
function sigil(p, F, C) {
  const after = F - HIT;
  if (after > 4) return;
  const reveal = clamp((F + 1) / 2.5);
  const hot = after === 0;
  const rx = RING_X[F];
  const ry = 2.6;
  const Y0 = -0.5;
  const a = after <= 1 ? 1 : 1 - (after - 1) / 4;
  const top = hot ? WHITE : ([C[3], C[4], C[5], C[5]][F] ?? C[4]);
  const under = hot ? C[4] : F < 2 ? C[2] : C[3];
  const back = F < 2 ? C[2] : C[3];
  const behind = (x, g) => Math.sin(g) < 0 && Math.abs(x) < 6;
  for (let i = 0; i < 80; i++) {
    const g = (i / 80) * TAU;
    if (fromFront(g) > reveal) continue;
    const x = Math.cos(g) * rx;
    const y = Y0 + Math.sin(g) * ry;
    if (behind(x, g)) continue;
    const near = Math.sin(g) >= 0;
    p.dot(x, y, hot ? WHITE : near ? top : back, a);
    if (near) p.dot(x, y + 1, under, a);
  }
  if (reveal >= 1)
    for (let j = 0; j < 4; j++) {
      const g = (j * TAU) / 4 + Math.PI / 4 + F * 0.22;
      const x0 = Math.cos(g) * (rx - 3);
      if (behind(x0, g)) continue;
      const q1 = (rx + 3) / rx;
      p.line(
        x0,
        Y0 + Math.sin(g) * ry * ((rx - 3) / rx),
        Math.cos(g) * rx * q1,
        Y0 + Math.sin(g) * ry * Math.min(q1, 1.15),
        Math.sin(g) > 0 ? top : back,
        a,
      );
    }
  if (after < 0) {
    p.px(0, 0, F % 2 ? WHITE : C[5]);
    p.px(-1, 0, C[4]);
    p.px(1, 0, C[4]);
    p.glow(0, -1, 8 + 2 * F, C[4], 0.14 + 0.05 * F);
  } else if (after < 2) p.glow(0, -2, 12, C[4], 0.24);
}

// the hit's four-point flash on the floor: a tall arm up, arms out, a stub down to the floor line
function impactStar(p, x, y, up, side, down, c, tip) {
  for (const [dx, dy, L] of [
    [0, -1, up],
    [-1, 0, side],
    [1, 0, side],
    [0, 1, down],
  ])
    for (let d = 1; d <= L; d++) p.px(x + dx * d, y + dy * d, d > L * 0.6 ? tip : c);
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    p.px(x + dx, y + dy, c);
  p.px(x, y, WHITE);
  p.glow(x, y, 10, tip, 0.3);
}

// a 1 px arc, blue cooling to sky, with a white head (no dark shadow: it would smudge a light floor)
function arc(p, pts, C, k, head = true) {
  const a = Math.min(1, k * 1.6);
  for (let i = 0; i < pts.length - 1; i++)
    p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], k > 0.6 ? C[2] : C[3], a);
  if (head && k > 0.25) {
    const [hx, hy] = pts[pts.length - 1];
    p.px(hx, hy, WHITE);
    p.glow(hx, hy, 4, C[4], 0.2 * k);
  }
}

const inside = (pts) => pts.map(([x, y]) => [clamp(x, -22, 22), clamp(y, -60, 2.5)]);

export function create(o) {
  const C = fit(o.palette, 7);
  const R = new Rng(o.seed);
  const ps = new Particles({ rng: R, ground: () => 0, sparks: [C[6], C[4], C[3], C[2]] });
  const lights = new Lights();
  const keys = makeKeys(R);
  const trunk = jitter(R, keys);
  const trunk2 = jitter(
    R,
    keys.map(([x, y], i) => (i === 0 || i === keys.length - 1 ? [x, y] : [x + R.range(-1.5, 1.5), y])),
  );
  const forks = makeForks(R, keys);
  let T = 0;
  let fired = 0;

  const burst = (k) => {
    lights.add(0, -4, 20, C[4], 0.3 * k, 0.3);
    lights.add(0, -2, 9, WHITE, 0.3 * k, 0.1);
    for (let j = 0; j < Math.round(14 * k); j++) {
      const a = -Math.PI / 2 + R.sign() * R.range(0.35, 1.25);
      const sp = R.range(60, 130) * k;
      ps.spawn(P.SPARK, R.range(-1.5, 1.5), -2, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.22, 0.4));
    }
  };

  return {
    update(dt) {
      T += dt;
      const F = Math.floor(T * FPS + 1e-3);
      if (F >= HIT && fired < 1) {
        fired = 1;
        burst(1);
        for (let j = 0; j < 5; j++) {
          const s = j % 2 ? 1 : -1;
          ps.spawn(
            P.STAR,
            s * R.range(8, 15),
            -R.range(2, 22),
            0,
            -4,
            R.range(0.18, 0.26),
            j % 2 ? C[4] : C[6],
            R.range(1.4, 2.2),
            0.1 + j * 0.05,
          );
        }
      }
      if (F >= HIT + 3 && fired < 2) {
        fired = 2;
        burst(0.55);
      }
      ps.update(dt);
      ps.list = ps.list.filter((q) => q.x > -21 && q.x < 21 && q.y > -86 && q.y < 3);
      lights.update(dt);
    },
    draw(p) {
      const F = Math.floor(T * FPS + 1e-3);
      const af = F - HIT;
      const lk = p.lightK;
      sigil(p, F, C);
      // static rising off the charging sigil
      if (F >= 1 && F < HIT) {
        const r = rng(o.seed, 61, F);
        for (let i = 0; i < F; i++) {
          const g = r.range(0, TAU);
          const x = Math.cos(g) * RING_X[F];
          const y = -0.5 + Math.sin(g) * 2.6;
          if (Math.sin(g) < 0 && Math.abs(x) < 6) continue;
          arc(
            p,
            inside(zigzag(r, x, y, x + r.range(-1.5, 1.5), y - r.range(4, 7), 0.45, 0).paths[0].pts),
            C,
            0.9,
          );
        }
      }
      // the leader feels down from the sky; a streamer climbs off the sigil to meet it
      if (F === HIT - 1) {
        const reach = TOP + (-1 - TOP) * 0.62;
        for (let i = 0; i < trunk.length - 1; i++) {
          const [ax, ay] = trunk[i];
          const [bx, by] = trunk[i + 1];
          if (by > reach) {
            p.px(ax, ay, WHITE);
            p.glow(ax, ay, 6, C[4], 0.3);
            break;
          }
          p.line(ax, ay, bx, by, C[2], fadeTop(ay));
        }
        const r = rng(o.seed, 77, F);
        arc(p, zigzag(r, 0, -1, r.range(-1.5, 1.5), -7, 0.35, 0).paths[0].pts, C, 0.9);
      }
      // the strokes: the white hero frame, full colour, a flicker, a re-strike, a thin channel, a last thread
      if (af === 0) {
        inkBolt(p, trunk, forks, [C[2], WHITE, WHITE], 5, 3.2);
        impactStar(p, 0, -2, 10, 8, 3, WHITE, C[4]);
        p.circle(0, -2, 3.2, WHITE);
      } else if (af === 1) {
        inkBolt(p, trunk, forks, [C[1], C[3], WHITE], 4.6, 2.4);
        p.circle(0, -2, 2.6, C[4]);
        p.circle(0, -2, 1.6, WHITE);
      } else if (af === 2) {
        inkBolt(p, trunk, [], [C[1], C[4], C[4]], 2.6, 0);
      } else if (af === 3) {
        inkBolt(p, trunk2, [], [C[1], C[3], WHITE], 4.6, 2.4);
        p.circle(0, -2, 2, WHITE);
      } else if (af === 4) {
        inkBolt(p, trunk2, [], [C[2], C[3], C[5]], 2.6, 0, TOP + 22);
      } else if (af === 5) {
        inkBolt(p, trunk2, [], [C[2], C[3], C[3]], 0, 0, -44, 0.7);
      }
      if (af >= 0 && af < 4)
        for (let i = 0; i < trunk.length; i += 8)
          if (trunk[i][1] > TOP + 16) p.glow(trunk[i][0], trunk[i][1], 7, C[3], af === 0 ? 0.2 : 0.12);
      // arcs crawl out along the floor from the sigil's rim, struck anew every frame
      if (af >= 1 && af <= 4) {
        const r = rng(o.seed, 91, F);
        const run = [0, 0.45, 0.8, 1, 1][af];
        const k = [0, 1, 1, 0.75, 0.4][af];
        for (let i = 0; i < 4; i++) {
          const s = i % 2 ? 1 : -1;
          const x0 = s * r.range(6, 9);
          const y0 = r.range(0.5, 2);
          const L = (3 + 8 * run) * r.range(0.7, 1);
          arc(p, inside(zigzag(r, x0, y0, x0 + s * L, y0 + r.range(-1.5, 1), 0.3, 0).paths[0].pts), C, k);
        }
      }
      p.lightK = lk * 0.6;
      ps.draw(p);
      p.lightK = lk;
      lights.draw(p);
    },
  };
}
