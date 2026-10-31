import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'Fireworks cast: a fizzing rocket launch with a whistle climbing away.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.01, d: 0.4, s: 0, r: 0 },
      gain: 0.4,
      filter: { type: 'bp', hz: 3000, to: 5000, t: 0.4, q: 0.7 },
    },
    {
      at: 0,
      wave: 'sine',
      hz: 400,
      glide: { to: 1400, t: 0.4 },
      env: { a: 0.02, d: 0.4, s: 0, r: 0 },
      gain: 0.2,
    },
  ],
  highpass: 200,
} satisfies SfxRecipe;
