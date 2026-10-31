/**
 * Sound effects as code (ADR 0008): a recipe is data; `renderRecipe` turns it into samples, the same in the
 * browser (played through WebAudio) and in Node (WAV files to look at, the demo's audio). No audio files.
 */

export type Wave = 'sine' | 'triangle' | 'square' | 'pulse' | 'saw' | 'noise';

/** Envelope in seconds; `s` is the sustain level (0..1) held for `hold` seconds before the release. */
export interface Env {
  a: number;
  d: number;
  s: number;
  r: number;
  hold?: number;
}

/** Pitch glide: reach `to` Hz after `t` seconds from the voice's start (exponential by default). */
export interface Glide {
  to: number;
  t: number;
  curve?: 'exp' | 'lin';
}

export interface Filter {
  type: 'lp' | 'hp' | 'bp';
  hz: number;
  q?: number;
  /** Sweep the cutoff to `to` Hz over `t` seconds (exponential). */
  to?: number;
  t?: number;
}

export interface Voice {
  /** Start time (s). */
  at: number;
  wave: Wave;
  /** Start frequency (Hz); ignored by plain noise unless a filter uses it. */
  hz: number;
  /** One glide, or several in a row. */
  glide?: Glide | Glide[];
  /** Pulse width (0..1) for `pulse`. Default 0.5. */
  duty?: number;
  env: Env;
  /** Linear gain before the mix (0..1). */
  gain: number;
  vibrato?: { hz: number; cents: number; delay?: number };
  filter?: Filter;
}

/**
 * Categories set the loudness target, the peak ceiling and the longest a sound may be.
 * ui: my own clicks; spell: casts and hits; notify: things addressed to me; pet: my familiar and my quests.
 */
export type SfxCategory = 'ui' | 'spell' | 'notify' | 'pet';

export interface SfxRecipe {
  category: SfxCategory;
  /** One line: character, contour, length. */
  desc: string;
  voices: Voice[];
  echo?: { delay: number; feedback: number; mix: number };
  /** Master filters (Hz). */
  lowpass?: number;
  highpass?: number;
  /** Fine trim (dB) after loudness normalisation. */
  trimDb?: number;
  /** Seed for noise voices. Default 1. */
  seed?: number;
}

export interface CategoryTarget {
  /** Integrated loudness target (LUFS, BS.1770 K-weighted). */
  lufs: number;
  /** Allowed deviation (LU) after the peak ceiling has had its say. */
  tolerance: number;
  /** Peak ceiling (dBFS). */
  peakDb: number;
  /** Longest render (s). */
  maxSeconds: number;
}

export const CATEGORY_TARGETS: Record<SfxCategory, CategoryTarget> = {
  ui: { lufs: -24, tolerance: 3, peakDb: -6, maxSeconds: 0.6 },
  spell: { lufs: -22, tolerance: 3, peakDb: -3, maxSeconds: 2.0 },
  notify: { lufs: -20, tolerance: 2, peakDb: -3, maxSeconds: 1.6 },
  pet: { lufs: -21, tolerance: 2, peakDb: -3, maxSeconds: 2.0 },
};
