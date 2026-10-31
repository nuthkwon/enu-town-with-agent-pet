import type { SfxRecipe } from '../types';

export default {
  category: 'ui',
  desc: 'A gentle low bonk falling a third, G4 to E4 with a soft triangle under it: not an alarm.',
  voices: [
    {
      at: 0,
      wave: 'sine',
      hz: 392,
      glide: { to: 329.63, t: 0.12 },
      env: { a: 0.003, d: 0.14, s: 0, r: 0 },
      gain: 0.7,
    },
    {
      at: 0,
      wave: 'triangle',
      hz: 196,
      glide: { to: 164.81, t: 0.12 },
      env: { a: 0.003, d: 0.14, s: 0, r: 0 },
      gain: 0.35,
    },
  ],
  highpass: 140,
  lowpass: 1800,
} satisfies SfxRecipe;
