import { PET_SPECIES } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { asSpecies, isTaken, pickFreeSpecies } from './petChoice';

describe('pet species choice (every member has a different pet)', () => {
  it('keeps the current species when nobody else has it', () => {
    expect(pickFreeSpecies('fox', ['cat', 'bunny'])).toBe('fox');
  });

  it('never preselects a species a colleague already has', () => {
    expect(pickFreeSpecies('cat', ['cat', 'bunny'])).toBe('fox');
    expect(pickFreeSpecies('cat', PET_SPECIES.slice(0, 15))).toBe(PET_SPECIES[15]);
  });

  it('falls back to the first free species for unknown ids', () => {
    expect(pickFreeSpecies('dinosaur', [])).toBe('cat');
    expect(pickFreeSpecies('dinosaur', ['cat'])).toBe('bunny');
    expect(asSpecies('dinosaur')).toBe('cat');
  });

  it('reports taken species', () => {
    expect(isTaken('owl', ['owl'])).toBe(true);
    expect(isTaken('owl', [])).toBe(false);
  });
});
