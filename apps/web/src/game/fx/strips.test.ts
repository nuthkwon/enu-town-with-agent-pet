import { FX_CATALOG } from '@enu/fx/catalog';
import { PET_TINTS } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { TOWN_FX, fxEntry } from './strips';

describe('the strips the web plays are baked', () => {
  it('every town effect is in the catalog, for the town', () => {
    for (const id of TOWN_FX) {
      const e = fxEntry(id);
      expect(e, id).not.toBeNull();
      expect(e!.surface, id).toBe('town');
    }
  });

  it('the pet room and messenger effects are there too', () => {
    const ids = [
      'pet/pat-heart',
      'pet/munch',
      'pet/mini-fire',
      'pet/mini-ice',
      'pet/mini-star',
      'pet/mini-zap',
      'pet/summon-reply',
      'pet/zzz',
      'ui/quest-done',
      ...PET_TINTS.map((t) => `pet/hatch--${t}`),
    ];
    for (const id of ids) expect(Object.keys(FX_CATALOG), id).toContain(id);
  });
});
