import type { SfxRecipe } from '../types';

export default {
  category: 'pet',
  desc: 'Three eggshell cracks, then a bright C major arpeggio and two glints as the familiar hatches.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.04, s: 0, r: 0 },
      gain: 0.6,
      filter: { type: 'bp', hz: 2500, q: 2 },
    },
    {
      at: 0.3,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.04, s: 0, r: 0 },
      gain: 0.6,
      filter: { type: 'bp', hz: 2600, q: 2 },
    },
    {
      at: 0.52,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.05, s: 0, r: 0 },
      gain: 0.7,
      filter: { type: 'bp', hz: 2400, q: 2 },
    },
    {
      at: 0.68,
      wave: 'triangle',
      hz: 523.25,
      env: { a: 0.003, d: 0.12, s: 0.2, hold: 0.05, r: 0.08 },
      gain: 0.3,
    },
    {
      at: 0.75,
      wave: 'triangle',
      hz: 659.26,
      env: { a: 0.003, d: 0.12, s: 0.2, hold: 0.05, r: 0.08 },
      gain: 0.3,
    },
    {
      at: 0.82,
      wave: 'pulse',
      hz: 783.99,
      env: { a: 0.003, d: 0.12, s: 0.2, hold: 0.05, r: 0.08 },
      gain: 0.25,
      filter: { type: 'lp', hz: 3500 },
    },
    {
      at: 0.89,
      wave: 'triangle',
      hz: 1046.5,
      env: { a: 0.003, d: 0.12, s: 0.2, hold: 0.05, r: 0.1 },
      gain: 0.3,
    },
    { at: 1, wave: 'sine', hz: 2637.02, env: { a: 0.003, d: 0.1, s: 0, r: 0 }, gain: 0.1 },
    { at: 1.08, wave: 'sine', hz: 2093, env: { a: 0.003, d: 0.14, s: 0, r: 0 }, gain: 0.1 },
  ],
  echo: { delay: 0.12, feedback: 0.25, mix: 0.2 },
} satisfies SfxRecipe;
