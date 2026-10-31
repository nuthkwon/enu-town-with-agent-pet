import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'A warm cartoon pop, not a blast, that turns into two heart chimes (C6, E6).',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.002, d: 0.3, s: 0, r: 0 },
      gain: 0.6,
      filter: { type: 'lp', hz: 1200, to: 300, t: 0.3, q: 0.8 },
    },
    {
      at: 0,
      wave: 'sine',
      hz: 260,
      glide: { to: 160, t: 0.15 },
      env: { a: 0.002, d: 0.18, s: 0, r: 0 },
      gain: 0.3,
    },
    { at: 0.1, wave: 'triangle', hz: 1046.5, env: { a: 0.003, d: 0.2, s: 0, r: 0 }, gain: 0.3 },
    { at: 0.16, wave: 'triangle', hz: 1318.51, env: { a: 0.003, d: 0.25, s: 0, r: 0 }, gain: 0.3 },
  ],
  echo: { delay: 0.09, feedback: 0.2, mix: 0.15 },
  highpass: 120,
} satisfies SfxRecipe;
