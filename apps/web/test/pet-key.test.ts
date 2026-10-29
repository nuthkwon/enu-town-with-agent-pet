import { PET_SPECIES, PET_TINTS } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { companionSheetUrl, parsePetKey, petSheetKey, petSheetUrl } from '@/lib/pet-key';

describe('pet sheet keys', () => {
  it('round-trip every species, tint and kind', () => {
    for (const species of PET_SPECIES)
      for (const tint of PET_TINTS)
        for (const kind of ['pt', 'pc'] as const) {
          expect(parsePetKey(petSheetKey({ kind, species, tint }))).toEqual({ kind, species, tint });
        }
  });

  it('reject anything else', () => {
    for (const key of [
      '',
      'pt-cat',
      'px-cat-mint',
      'pt-dog-mint',
      'pt-cat-gold',
      'pt-cat-mint-x',
      'PT-cat-mint',
    ])
      expect(parsePetKey(key), key).toBeNull();
  });

  it('use the static files for the base look and the API for tints', () => {
    expect(petSheetUrl('owl')).toBe('/assets/sprites/pets/owl.png');
    expect(companionSheetUrl('owl')).toBe('/assets/sprites/companions/owl.png');
    expect(petSheetUrl('owl', 'mint')).toBe('/api/sprites/pet/pt-owl-mint');
    expect(companionSheetUrl('owl', 'sky')).toBe('/api/sprites/pet/pc-owl-sky');
  });
});
