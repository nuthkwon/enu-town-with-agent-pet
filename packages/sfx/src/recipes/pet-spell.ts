import type { SfxRecipe } from '../types';

export default {
  category: 'pet',
  desc: 'My familiar shows a spell: a quick sparkly E minor arpeggio with a shimmer.',
  voices: [
    { at: 0, wave: 'triangle', hz: 1318.51, env: { a: 0.003, d: 0.1, s: 0, r: 0 }, gain: 0.3 },
    { at: 0.04, wave: 'triangle', hz: 1567.98, env: { a: 0.003, d: 0.1, s: 0, r: 0 }, gain: 0.3 },
    { at: 0.08, wave: 'triangle', hz: 1975.53, env: { a: 0.003, d: 0.1, s: 0, r: 0 }, gain: 0.3 },
    { at: 0.12, wave: 'triangle', hz: 2637.02, env: { a: 0.003, d: 0.16, s: 0, r: 0 }, gain: 0.3 },
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.03, d: 0.25, s: 0, r: 0 },
      gain: 0.05,
      filter: { type: 'bp', hz: 6000, q: 3 },
    },
  ],
  echo: { delay: 0.07, feedback: 0.25, mix: 0.2 },
} satisfies SfxRecipe;
