import type { SfxRecipe } from '../types';

export default {
  category: 'notify',
  desc: 'A warm doorbell ding-dong, E6 then C6, with soft bell partials and a short echo.',
  voices: [
    { at: 0, wave: 'sine', hz: 1318.51, env: { a: 0.003, d: 0.55, s: 0, r: 0 }, gain: 0.6 },
    { at: 0, wave: 'sine', hz: 2637.02, env: { a: 0.003, d: 0.25, s: 0, r: 0 }, gain: 0.12 },
    { at: 0, wave: 'sine', hz: 3968.715, env: { a: 0.003, d: 0.12, s: 0, r: 0 }, gain: 0.05 },
    { at: 0.26, wave: 'sine', hz: 1046.5, env: { a: 0.003, d: 0.7, s: 0, r: 0 }, gain: 0.6 },
    { at: 0.26, wave: 'sine', hz: 2093, env: { a: 0.003, d: 0.3, s: 0, r: 0 }, gain: 0.12 },
    { at: 0.26, wave: 'sine', hz: 3149.965, env: { a: 0.003, d: 0.14, s: 0, r: 0 }, gain: 0.05 },
  ],
  echo: { delay: 0.14, feedback: 0.18, mix: 0.12 },
  lowpass: 6000,
} satisfies SfxRecipe;
