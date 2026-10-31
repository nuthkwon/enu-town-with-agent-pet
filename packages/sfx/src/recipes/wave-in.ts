import type { SfxRecipe } from '../types';

export default {
  category: 'notify',
  desc: 'Someone waves at me: a sparkling G major arpeggio, G5 B5 D6, with a high glint.',
  voices: [
    { at: 0, wave: 'sine', hz: 783.99, env: { a: 0.003, d: 0.18, s: 0, r: 0 }, gain: 0.5 },
    { at: 0.07, wave: 'sine', hz: 987.77, env: { a: 0.003, d: 0.18, s: 0, r: 0 }, gain: 0.5 },
    {
      at: 0.14,
      wave: 'sine',
      hz: 1174.66,
      env: { a: 0.003, d: 0.22, s: 0, r: 0 },
      gain: 0.5,
      vibrato: { hz: 7, cents: 20 },
    },
    { at: 0.14, wave: 'sine', hz: 2349.32, env: { a: 0.003, d: 0.2, s: 0, r: 0 }, gain: 0.08 },
  ],
  echo: { delay: 0.08, feedback: 0.25, mix: 0.2 },
} satisfies SfxRecipe;
