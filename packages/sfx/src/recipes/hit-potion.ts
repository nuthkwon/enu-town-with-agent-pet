import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'Healing: a bubbly bloop, a shimmering rise and A major sparkles (unlike the C major quest jingle).',
  voices: [
    {
      at: 0,
      wave: 'sine',
      hz: 600,
      glide: { to: 1400, t: 0.12 },
      env: { a: 0.005, d: 0.12, s: 0, r: 0 },
      gain: 0.3,
    },
    {
      at: 0.1,
      wave: 'sine',
      hz: 880,
      glide: { to: 1760, t: 0.4 },
      env: { a: 0.05, d: 0.45, s: 0, r: 0 },
      gain: 0.22,
      vibrato: { hz: 7, cents: 25 },
    },
    { at: 0.14, wave: 'sine', hz: 1760, env: { a: 0.003, d: 0.25, s: 0, r: 0 }, gain: 0.12 },
    { at: 0.22, wave: 'sine', hz: 2217.46, env: { a: 0.003, d: 0.25, s: 0, r: 0 }, gain: 0.12 },
    { at: 0.3, wave: 'sine', hz: 2637.02, env: { a: 0.003, d: 0.35, s: 0, r: 0 }, gain: 0.12 },
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.08, d: 0.5, s: 0, r: 0 },
      gain: 0.04,
      filter: { type: 'bp', hz: 5000, q: 2 },
    },
  ],
  echo: { delay: 0.09, feedback: 0.25, mix: 0.2 },
} satisfies SfxRecipe;
