import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'Coffee meteor cast: a cheeky upward bloop and a little whistle bending down.',
  voices: [
    {
      at: 0,
      wave: 'sine',
      hz: 500,
      glide: { to: 1200, t: 0.15 },
      env: { a: 0.005, d: 0.18, s: 0, r: 0 },
      gain: 0.5,
    },
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.002, d: 0.03, s: 0, r: 0 },
      gain: 0.2,
      filter: { type: 'bp', hz: 2000, q: 1.5 },
    },
    {
      at: 0.12,
      wave: 'triangle',
      hz: 1200,
      glide: { to: 900, t: 0.15 },
      env: { a: 0.005, d: 0.16, s: 0, r: 0 },
      gain: 0.25,
    },
  ],
  highpass: 150,
} satisfies SfxRecipe;
