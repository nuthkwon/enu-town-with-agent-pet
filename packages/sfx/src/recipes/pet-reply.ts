import type { SfxRecipe } from '../types';

export default {
  category: 'pet',
  desc: 'My familiar answers: "boop-bip", G5 then C6 with a little vibrato and a soft echo.',
  voices: [
    { at: 0, wave: 'triangle', hz: 783.99, env: { a: 0.003, d: 0.09, s: 0, r: 0 }, gain: 0.45 },
    {
      at: 0.1,
      wave: 'triangle',
      hz: 1046.5,
      env: { a: 0.003, d: 0.16, s: 0, r: 0 },
      gain: 0.45,
      vibrato: { hz: 6, cents: 18, delay: 0.05 },
    },
    { at: 0.1, wave: 'sine', hz: 2093, env: { a: 0.003, d: 0.16, s: 0, r: 0 }, gain: 0.12 },
  ],
  echo: { delay: 0.09, feedback: 0.22, mix: 0.18 },
} satisfies SfxRecipe;
