import type { SfxRecipe } from '../types';

export default {
  category: 'ui',
  desc: 'A quick airy fwip as I wave: noise sweeping up with a light sine lift.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.01, d: 0.12, s: 0, r: 0 },
      gain: 0.35,
      filter: { type: 'bp', hz: 1500, to: 4200, t: 0.14, q: 1 },
    },
    {
      at: 0,
      wave: 'sine',
      hz: 1200,
      glide: { to: 1600, t: 0.08 },
      env: { a: 0.003, d: 0.09, s: 0, r: 0 },
      gain: 0.15,
    },
  ],
  highpass: 300,
} satisfies SfxRecipe;
