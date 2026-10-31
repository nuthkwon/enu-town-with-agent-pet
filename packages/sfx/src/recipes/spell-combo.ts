import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'Combo: a bright C major chord stab with a sparkle sweeping up an octave.',
  voices: [
    {
      at: 0,
      wave: 'pulse',
      hz: 523.25,
      duty: 0.25,
      env: { a: 0.005, d: 0.25, s: 0.3, hold: 0.1, r: 0.2 },
      gain: 0.15,
      filter: { type: 'lp', hz: 3000 },
    },
    {
      at: 0,
      wave: 'pulse',
      hz: 659.26,
      duty: 0.25,
      env: { a: 0.005, d: 0.25, s: 0.3, hold: 0.1, r: 0.2 },
      gain: 0.15,
      filter: { type: 'lp', hz: 3000 },
    },
    {
      at: 0,
      wave: 'pulse',
      hz: 783.99,
      duty: 0.25,
      env: { a: 0.005, d: 0.25, s: 0.3, hold: 0.1, r: 0.2 },
      gain: 0.15,
      filter: { type: 'lp', hz: 3000 },
    },
    {
      at: 0.05,
      wave: 'sine',
      hz: 1046.5,
      glide: { to: 2093, t: 0.3 },
      env: { a: 0.005, d: 0.3, s: 0, r: 0 },
      gain: 0.2,
    },
  ],
  echo: { delay: 0.1, feedback: 0.25, mix: 0.2 },
} satisfies SfxRecipe;
