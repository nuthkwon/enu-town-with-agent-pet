import type { SfxRecipe } from '../types';

export default {
  category: 'ui',
  desc: 'A dry wooden tick: a fast sine drop with a little noise snap, 60 ms.',
  voices: [
    {
      at: 0,
      wave: 'sine',
      hz: 1800,
      glide: { to: 1100, t: 0.02 },
      env: { a: 0.001, d: 0.035, s: 0, r: 0 },
      gain: 0.8,
    },
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.012, s: 0, r: 0 },
      gain: 0.25,
      filter: { type: 'bp', hz: 3500, q: 1.2 },
    },
  ],
  highpass: 300,
} satisfies SfxRecipe;
