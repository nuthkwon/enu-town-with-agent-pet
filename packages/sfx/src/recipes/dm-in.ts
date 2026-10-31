import type { SfxRecipe } from '../types';

export default {
  category: 'notify',
  desc: 'A paper plane lands: a falling swish, a small A5 tap and a sung E6 with a little vibrato.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.01, d: 0.09, s: 0, r: 0 },
      gain: 0.25,
      filter: { type: 'bp', hz: 1200, to: 400, t: 0.1, q: 1 },
    },
    { at: 0.06, wave: 'triangle', hz: 880, env: { a: 0.002, d: 0.07, s: 0, r: 0 }, gain: 0.4 },
    {
      at: 0.12,
      wave: 'sine',
      hz: 1318.51,
      env: { a: 0.003, d: 0.3, s: 0, r: 0 },
      gain: 0.5,
      vibrato: { hz: 5, cents: 10 },
    },
  ],
  echo: { delay: 0.1, feedback: 0.2, mix: 0.15 },
  highpass: 200,
} satisfies SfxRecipe;
