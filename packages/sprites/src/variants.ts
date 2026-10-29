import type { PetTint } from '@enu/shared';
import { type RGBA, hex, mix, withAlpha } from './draw/color';

/**
 * Pet colour variants (ADR 0005: an extra pet reuses any species with a tint). Only the body keys `b`, `B` and
 * `l` take 55 % of the tint; eyes, ink, cream, blush and accents keep their colours so every species stays
 * recognisable (a species whose dominant colour has other keys names them in `PetArt.tintKeys`). `base` returns the
 * colours unchanged, so base sheets stay byte-identical.
 */
export const PET_TINT_COLOR: Record<Exclude<PetTint, 'base'>, RGBA> = {
  rose: hex('#ff9fc0'),
  mint: hex('#8fe3c1'),
  sky: hex('#9cc8ff'),
  lemon: hex('#ffe08a'),
  lilac: hex('#c4a8ff'),
};

export const PET_TINT_AMOUNT = 0.55;
export const DEFAULT_TINT_KEYS = ['b', 'B', 'l'] as const;

export function tintColors<T extends Readonly<Record<string, RGBA>>>(
  colors: T,
  tint: PetTint,
  keys: readonly string[] = DEFAULT_TINT_KEYS,
): T {
  if (tint === 'base') return colors;
  const target = PET_TINT_COLOR[tint];
  const out: Record<string, RGBA> = { ...colors };
  for (const key of keys) {
    const c = colors[key];
    if (c) out[key] = withAlpha(mix(c, target, PET_TINT_AMOUNT), c[3]);
  }
  return out as T;
}
