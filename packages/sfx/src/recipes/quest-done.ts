import type { SfxRecipe } from '../types';

export default {
  category: 'pet',
  desc: 'My own quest done (only I hear it): C6 E6 G6, a soft stamp and a sung C7.',
  voices: [
    { at: 0, wave: 'triangle', hz: 1046.5, env: { a: 0.003, d: 0.12, s: 0, r: 0 }, gain: 0.35 },
    { at: 0.08, wave: 'triangle', hz: 1318.51, env: { a: 0.003, d: 0.12, s: 0, r: 0 }, gain: 0.35 },
    { at: 0.16, wave: 'triangle', hz: 1567.98, env: { a: 0.003, d: 0.12, s: 0, r: 0 }, gain: 0.35 },
    {
      at: 0.2,
      wave: 'noise',
      hz: 0,
      env: { a: 0.002, d: 0.06, s: 0, r: 0 },
      gain: 0.3,
      filter: { type: 'lp', hz: 600 },
    },
    {
      at: 0.26,
      wave: 'sine',
      hz: 2093,
      env: { a: 0.003, d: 0.35, s: 0, r: 0 },
      gain: 0.35,
      vibrato: { hz: 6, cents: 15 },
    },
  ],
  echo: { delay: 0.1, feedback: 0.2, mix: 0.15 },
  highpass: 150,
} satisfies SfxRecipe;
