import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { BrowserContext } from '@playwright/test';
import { SFX_IDS, encodeWav, measureLufs, renderSfx, type SfxId } from '@enu/sfx';
import type { Recording } from './recorder';

/**
 * The demo's sound track. Screencast frames carry no audio, so the recorded page reports every sound its engine
 * starts (`window.__enuSfxTap`, dev builds only) and the same @enu/sfx recipes are mixed here at those moments on
 * the video clock: the viewer hears exactly what the person on screen heard, never another screen's sounds. Under
 * it runs a quiet synthesized bed (84 BPM) that ducks whenever an effect sounds. The effects are set to −16 LUFS (the
 * loudness of the sounds themselves) and the bed 14 LU below them, so the effects stand out; with sparse effects over
 * a quiet bed the whole video measures around −25 LUFS integrated, and peaks stay under −2 dBFS.
 */

export const FS = 48_000;
/** Seconds from the engine starting a sound to its frame reaching the video (screencast latency). */
const AV_OFFSET = 0.06;
/** Loudness of the effects themselves (gated: silence between them does not count) and of the bed. */
export const FX_LUFS = -16;
export const BED_LUFS = -30;
/** Peaks are softly bent under this (dBFS), leaving room for the AAC encoder. */
const CEILING = 10 ** (-2 / 20);

export interface Tap {
  id: SfxId;
  /** Seconds on the video clock. */
  t: number;
}

/** Notes every sound the context's pages start while the video runs (sounds off camera are left out). */
export async function listenForSounds(
  context: BrowserContext,
  video: () => Recording | null,
): Promise<Tap[]> {
  const taps: Tap[] = [];
  await context.exposeBinding('__enuSfxTap', (_source, id: unknown) => {
    const v = video();
    if (!v || v.paused() || typeof id !== 'string' || !SFX_IDS.includes(id as SfxId)) return;
    taps.push({ id: id as SfxId, t: v.elapsed() });
  });
  return taps;
}

/* ------------------------------------------------------------------ the bed */

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function addTone(
  out: Float32Array,
  at: number,
  hold: number,
  freq: number,
  wave: 'sine' | 'triangle',
  gain: number,
  attack: number,
  release: number,
): void {
  const start = Math.round(at * FS);
  const n = Math.round((hold + release) * FS);
  let phase = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / FS;
    const env =
      t < attack
        ? t / attack
        : t < hold
          ? 1
          : Math.exp((-5 * (t - hold)) / release) * (1 - (t - hold) / release);
    const s = wave === 'sine' ? Math.sin(2 * Math.PI * phase) : 4 * Math.abs(phase - 0.5) - 1;
    out[start + i]! += s * Math.max(0, env) * gain;
    phase += freq / FS;
    phase -= Math.floor(phase);
  }
}

/** A soft bell: two sine partials with a quick attack and an exponential decay. */
function addBell(out: Float32Array, at: number, freq: number, gain: number): void {
  const start = Math.round(at * FS);
  const n = Math.round(1.4 * FS);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / FS;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 3.2);
    out[start + i]! +=
      (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-t * 6)) *
      env *
      gain;
  }
}

/** A calm loop (Cmaj7 · Am7 · Fmaj7 · G, 84 BPM): pads, a round bass and a bell arpeggio. Deterministic. */
export function renderBed(seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * FS));
  const beat = 60 / 84;
  const bar = beat * 4;
  const chords = [
    [60, 64, 67, 71],
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [55, 59, 62, 67],
  ] as const;
  const arp = [0, 2, 1, 3, 2, 1, 3, 2];
  for (let b = 0; b * bar < seconds; b++) {
    const chord = chords[b % chords.length]!;
    const t0 = b * bar;
    for (const m of chord)
      for (const cents of [-5, 5])
        addTone(out, t0, bar, hz(m - 12) * 2 ** (cents / 1200), 'triangle', 0.02, 0.9, 1.2);
    addTone(out, t0, beat * 1.6, hz(chord[0] - 24), 'sine', 0.06, 0.02, 0.5);
    addTone(out, t0 + 2 * beat, beat * 1.6, hz(chord[0] - 24), 'sine', 0.05, 0.02, 0.5);
    arp.forEach((k, i) => addBell(out, t0 + (i * beat) / 2, hz(chord[k]! + 12), i % 2 ? 0.011 : 0.016));
  }
  // A gentle low-pass, and fades at both ends.
  let y = 0;
  const a = Math.exp((-2 * Math.PI * 4500) / FS);
  for (let i = 0; i < out.length; i++) {
    y = (1 - a) * out[i]! + a * y;
    const fade = Math.min(1, i / (2 * FS), (out.length - 1 - i) / (3 * FS));
    out[i] = y * Math.max(0, fade);
  }
  // The bed sits 14 LU under the effects.
  const lufs = measureLufs(out, FS);
  const k = Number.isFinite(lufs) ? 10 ** ((BED_LUFS - lufs) / 20) : 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
  return out;
}

/* ------------------------------------------------------------------ the mix */

/** The heard sounds at their times (−16 LUFS), plus the bed ducked under them (fast attack, slow release). */
export function mixTrack(taps: Tap[], seconds: number): Float32Array {
  const fx = new Float32Array(Math.ceil(seconds * FS));
  for (const tap of taps) {
    const samples = renderSfx(tap.id, FS);
    const at = Math.round((tap.t + AV_OFFSET) * FS);
    for (let i = 0; i < samples.length && at + i < fx.length; i++) fx[at + i]! += samples[i]!;
  }
  const fxLufs = measureLufs(fx, FS);
  const g = Number.isFinite(fxLufs) ? 10 ** ((FX_LUFS - fxLufs) / 20) : 1;
  const bed = renderBed(seconds);
  const out = new Float32Array(fx.length);
  const att = Math.exp(-1 / (0.005 * FS));
  const rel = Math.exp(-1 / (0.45 * FS));
  const knee = CEILING * 0.8;
  let env = 0;
  for (let i = 0; i < out.length; i++) {
    const f = fx[i]! * g;
    const level = Math.abs(f);
    env = level > env ? att * env + (1 - att) * level : rel * env + (1 - rel) * level;
    const duck = 1 - 0.6 * Math.min(1, env / 0.08);
    const x = f + bed[i]! * duck;
    // A soft ceiling: untouched below the knee, bent smoothly towards the ceiling above it.
    const a = Math.abs(x);
    out[i] =
      a <= knee ? x : Math.sign(x) * (knee + (CEILING - knee) * Math.tanh((a - knee) / (CEILING - knee)));
  }
  return out;
}

function ffmpeg(args: string[]): string {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
  return r.stderr;
}

/** Writes the mix as WAV and puts it under the video (AAC 192 kb/s). Returns the final file. */
export function muxAudio(video: string, taps: Tap[], seconds: number, outDir: string, final: string): string {
  const wav = `${outDir}/mix.wav`;
  writeFileSync(wav, encodeWav(mixTrack(taps, seconds), FS));
  ffmpeg([
    '-i',
    video,
    '-i',
    wav,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    final,
  ]);
  return final;
}
