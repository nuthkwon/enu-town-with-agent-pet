import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'A tingly crackle: four noise snaps, a falling buzz and an E6 tingle with fast vibrato.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.03, s: 0, r: 0 },
      gain: 0.4,
      filter: { type: 'bp', hz: 3500, q: 1.5 },
    },
    {
      at: 0.04,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.03, s: 0, r: 0 },
      gain: 0.35,
      filter: { type: 'bp', hz: 3500, q: 1.5 },
    },
    {
      at: 0.09,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.03, s: 0, r: 0 },
      gain: 0.3,
      filter: { type: 'bp', hz: 3500, q: 1.5 },
    },
    {
      at: 0.15,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.03, s: 0, r: 0 },
      gain: 0.25,
      filter: { type: 'bp', hz: 3500, q: 1.5 },
    },
    {
      at: 0,
      wave: 'square',
      hz: 1760,
      glide: { to: 880, t: 0.15 },
      env: { a: 0.002, d: 0.15, s: 0, r: 0 },
      gain: 0.15,
      filter: { type: 'lp', hz: 4000 },
    },
    {
      at: 0.1,
      wave: 'sine',
      hz: 1318.51,
      env: { a: 0.01, d: 0.25, s: 0, r: 0 },
      gain: 0.2,
      vibrato: { hz: 12, cents: 50 },
    },
  ],
  highpass: 200,
} satisfies SfxRecipe;
