import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'Healing potion cast: a cork pop, then a wobbly glassy slosh.',
  voices: [
    {
      at: 0,
      wave: 'sine',
      hz: 900,
      glide: { to: 300, t: 0.03 },
      env: { a: 0.001, d: 0.05, s: 0, r: 0 },
      gain: 0.7,
    },
    {
      at: 0.05,
      wave: 'noise',
      hz: 0,
      env: { a: 0.02, d: 0.15, s: 0, r: 0 },
      gain: 0.25,
      filter: { type: 'bp', hz: 800, q: 2 },
    },
    {
      at: 0.05,
      wave: 'triangle',
      hz: 600,
      glide: { to: 700, t: 0.2 },
      env: { a: 0.01, d: 0.2, s: 0, r: 0 },
      gain: 0.25,
      vibrato: { hz: 8, cents: 60 },
    },
  ],
  highpass: 150,
} satisfies SfxRecipe;
