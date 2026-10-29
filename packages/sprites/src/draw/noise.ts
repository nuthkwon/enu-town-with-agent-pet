/**
 * Deterministic integer hash noise in [0, 1). Same (x, y, seed) -> same value on every platform,
 * so textures are reproducible byte-for-byte.
 */
export function noise(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable noise: wraps coordinates on a `period` grid so textures repeat seamlessly. */
export function tileNoise(x: number, y: number, seed = 0, period = 32): number {
  return noise(((x % period) + period) % period, ((y % period) + period) % period, seed);
}
