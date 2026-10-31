import type { SfxRecipe } from '../types';

export default {
  category: 'ui',
  desc: 'A soft rising swish with a C5 to G5 slide: the overview opens.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.02, d: 0.14, s: 0, r: 0 },
      gain: 0.4,
      filter: { type: 'bp', hz: 500, to: 1800, t: 0.16, q: 1 },
    },
    {
      at: 0.04,
      wave: 'sine',
      hz: 523.25,
      glide: { to: 783.99, t: 0.12 },
      env: { a: 0.005, d: 0.12, s: 0, r: 0 },
      gain: 0.25,
    },
  ],
  highpass: 200,
} satisfies SfxRecipe;
