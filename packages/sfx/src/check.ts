import { metrics, type SfxMetrics } from './analyze';
import { renderRecipe } from './synth';
import { CATEGORY_TARGETS, type SfxRecipe } from './types';

/**
 * `pnpm sfx:check`: what a sound must be before it ships (the sound side of pixelfx's check): finite, no DC, silent
 * first and last samples, audible at once, no chopped tail, a release that finishes, not too bright or too boomy for
 * a laptop in a shared room, within its category's length, loudness and peak, and the same samples every time at
 * both common sample rates.
 */

export interface SfxCheck {
  errors: string[];
  metrics: SfxMetrics;
}

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : String(v));

export function checkRecipe(r: SfxRecipe): SfxCheck {
  const errs: string[] = [];
  const t = CATEGORY_TARGETS[r.category];
  const a = renderRecipe(r, 48_000);
  const m = metrics(a, 48_000);
  if (!m.finite) errs.push('NaN or Infinity in the samples');
  if (Math.abs(m.dc) > 0.002) errs.push(`DC offset ${m.dc.toFixed(4)} (max 0.002)`);
  if (m.edgeDb > -80) errs.push(`click at an end: the first or last sample is at ${fmt(m.edgeDb)} dBFS`);
  if (m.startMs > 30)
    errs.push(`starts late: audible after ${m.startMs.toFixed(0)} ms (max 30): feedback must be immediate`);
  if (m.tailDb > -40)
    errs.push(
      `chopped tail: the last 3 ms peak at ${fmt(m.tailDb)} dBFS (max -40): shorten the echo or the release`,
    );
  if (m.endDb > m.peakDb - 30)
    errs.push(
      `the release does not finish: the last 10 % is only ${fmt(m.peakDb - m.endDb)} dB under the peak (min 30)`,
    );
  if (m.highShare > 0.15)
    errs.push(`too bright: ${(m.highShare * 100).toFixed(0)} % of the energy above 10 kHz (max 15 %)`);
  if (m.lowShare > 0.1)
    errs.push(`too boomy: ${(m.lowShare * 100).toFixed(0)} % of the energy below 120 Hz (max 10 %)`);
  if (m.seconds > t.maxSeconds)
    errs.push(`${m.seconds.toFixed(2)} s long: a ${r.category} sound is at most ${t.maxSeconds} s`);
  if (m.peakDb > t.peakDb + 0.1)
    errs.push(`peak ${fmt(m.peakDb)} dBFS over the ${r.category} ceiling ${t.peakDb}`);
  if (!(Math.abs(m.lufs - t.lufs) <= t.tolerance))
    errs.push(
      `loudness ${fmt(m.lufs)} LUFS, ${r.category} wants ${t.lufs} ± ${t.tolerance} (spiky? soften the attack or add body)`,
    );
  const b = renderRecipe(r, 48_000);
  if (a.length !== b.length || a.some((v, i) => v !== b[i]))
    errs.push('not deterministic: two renders differ');
  const c = renderRecipe(r, 44_100);
  const mc = metrics(c, 44_100);
  if (!mc.finite || Math.abs(mc.lufs - m.lufs) > 0.5)
    errs.push(`renders differently at 44.1 kHz (${fmt(mc.lufs)} vs ${fmt(m.lufs)} LUFS)`);
  return { errors: errs, metrics: m };
}
