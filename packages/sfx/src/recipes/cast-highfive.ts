import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'High-five wind-up: a quick swish rising into the slap.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.02, d: 0.12, s: 0, r: 0 },
      gain: 0.5,
      filter: { type: 'bp', hz: 1000, to: 3000, t: 0.12, q: 1 },
    },
    {
      at: 0,
      wave: 'sine',
      hz: 700,
      glide: { to: 1000, t: 0.1 },
      env: { a: 0.01, d: 0.1, s: 0, r: 0 },
      gain: 0.2,
    },
  ],
  highpass: 200,
} satisfies SfxRecipe;
