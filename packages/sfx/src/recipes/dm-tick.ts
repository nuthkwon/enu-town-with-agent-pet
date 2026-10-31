import type { SfxRecipe } from '../types';

export default {
  category: 'ui',
  desc: 'A single soft E6 tick: a new line in the DM I am reading.',
  voices: [{ at: 0, wave: 'triangle', hz: 1318.51, env: { a: 0.002, d: 0.06, s: 0, r: 0 }, gain: 0.4 }],
} satisfies SfxRecipe;
