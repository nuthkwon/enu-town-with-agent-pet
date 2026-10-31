import type { SfxRecipe } from '../types';

export default {
  category: 'ui',
  desc: 'A paper whoosh sweeping up with a small lifting sine, 0.15 s.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.015, d: 0.1, s: 0, r: 0 },
      gain: 0.5,
      filter: { type: 'bp', hz: 900, to: 3200, t: 0.12, q: 1 },
    },
    {
      at: 0.05,
      wave: 'sine',
      hz: 660,
      glide: { to: 990, t: 0.08 },
      env: { a: 0.005, d: 0.08, s: 0, r: 0 },
      gain: 0.35,
    },
  ],
  highpass: 200,
} satisfies SfxRecipe;
