// Adapted from pixelfx fire/meteor (https://github.com/patch-gg/pixelfx @ fe7103c), MIT License, Copyright (c) 2026 Patch.
// 커피 메테오, the fall: the meteor's choreography (a flight that speeds up, a comet shed behind, a white hit)
// on a chunky coffee mug in a comet of steam, ending in a comic burst. The impact point is the origin; the landing
// is spell/coffee-splash, played at the same spot when this one ends.
import { DEN, WHITE, clamp, ease, fit, noise, rng, smooth } from '../_core.js';

export const meta = {
  name: 'Coffee meteor',
  desc: 'A giant coffee mug twinkles in the sky, then streaks down from the upper left inside a comet of steam and coffee drops and slams the floor in a white flash.',
  tags: ['spell', 'coffee', 'meteor', 'fall', 'impact', 'one-shot'],
  size: [48, 96],
  origin: [24, 92],
  duration: 0.7,
  loop: false,
  fps: 20,
  bg: 'ground',
  options: { palette: DEN.coffee, steam: DEN.puff, seed: 4 },
  den: { surface: 'town', anchor: 'feet', depth: 'over', from: 'fire/meteor' },
};

const [W, H] = meta.size;
const [OX, OY] = meta.origin;
// the canvas in local pixels: nothing may be drawn outside it
const XL = -OX,
  XR = W - OX,
  YT = -OY,
  YB = H - OY;
const IN = (x, y) => {
  const X = Math.floor(x),
    Y = Math.floor(y);
  return X >= XL && X < XR && Y >= YT && Y < YB;
};

const HIT = 0.575,
  POP = 0.03;
const FROM = [-13, -80],
  TO = [0, -5.5];
const LEN = Math.hypot(TO[0] - FROM[0], TO[1] - FROM[1]);
const MX = (TO[0] - FROM[0]) / LEN,
  MY = (TO[1] - FROM[1]) / LEN;

// the flight: it hangs a moment where it appeared, then falls faster and faster
const prog = (t) => {
  const u = clamp((t - POP) / (HIT - POP));
  return 0.82 * u * u + 0.18 * u;
};
const pos = (t) => {
  const k = prog(t);
  return [FROM[0] + (TO[0] - FROM[0]) * k, FROM[1] + (TO[1] - FROM[1]) * k];
};
const speed = (t) => {
  const a = pos(Math.max(0, t - 0.01)),
    b = pos(t);
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01;
};

function bl(p, x, y, c, a) {
  if (a > 0.01 && IN(x, y)) p.blend(x, y, c, a);
}
function dot(p, x, y, c, a = 1) {
  if (IN(x, y)) p.dot(x, y, c, a);
}
// the mug in its own frame: u across, v down, (0, 0) the middle of its body. 1 body, 2 handle, 3 foam
function part(u, v) {
  const au = Math.abs(u);
  if (v >= -4 && v <= 4.5 && au <= 4.5) {
    if (v > 3.6 && au > 3.6 && (au - 3.6) ** 2 + (v - 3.6) ** 2 > 0.85) return 0;
    return 1;
  }
  if (v < -4 && v > -7.2 && (u / 4.8) ** 2 + ((v + 4) / 2.9) ** 2 <= 1) return 3;
  if (u > 4.5) {
    const d = Math.hypot(u - 4.7, v - 0.3);
    if (d <= 3 && d >= 1.35) return 2;
  }
  return 0;
}

/** The mug at (cx, cy): scale s, tilt th (radians), stretched st along the flight; white for the hit. */
function mug(p, C, cx, cy, s, th, st, white = false) {
  const c = Math.cos(th),
    sn = Math.sin(th),
    sq = Math.sqrt(st),
    R = 10 * s * st + 2;
  const toMug = (x, y) => {
    const dx = x - cx,
      dy = y - cy;
    const al = (dx * MX + dy * MY) / st,
      ac = (-dx * MY + dy * MX) * sq;
    const ex = al * MX - ac * MY,
      ey = al * MY + ac * MX;
    return [(ex * c + ey * sn) / s, (-ex * sn + ey * c) / s];
  };
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      if (!IN(x, y)) continue;
      const [u, v] = toMug(x + 0.5, y + 0.5),
        k = part(u, v);
      if (k) {
        let col;
        if (white) col = WHITE;
        else if (k === 3) col = u < 0.6 && v < -5 ? WHITE : u > 3 ? C[4] : C[5];
        else if (k === 2) col = v < -0.8 ? C[4] : u > 6.4 ? C[2] : C[3];
        else if (v < -2.9) col = C[2];
        else if (v > 3.3) col = C[2];
        else col = u < -3.5 ? C[3] : u < -2 ? C[4] : u < 2.4 ? C[3] : C[2];
        p.px(x, y, col);
        continue;
      }
      // a 1 px rim round the silhouette: ink on the shaded side, dark roast on the lit side, caramel round the foam
      let edge = 0;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const [uu, vv] = toMug(x + 0.5 + ox, y + 0.5 + oy),
          q = part(uu, vv);
        if (q && (!edge || q !== 3)) edge = q;
      }
      if (!edge) continue;
      if (white) p.px(x, y, C[3]);
      else if (edge === 3) p.px(x, y, C[3]);
      else p.px(x, y, (x + 0.5 - cx) * 0.6 + (y + 0.5 - cy) * 0.8 > -1 ? C[0] : C[1]);
    }
}

