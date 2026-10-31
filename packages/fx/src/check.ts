import { readFileSync } from 'node:fs';
import { denOf } from './effects';
import { type Frame, px } from './pixelfx';
import type { FxModule, LoadedFx } from './types';

/**
 * pixelfx's `tools/check.mjs`, ported and stricter for ENU Den: drawing outside the canvas, a one-shot that does not
 * end empty and a loop seam are errors (a strip cannot hide them), and the house budgets are enforced. Frame time is
 * only a note: the browser plays baked strips, so it costs bake time, not players.
 */

export const FPS_ALLOWED = [10, 12, 15, 20, 24] as const;
export const MAX_FRAMES = 36;
export const MAX_STRIP_WIDTH = 4096;
export const MAX_SIZE = { town: 96, ui: 128, pet: 128 } as const;
export const MAX_ONE_SHOT_S = 2.4;
export const MAX_LOOP_S = 4;

export interface CheckResult {
  id: string;
  errors: string[];
  notes: string[];
}

const M = 24; // margin around the canvas, to catch pixels drawn outside it

/** Frames a strip holds: a one-shot's last (empty) frame is dropped. */
export function stripFrames(meta: FxModule['meta']): number {
  return Math.max(1, Math.round(meta.duration * meta.fps));
}

const count = (buf: Uint32Array, test: (c: number, i: number) => boolean) => {
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (test(buf[i]!, i)) n++;
  return n;
};

