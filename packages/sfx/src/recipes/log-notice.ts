import type { SfxRecipe } from '../types';

export default {
  category: 'notify',
  desc: 'Deliberately neutral: a tiny paper tick and one G6 note when my Claude publishes my log.',
  voices: [
    {
      at: 0,
      wave: 'noise',
      hz: 0,
      env: { a: 0.001, d: 0.015, s: 0, r: 0 },
      gain: 0.3,
      filter: { type: 'hp', hz: 2000 },
    },
    { at: 0.03, wave: 'sine', hz: 1567.98, env: { a: 0.003, d: 0.16, s: 0, r: 0 }, gain: 0.5 },
  ],
} satisfies SfxRecipe;