/**
 * A cartoon cloud from a list of puffs [x, y, r, g] (g 0 fresh .. 1 old): their union filled white, shaded
 * lilac on the lower right, with a 1 px lilac rim so it reads on the pale carpet; old puffs turn see-through.
 */
function cloud(p, S, puffs) {
  if (!puffs.length) return;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y, r] of puffs) {
    x0 = Math.min(x0, x - r - 1);
    x1 = Math.max(x1, x + r + 1);
    y0 = Math.min(y0, y - r - 1);
    y1 = Math.max(y1, y + r + 1);
  }
  x0 = Math.floor(x0) - 1;
  y0 = Math.floor(y0) - 1;
  x1 = Math.ceil(x1) + 1;
  y1 = Math.ceil(y1) + 1;
  // for every pixel once: the puff it sits deepest in (-1 for none) and how deep
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1,
    who = new Int16Array(w * h).fill(-1),
    depth = new Float32Array(w * h);
  puffs.forEach((q, i) => {
    for (let y = Math.floor(q[1] - q[2]); y <= Math.ceil(q[1] + q[2]); y++)
      for (let x = Math.floor(q[0] - q[2]); x <= Math.ceil(q[0] + q[2]); x++) {
        const d = 1 - Math.hypot(x + 0.5 - q[0], y + 0.5 - q[1]) / q[2],
          k = (y - y0) * w + (x - x0);
        if (d >= 0 && (who[k] < 0 || d > depth[k])) {
          who[k] = i;
          depth[k] = d;
        }
      }
  });
  const alpha = (g) => (g < 0.65 ? 1 : 1 - (g - 0.65) / 0.35);
  for (let y = y0 + 1; y < y1; y++)
    for (let x = x0 + 1; x < x1; x++) {
      if (!IN(x, y)) continue;
      const k = (y - y0) * w + (x - x0),
        cx = x + 0.5,
        cy = y + 0.5;
      if (who[k] >= 0) {
        const q = puffs[who[k]],
          d = depth[k],
          lit = q[0] - cx + (q[1] - cy),
          a = alpha(q[3]);
        const c = lit > q[2] * 0.25 ? WHITE : d < 0.3 && lit < -q[2] * 0.2 ? S[3] : S[4];
        if (a >= 1) p.px(x, y, c);
        else bl(p, x, y, c, a * 0.9);
        continue;
      }
      // a 1 px lilac rim round the cloud, darker on its shaded side
      let rim = null;
      for (const n of [k + 1, k - 1, k + w, k - w])
        if (who[n] >= 0 && (!rim || puffs[who[n]][3] < rim[3])) rim = puffs[who[n]];
      if (!rim) continue;
      const shade = cx - rim[0] + (cy - rim[1]) > 0;
      bl(p, x, y, shade ? S[2] : S[3], alpha(rim[3]) * (shade ? 0.95 : 0.8));
    }
}

/** The steam comet behind the mug: puffs shed along the flight, big at the mug, thinning back up the trail. */
function cometPuffs(t, seed) {
  const out = [],
    N = 12,
    step = 0.011;
  for (let j = N; j >= 0; j--) {
    const tb = t - j * step;
    if (tb < POP + 0.02 || tb > HIT) continue;
    const g = j / N;
    const [x, y] = pos(tb),
      s = 0.8 + 0.4 * prog(tb);
    // each puff keeps the sideways kick it was shed with, and swells a little as it ages
    const off = noise(tb * 37, seed) * 2.4 * (0.15 + g);
    const r = s * (5.6 - 4 * g) * (1 + 0.1 * noise(tb * 53, seed + 5)) + g * 0.8;
    // the steam rises off the top of the mug: the trail starts at its foam
    out.push([x - MY * off - MX * 4.5 * s, y + MX * off - MY * 4.5 * s, r, g]);
  }
  return out;
}