export function checkSource(fx: LoadedFx, src = readFileSync(fx.file, 'utf8')): string[] {
  const errs: string[] = [];
  if (/Math\.random/.test(src)) errs.push('uses Math.random: take randomness from the seeded Rng (o.seed)');
  if (/\bDate\b|performance\.now/.test(src)) errs.push('reads a clock: an effect is a function of t alone');
  if (/\.text\s*\(/.test(src)) errs.push('draws text: words live in ko.ts and are drawn outside the effect');
  if (fx.mod.drawBack)
    errs.push('exports drawBack: a strip has one depth (set meta.den.depth to "under" instead)');
  const den = denOf(fx);
  if (den.from && !src.slice(0, 600).includes(`Adapted from pixelfx ${den.from}`))
    errs.push(`adapted from ${den.from} but the credit header is missing (see den-fx skill §4)`);
  return errs;
}

export function checkEffect(fx: LoadedFx): CheckResult {
  const errs: string[] = [];
  const notes: string[] = [];
  const { meta, mod } = fx;
  try {
    errs.push(...checkSource(fx));
    const den = denOf(fx);
    if (typeof meta.name !== 'string' || !meta.name) errs.push('meta.name missing');
    if (typeof meta.desc !== 'string' || meta.desc.length < 12) errs.push('meta.desc missing or too short');
    if (!Array.isArray(meta.tags) || !meta.tags.length) errs.push('meta.tags missing');
    const max = MAX_SIZE[den.surface];
    if (!Array.isArray(meta.size) || meta.size.some((v) => !Number.isInteger(v) || v < 8 || v > max))
      errs.push(`meta.size must be whole pixels 8..${max} for a ${den.surface} effect`);
    if (!Array.isArray(meta.origin) || meta.origin.length !== 2) errs.push('meta.origin must be [x, y]');
    if (!(FPS_ALLOWED as readonly number[]).includes(meta.fps))
      errs.push(`meta.fps must be one of ${FPS_ALLOWED.join(', ')}`);
    const maxDur = meta.loop ? MAX_LOOP_S : MAX_ONE_SHOT_S;
    if (!(meta.duration > 0 && meta.duration <= maxDur))
      errs.push(`meta.duration must be 0..${maxDur} s for a ${meta.loop ? 'loop' : 'one-shot'}`);
    const frames = stripFrames(meta);
    if (frames > MAX_FRAMES) errs.push(`${frames} frames: at most ${MAX_FRAMES} (shorten it or lower fps)`);
    if (frames * (meta.size?.[0] ?? 0) > MAX_STRIP_WIDTH)
      errs.push(`strip is ${frames * meta.size[0]} px wide: at most ${MAX_STRIP_WIDTH}`);
    const taken = Object.keys(meta.options ?? {}).filter((k) =>
      ['x', 'y', 'flip', 'angle', 'light'].includes(k),
    );
    if (taken.length) errs.push(`option ${taken.join(', ')} is reserved for placement and glow: rename it`);
    if (errs.length) return { id: fx.id, errors: errs, notes };

    const [W, H] = meta.size;
    const frame = px.createFrame(W + M * 2, H + M * 2, -M, -M);
    const fw = frame.w;
    const inside = (i: number) => {
      const x = (i % fw) - M;
      const y = Math.floor(i / fw) - M;
      return x >= 0 && y >= 0 && x < W && y < H;
    };
    const opts: Record<string, unknown> = { ...(meta.options ?? {}), seed: meta.options?.seed ?? 1 };
    const n = Math.max(2, Math.round(meta.duration * meta.fps));
    let maxPx = 0;
    let spill = 0;
    let spillLight = 0;
    const ms: number[] = [];
    const lit = (c: number) => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255) > 90;
    const look = (f: Frame) => {
      maxPx = Math.max(
        maxPx,
        count(f.color, (c, j) => c >>> 24 > 0 && inside(j)),
        count(f.light, (c, j) => (c & 0xffffff) > 0 && inside(j)),
      );
      spill = Math.max(
        spill,
        count(f.color, (c, j) => c >>> 24 > 0 && !inside(j)),
      );
      spillLight = Math.max(
        spillLight,
        count(f.light, (c, j) => lit(c) && !inside(j)),
      );
    };

    if (!mod.create) {
      const drawAt = (t: number, o: Record<string, unknown>) => {
        const p = px.painterFor(px.clearFrame(frame));
        p.place(meta.origin[0], meta.origin[1]);
        (mod.draw as (p: unknown, t: number, o: unknown) => void)(p, t, o);
      };
      const tOf = (i: number) => (meta.loop ? ((i % n) / n) * meta.duration : (i / n) * meta.duration);
      for (let i = 0; i <= n; i++) {
        const t0 = performance.now();
        drawAt(tOf(i), opts);
        ms.push(performance.now() - t0);
        look(frame);
      }
      for (const seed of [2, 3, 7])
        for (let i = 0; i <= n; i += 2) {
          drawAt(tOf(i), { ...opts, seed });
          look(frame);
        }
      if (!meta.loop) {
        drawAt(meta.duration, opts);
        const left = count(frame.color, (c, j) => c >>> 24 > 0 && inside(j));
        if (left > 0) errs.push(`${left} px still drawn at t = duration: a one-shot must end empty`);
      } else {
        const shots: Uint32Array[] = [];
        for (let i = 0; i < n; i++) {
          drawAt((i / n) * meta.duration, opts);
          shots.push(frame.color.slice());
        }
        const step = (a: Uint32Array, b: Uint32Array) => count(a, (c, j) => c !== b[j]);
        const diffs = shots
          .slice(0, -1)
          .map((a, i) => step(a, shots[i + 1]!))
          .sort((x, y) => x - y);
        const typical = diffs[Math.floor(diffs.length * 0.9)] ?? 0;
        const seam = step(shots[n - 1]!, shots[0]!);
        if (seam > Math.max(typical * 2, 12))
          errs.push(
            `loop seam: ${seam} px change from the last frame to the first (a normal step is ${typical})`,
          );
      }
      // any palette works: a short one (resampled as createFx does) leaves no holes
      let holes = 0;
      const proto = px.Painter.prototype;
      const put = proto.put;
      proto.put = function (this: unknown, sx: number, sy: number, c: unknown, a?: number) {
        if (typeof c !== 'number' || c !== c) holes++;
        return put.call(this, sx, sy, c, a);
      };
      try {
        const short = px.resolveOptions(meta, { palette: ['#3b2a52', '#7457d6', '#cbb8ff', '#ffffff'] });
        for (let i = 0; i <= 8; i++) drawAt((i / 8) * meta.duration * (meta.loop ? 0.999 : 1), short);
      } finally {
        proto.put = put;
      }
      if (holes)
        errs.push(`${holes} pixels with an undefined colour from a 4-step palette: use fit(o.palette, n)`);
      const tt = meta.duration * 0.37;
      drawAt(tt, opts);
      const once = frame.color.slice();
      drawAt(tt, opts);
      if (count(once, (c, j) => c !== frame.color[j]) > 0)
        errs.push('not deterministic: the same t drew different frames');
    } else {
      const run = (seed: unknown) => {
        const inst = px.createFx(mod, { x: meta.origin[0], y: meta.origin[1], ...opts, seed });
        const shots: Uint32Array[] = [];
        for (let i = 0; i <= n; i++) {
          if (i) inst.update(1 / meta.fps);
          px.clearFrame(frame);
          const t0 = performance.now();
          inst.draw(frame);
          ms.push(performance.now() - t0);
          shots.push(frame.color.slice());
          look(frame);
        }
        return shots;
      };
      const a = run(opts.seed);
      const b = run(opts.seed);
      for (const seed of [2, 3, 7]) run(seed);
      if (a.some((s, i) => count(s, (c, j) => c !== b[i]![j]) > 0))
        errs.push('not deterministic: two runs with the same seed differ');
      if (!meta.loop) {
        const left = count(a[a.length - 1]!, (c, j) => c >>> 24 > 0 && inside(j));
        if (left > 0) errs.push(`${left} px still drawn at t = duration: a one-shot must end empty`);
      }
    }
    if (maxPx === 0) errs.push('draws nothing');
    if (spill > 0) errs.push(`${spill} px drawn outside the ${W}x${H} canvas: grow size or move the origin`);
    if (spillLight > 60) notes.push(`glow spills ${spillLight} px past the canvas (edge-faded in the strip)`);
    ms.sort((x, y) => x - y);
    const med = ms[ms.length >> 1] ?? 0;
    if (med > 4) notes.push(`slow to render: ${med.toFixed(1)} ms a frame (bake time only)`);
  } catch (e) {
    errs.push(String((e as Error).message ?? e).split('\n')[0]!);
  }
  return { id: fx.id, errors: errs, notes };
}
