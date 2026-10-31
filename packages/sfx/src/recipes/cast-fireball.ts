import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'Cheer fireball cast: a whooshing flame swell with a rising buzz and a spark on release.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.03, d: 0.25, s: 0, r: 0 },
      gain: 0.6,
      filter: { type: 'bp', hz: 600, to: 2400, t: 0.25, q: 0.9 },
    },
    {
      at: 0,
      wave: 'saw',
      hz: 180,
      glide: { to: 420, t: 0.2 },
      env: { a: 0.02, d: 0.22, s: 0, r: 0 },
      gain: 0.25,
      filter: { type: 'lp', hz: 1200, to: 3000, t: 0.2, q: 0.8 },
    },
    { at: 0.18, wave: 'sine', hz: 783.99, env: { a: 0.003, d: 0.12, s: 0, r: 0 }, gain: 0.2 },
  ],
  highpass: 150,
} satisfies SfxRecipe;
