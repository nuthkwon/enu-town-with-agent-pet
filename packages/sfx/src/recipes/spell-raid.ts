import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: '단체 응원: a little fanfare, G4 C5 E5 G5 C6 up, then a held C major chord.',
  voices: [
    { at: 0, wave: 'triangle', hz: 392, env: { a: 0.003, d: 0.2, s: 0, r: 0 }, gain: 0.3 },
    { at: 0.08, wave: 'triangle', hz: 523.25, env: { a: 0.003, d: 0.2, s: 0, r: 0 }, gain: 0.3 },
    { at: 0.16, wave: 'triangle', hz: 659.26, env: { a: 0.003, d: 0.2, s: 0, r: 0 }, gain: 0.3 },
    { at: 0.24, wave: 'triangle', hz: 783.99, env: { a: 0.003, d: 0.2, s: 0, r: 0 }, gain: 0.3 },
    { at: 0.32, wave: 'triangle', hz: 1046.5, env: { a: 0.003, d: 0.2, s: 0, r: 0 }, gain: 0.3 },
    {
      at: 0.4,
      wave: 'pulse',
      hz: 523.25,
      duty: 0.25,
      env: { a: 0.02, d: 0.3, s: 0.4, hold: 0.2, r: 0.3 },
      gain: 0.12,
      filter: { type: 'lp', hz: 3000 },
    },
    {
      at: 0.4,
      wave: 'pulse',
      hz: 659.26,
      duty: 0.25,
      env: { a: 0.02, d: 0.3, s: 0.4, hold: 0.2, r: 0.3 },
      gain: 0.12,
      filter: { type: 'lp', hz: 3000 },
    },
    {
      at: 0.4,
      wave: 'pulse',
      hz: 783.99,
      duty: 0.25,
      env: { a: 0.02, d: 0.3, s: 0.4, hold: 0.2, r: 0.3 },
      gain: 0.12,
      filter: { type: 'lp', hz: 3000 },
    },
    {
      at: 0.4,
      wave: 'triangle',
      hz: 1046.5,
      env: { a: 0.02, d: 0.3, s: 0.4, hold: 0.2, r: 0.3 },
      gain: 0.12,
    },
  ],
  echo: { delay: 0.12, feedback: 0.25, mix: 0.2 },
} satisfies SfxRecipe;
