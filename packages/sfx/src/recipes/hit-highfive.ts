import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: '"짝!": a crisp hand slap with a little body and a tiny ring.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.06, s: 0, r: 0 },
      gain: 0.9,
      filter: { type: 'bp', hz: 2500, q: 1.2 },
    },
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.08, s: 0, r: 0 },
      gain: 0.4,
      filter: { type: 'lp', hz: 800 },
    },
    { at: 0, wave: 'sine', hz: 1600, env: { a: 0.002, d: 0.12, s: 0, r: 0 }, gain: 0.15 },
  ],
  highpass: 150,
} satisfies SfxRecipe;
