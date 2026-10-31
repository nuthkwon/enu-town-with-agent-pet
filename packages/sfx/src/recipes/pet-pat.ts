import type { SfxRecipe } from '../types';

export default {
  category: 'pet',
  desc: 'A happy "pyong" when I pat my familiar: up a sixth and settling, with a wiggle.',
  voices: [
    {
      at: 0,
      wave: 'pulse',
      hz: 520,
      glide: [
        { to: 1250, t: 0.07 },
        { to: 980, t: 0.06 },
      ],
      duty: 0.25,
      env: { a: 0.003, d: 0.13, s: 0, r: 0 },
      gain: 0.45,
      filter: { type: 'lp', hz: 3500 },
    },
    {
      at: 0,
      wave: 'sine',
      hz: 520,
      glide: [
        { to: 1250, t: 0.07 },
        { to: 980, t: 0.06 },
      ],
      env: { a: 0.003, d: 0.13, s: 0, r: 0 },
      gain: 0.35,
      vibrato: { hz: 9, cents: 25 },
    },
  ],
} satisfies SfxRecipe;
