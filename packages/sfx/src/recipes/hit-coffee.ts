import type { SfxRecipe } from '../types';

export default {
  category: 'spell',
  desc: 'A coffee splash, three little bubble blips and a warm, relieved C5 to E5 "ahh".',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.005, d: 0.35, s: 0, r: 0 },
      gain: 0.5,
      filter: { type: 'bp', hz: 1500, to: 600, t: 0.35, q: 1 },
    },
    { at: 0.1, wave: 'sine', hz: 800, env: { a: 0.002, d: 0.05, s: 0, r: 0 }, gain: 0.2 },
    { at: 0.15, wave: 'sine', hz: 1000, env: { a: 0.002, d: 0.05, s: 0, r: 0 }, gain: 0.2 },
    { at: 0.2, wave: 'sine', hz: 1200, env: { a: 0.002, d: 0.05, s: 0, r: 0 }, gain: 0.2 },
    {
      at: 0.25,
      wave: 'triangle',
      hz: 523.25,
      glide: { to: 659.26, t: 0.2 },
      env: { a: 0.02, d: 0.25, s: 0, r: 0 },
      gain: 0.2,
    },
  ],
  highpass: 150,
} satisfies SfxRecipe;
