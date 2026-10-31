import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'Praise lightning cast: a fizzing charge-up that climbs two octaves and rings a bright A6 at the top.',
  voices: [
    {
      at: 0,
      wave: 'square',
      hz: 220,
      glide: { to: 880, t: 0.2 },
      env: { a: 0.01, d: 0.22, s: 0, r: 0 },
      gain: 0.2,
      filter: { type: 'lp', hz: 2500 },
    },
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.005, d: 0.2, s: 0, r: 0 },
      gain: 0.25,
      filter: { type: 'bp', hz: 4000, q: 3 },
    },
    { at: 0.2, wave: 'sine', hz: 1760, env: { a: 0.003, d: 0.22, s: 0, r: 0 }, gain: 0.26 },
    { at: 0.2, wave: 'sine', hz: 3520, env: { a: 0.003, d: 0.08, s: 0, r: 0 }, gain: 0.06 },
  ],
  highpass: 150,
} satisfies SfxRecipe;
