import type { SfxRecipe } from '../types';

export default {
  category: 'ui',
  desc: 'The open swish mirrored: falling swish and a G5 to C5 slide.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.02, d: 0.14, s: 0, r: 0 },
      gain: 0.4,
      filter: { type: 'bp', hz: 1800, to: 500, t: 0.16, q: 1 },
    },
    {
      at: 0.04,
      wave: 'sine',
      hz: 783.99,
      glide: { to: 523.25, t: 0.12 },
      env: { a: 0.005, d: 0.12, s: 0, r: 0 },
      gain: 0.25,
    },
  ],
  highpass: 200,
} satisfies SfxRecipe;
