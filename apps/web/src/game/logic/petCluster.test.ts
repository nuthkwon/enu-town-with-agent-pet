import { describe, expect, it } from 'vitest';
import { PET_CLUSTER_OFFSETS, petClusterOffset, petLook } from './petCluster';

describe('pet cluster', () => {
  it('keeps the default pet in place and gives every other slot its own spot', () => {
    expect(petClusterOffset(0)).toEqual({ dx: 0, dy: 0 });
    const spots = new Set(PET_CLUSTER_OFFSETS.map((o) => `${o.dx},${o.dy}`));
    expect(spots.size).toBe(5);
    // Pets are 24 px wide: neighbours never sit on top of each other.
    for (const a of PET_CLUSTER_OFFSETS)
      for (const b of PET_CLUSTER_OFFSETS)
        if (a !== b) expect(Math.max(Math.abs(a.dx - b.dx), Math.abs(a.dy - b.dy))).toBeGreaterThanOrEqual(7);
    expect(petClusterOffset(9)).toEqual({ dx: 0, dy: 0 });
  });

  it('names a look by species, plus the tint when it is not base', () => {
    expect(petLook('owl', 'base')).toBe('owl');
    expect(petLook('owl', '')).toBe('owl');
    expect(petLook('owl', 'mint')).toBe('owl-mint');
  });
});
