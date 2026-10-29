import type { Canvas } from './canvas';
import type { RGBA } from './color';

/**
 * ASCII pixel template: one string per row, one character per pixel. `.` and ` ` are transparent;
 * every other character is looked up in a colour map (a missing key is a programming error).
 */
export type Template = readonly string[];
export type ColorMap = Readonly<Record<string, RGBA | null | undefined>>;

export interface StampOptions {
  flipX?: boolean;
  /** Replace instead of alpha-blend. */
  replace?: boolean;
  /** Only paint where the destination already has pixels (clip to existing silhouette). */
  clip?: boolean;
}

export function templateWidth(t: Template): number {
  let w = 0;
  for (const row of t) w = Math.max(w, row.length);
  return w;
}

/** Draws `t` with its top-left corner at (x, y). A colour mapped to `null` is skipped. */
export function stamp(c: Canvas, t: Template, x: number, y: number, colors: ColorMap, opts: StampOptions = {}): void {
  const w = templateWidth(t);
  for (let ty = 0; ty < t.length; ty++) {
    const row = t[ty]!;
    for (let tx = 0; tx < row.length; tx++) {
      const ch = row[tx]!;
      if (ch === '.' || ch === ' ') continue;
      const col = colors[ch];
      if (col === null) continue;
      if (col === undefined) throw new Error(`template colour '${ch}' is not mapped`);
      const px = x + (opts.flipX ? w - 1 - tx : tx);
      const py = y + ty;
      if (opts.clip && c.alpha(px, py) === 0) continue;
      if (opts.replace) c.set(px, py, col);
      else c.plot(px, py, col);
    }
  }
}

/** Mirrors a template horizontally (row strings reversed, padded to a common width). */
export function mirrorTemplate(t: Template): Template {
  const w = templateWidth(t);
  return t.map((row) => row.padEnd(w, '.').split('').reverse().join(''));
}
