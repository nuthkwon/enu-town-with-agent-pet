/** RGBA colour with 0..255 channels. */
export type RGBA = readonly [number, number, number, number];

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Parses `#rgb`, `#rrggbb` or `#rrggbbaa`; `alpha` overrides the alpha channel when given. */
export function hex(s: string, alpha?: number): RGBA {
  let h = s.startsWith('#') ? s.slice(1) : s;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (h.length !== 6 && h.length !== 8) throw new Error(`bad colour ${s}`);
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  const a = alpha ?? (h.length === 8 ? n(6) : 255);
  return [n(0), n(2), n(4), a];
}

/** Linear interpolation between two colours (t = 0 -> a, t = 1 -> b), alpha included. */
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    clamp(a[0] + (b[0] - a[0]) * t),
    clamp(a[1] + (b[1] - a[1]) * t),
    clamp(a[2] + (b[2] - a[2]) * t),
    clamp(a[3] + (b[3] - a[3]) * t),
  ];
}

export function withAlpha(c: RGBA, a: number): RGBA {
  return [c[0], c[1], c[2], clamp(a)];
}

const WHITE: RGBA = [255, 255, 255, 255];
const SHADE: RGBA = [58, 40, 80, 255];

/** Mixes towards white, keeping alpha. */
export function lighten(c: RGBA, t: number): RGBA {
  return withAlpha(mix(c, WHITE, t), c[3]);
}

/** Mixes towards a dark plum (never pure black), keeping alpha. */
export function darken(c: RGBA, t: number): RGBA {
  return withAlpha(mix(c, SHADE, t), c[3]);
}

export function sameColor(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
