/**
 * @enu/sfx — ENU Den's sound effects as code (ADR 0008). Browser-safe and pure: the web app renders a recipe into an
 * AudioBuffer at the context's sample rate; Node tooling (`pnpm sfx`) renders the same samples to WAV and a picture.
 */
import { RECIPES, type SfxId } from './recipes';
import { renderRecipe } from './synth';

export * from './types';
export { renderRecipe, recipeLength, envelope, envLength } from './synth';
export { measureLufs, kWeighting, dbfs, peak } from './loudness';
export { fft, spectrogram, pitchTrack, noteName, metrics, type PitchPoint, type SfxMetrics } from './analyze';
export { encodeWav, decodeWav } from './wav';
export { checkRecipe, type SfxCheck } from './check';
export { RECIPES, SFX_IDS, type SfxId } from './recipes';

/** The samples of one sound at `fs` (mono, normalised to its category). */
export function renderSfx(id: SfxId, fs: number): Float32Array {
  return renderRecipe(RECIPES[id], fs);
}
