import type { SfxRecipe } from '../types';

export default {
  category: 'ui',
  desc: 'Speaker on: two soft triangle notes going up, C6 then G6.',
  voices: [
    { at: 0, wave: 'triangle', hz: 1046.5, env: { a: 0.004, d: 0.07, s: 0, r: 0 }, gain: 0.5 },
    { at: 0.075, wave: 'triangle', hz: 1567.98, env: { a: 0.004, d: 0.09, s: 0, r: 0 }, gain: 0.5 },
  ],
} satisfies SfxRecipe;
