import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'A comic "boing" off the shield: a sine bending up and back with a wobble and a small ping.',
  voices: [
    {
      at: 0,
      wave: 'sine',
      hz: 300,
      glide: [
        { to: 600, t: 0.08 },
        { to: 350, t: 0.2 },
      ],
      env: { a: 0.005, d: 0.3, s: 0, r: 0 },
      gain: 0.6,
      vibrato: { hz: 18, cents: 80 },
    },
    { at: 0, wave: 'triangle', hz: 900, env: { a: 0.002, d: 0.1, s: 0, r: 0 }, gain: 0.15 },
  ],
  highpass: 150,
} satisfies SfxRecipe;