/** A comic impact star: n points between radii r0 and r1 (squashed by sy), filled with fill, a caramel rim. */
function burstStar(p, C, cx, cy, r0, r1, sy, n, rot, fill = WHITE, rim = C[3]) {
  const inside = (x, y) => {
    const dx = x - cx,
      dy = (y - cy) / sy,
      d = Math.hypot(dx, dy),
      an = Math.atan2(dy, dx) - rot;
    const f = Math.abs((((((an * n) / (2 * Math.PI)) % 1) + 1) % 1) - 0.5) * 2; // 1 on a point, 0 between
    return d <= r0 + (r1 - r0) * Math.pow(f, 2.2);
  };
  const R = r1 + 1;
  for (let y = Math.floor(cy - R * sy); y <= Math.ceil(cy + R * sy); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      if (!IN(x, y)) continue;
      const px = x + 0.5,
        py = y + 0.5;
      if (inside(px, py)) {
        p.px(x, y, fill);
        continue;
      }
      if (rim && (inside(px + 1, py) || inside(px - 1, py) || inside(px, py + 1) || inside(px, py - 1)))
        p.px(x, y, rim);
    }
}

export function draw(p, t, o) {
  const C = fit(o.palette, 7),
    S = fit(o.steam, 6),
    seed = o.seed;
  const after = 1 - smooth(HIT, HIT + 0.1, t);

  // the shadow it throws on the floor where it will land, growing as it comes
  const k = prog(t);
  if (t < HIT && t > POP) {
    const rx = 1.5 + 6 * k * k,
      ry = rx * 0.38;
    for (let y = Math.floor(-ry); y <= Math.ceil(ry); y++)
      for (let x = Math.floor(-rx); x <= Math.ceil(rx); x++) {
        const d = Math.hypot((x + 0.5) / rx, (y + 0.5) / ry);
        if (d <= 1) bl(p, x, y, S[0], (0.1 + 0.26 * k * k) * (1 - d * d * 0.6));
      }
  }

  // the comet of steam, longer the faster it goes, and puffs that break off it and drift away, thinning
  const puffs = t > POP && t < HIT ? cometPuffs(t, seed) : [];
  if (puffs.length) {
    for (let i = 0; i < 12; i++) {
      const r = rng(seed, i, 1),
        tb = 0.1 + i * 0.038 + r.range(-0.01, 0.01);
      const age = t - tb,
        life = r.range(0.14, 0.24);
      if (age < 0 || age > life || tb > HIT) continue;
      const [bx, by] = pos(tb),
        side = i % 2 ? 1 : -1,
        s = 0.8 + 0.4 * prog(tb);
      const off = (3.5 + r.range(0, 2)) * s + r.range(14, 26) * age;
      const x = bx - MY * side * off - MX * 5 * s,
        y = by + MX * side * off - MY * 5 * s - 8 * age;
      puffs.push([
        x,
        y,
        (1.4 + r.range(0.4, 1.2) * Math.min(1, (age / life) * 2)) * s,
        0.55 + 0.45 * (age / life),
      ]);
    }
    cloud(p, S, puffs);
  }
  const fogged = (x, y) => puffs.some((q) => Math.hypot(x - q[0], y - q[1]) < q[2] + 0.5);

  // coffee drops and flecks of foam flung off the top: they show where they clear the steam
  for (let i = 0; i < 12; i++) {
    const r = rng(seed, i, 2),
      tb = 0.13 + i * 0.036 + r.range(-0.008, 0.008);
    const age = t - tb,
      life = r.range(0.16, 0.28);
    if (age < 0 || age > life || tb > HIT) continue;
    const [bx, by] = pos(tb),
      sp = speed(tb),
      side = i % 2 ? 1 : -1;
    const vx = MX * sp * r.range(0.35, 0.6) - MY * side * r.range(70, 120) - MX * r.range(10, 30);
    const vy =
      MY * sp * r.range(0.35, 0.6) + MX * side * r.range(70, 120) - MY * r.range(10, 30) - r.range(30, 60);
    const x0 = bx + side * r.range(3, 5),
      y0 = by - 4;
    const dr = 6,
      f = (1 - Math.exp(-dr * age)) / dr;
    const x = x0 + vx * f,
      y = y0 + vy * f + 0.5 * 500 * age * age;
    const a = (1 - smooth(life * 0.6, life, age)) * after;
    if (fogged(x, y)) continue;
    if (i % 3 === 0) {
      // foam: a white fleck with a caramel underside
      dot(p, x, y, WHITE, a * 1.2);
      dot(p, x, y + 1, C[3], a);
    } else {
      // coffee: a round drop, lit on top
      dot(p, x, y, C[2], a * 1.2);
      dot(p, x + 1, y, C[2], a * 1.2);
      dot(p, x, y - 1, C[4], a);
    }
  }

  // the mug: it pops in, hangs, then drops; it stretches along its fall as it speeds up
  if (t > POP && t < HIT) {
    const [cx, cy] = pos(t),
      pop = ease.outBack(clamp((t - POP) / 0.09), 2.2);
    const s = (0.8 + 0.4 * k) * pop,
      st = 1 + 0.16 * smooth(0.3, 0.55, t);
    const th = -0.12 + 0.05 * Math.sin(t * 23);
    if (s > 0.2) mug(p, C, Math.round(cx), Math.round(cy), s, th, st);
    p.glow(cx, cy, 9 + 5 * k, C[5], 0.18 + 0.14 * k);
  }

  // the twinkle in the sky where it appears: a white four-point star with a lilac rim, over the mug as it pops in
  if (t < 0.09) {
    const g = t / 0.09,
      arm = Math.round(2 + 2 * Math.sin(Math.PI * Math.min(1, g * 1.4)));
    const x = FROM[0] - 6 * g,
      y = FROM[1] - 6 * g,
      star = new Set();
    star.add('0,0');
    for (let d = 1; d <= arm; d++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        star.add(`${dx * d},${dy * d}`);
    if (arm >= 3)
      for (const [dx, dy] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ])
        star.add(`${dx},${dy}`);
    for (let j = -arm - 1; j <= arm + 1; j++)
      for (let i = -arm - 1; i <= arm + 1; i++) {
        if (star.has(`${i},${j}`)) dot(p, x + i, y + j, Math.abs(i) + Math.abs(j) >= arm ? C[5] : WHITE);
        else if (
          star.has(`${i + 1},${j}`) ||
          star.has(`${i - 1},${j}`) ||
          star.has(`${i},${j + 1}`) ||
          star.has(`${i},${j - 1}`)
        )
          dot(p, x + i, y + j, S[2], 0.9);
      }
    p.glow(x, y, 7, C[5], 0.3 * (1 - g));
  }

  // the hit: the mug flashes white as it squashes into the floor, a flare of rays, then a ring and flecks
  const dt = t - HIT;
  if (dt >= 0 && dt < 0.05) {
    // the hero frame: a white comic burst, the mug squashed flat and white in it
    burstStar(p, C, 0, -7, 9, 19, 0.55, 8, 0.39, C[5]);
    burstStar(p, C, 0, -7, 6.5, 12, 0.55, 8, 0.39, WHITE, 0);
    p.glow(0, -7, 18, C[5], 0.3);
  } else if (dt >= 0.05 && dt < 0.12) {
    // a ring thrown out over the floor and white flecks, then nothing: the splash takes over
    const g = (dt - 0.05) / 0.07,
      rx = 14 + 5 * g,
      ry = rx * 0.38;
    for (let j = 0; j < 72; j++) {
      const an = (j / 72) * Math.PI * 2,
        near = Math.sin(an) > 0;
      dot(p, Math.cos(an) * rx, Math.sin(an) * ry - 0.5, near ? WHITE : C[3], near ? 1 : 0.8);
      if (near) dot(p, Math.cos(an) * rx, Math.sin(an) * ry + 0.5, C[3], 0.8);
    }
    for (let i = 0; i < 10; i++) {
      const r = rng(seed, i, 3),
        an = -Math.PI * r.range(0.08, 0.92),
        v = r.range(60, 150),
        a2 = dt;
      dot(p, Math.cos(an) * v * a2, -3 + Math.sin(an) * v * a2 * 0.8 + 300 * a2 * a2, i % 3 ? C[4] : WHITE);
    }
    p.glow(0, -3, 16, C[5], 0.18 * (1 - g));
  }
}
