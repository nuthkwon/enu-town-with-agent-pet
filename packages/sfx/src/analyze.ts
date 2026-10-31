import { dbfs, measureLufs, peak } from './loudness';

/**
 * Seeing a sound (Claude cannot listen): metrics, a spectrogram and a pitch track. Pure and browser-safe.
 */

/** In-place radix-2 FFT of length 2^k (re, im). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j]!;
        const ai = im[i + j]!;
        const br = re[i + j + len / 2]! * cr - im[i + j + len / 2]! * ci;
        const bi = re[i + j + len / 2]! * ci + im[i + j + len / 2]! * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Power spectra of Hann-windowed frames: frames[t][bin], bins 0..size/2. */
export function spectrogram(x: Float32Array, size = 1024, hop = 128): Float64Array[] {
  const win = Float64Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
  );
  const frames: Float64Array[] = [];
  for (let start = -size / 2; start < x.length; start += hop) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const j = start + i;
      re[i] = j >= 0 && j < x.length ? x[j]! * win[i]! : 0;
    }
    fft(re, im);
    const p = new Float64Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) p[k] = re[k]! * re[k]! + im[k]! * im[k]!;
    frames.push(p);
  }
  return frames;
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTE[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export interface PitchPoint {
  t: number;
  hz: number;
  /** Level of the frame (dBFS, RMS). */
  db: number;
}

/** The strongest partial per 20 ms (FFT peak with parabolic interpolation), for frames above −45 dBFS RMS. */
export function pitchTrack(x: Float32Array, fs: number): PitchPoint[] {
  const size = 2048;
  const hop = Math.round(0.02 * fs);
  const out: PitchPoint[] = [];
  const win = Float64Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
  );
  for (let start = 0; start + size / 4 < x.length; start += hop) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let rms = 0;
    for (let i = 0; i < size; i++) {
      const v = start + i < x.length ? x[start + i]! : 0;
      rms += v * v;
      re[i] = v * win[i]!;
    }
    const db = 10 * Math.log10(rms / size + 1e-20);
    if (db < -45) continue;
    fft(re, im);
    const lo = Math.floor((100 * size) / fs);
    const hi = Math.ceil((8000 * size) / fs);
    let best = lo;
    let bestP = 0;
    const pw = (k: number) => re[k]! * re[k]! + im[k]! * im[k]!;
    for (let k = lo; k <= hi; k++) {
      if (pw(k) > bestP) {
        bestP = pw(k);
        best = k;
      }
    }
    const a = Math.log(pw(best - 1) + 1e-30);
    const b = Math.log(bestP + 1e-30);
    const c = Math.log(pw(best + 1) + 1e-30);
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
    out.push({ t: (start + size / 2) / fs, hz: ((best + shift) * fs) / size, db });
  }
  return out;
}

export interface SfxMetrics {
  seconds: number;
  peakDb: number;
  lufs: number;
  dc: number;
  /** The first and the last sample (dBFS): a click if either is not silent. */
  edgeDb: number;
  /** When the sound becomes audible (first sample above −40 dBFS), in ms. */
  startMs: number;
  /** Peak of the last 3 ms (dBFS): a chopped tail if loud. */
  tailDb: number;
  /** Peak of the last 10 % (dBFS). */
  endDb: number;
  /** Share of energy above 10 kHz and below 120 Hz. */
  highShare: number;
  lowShare: number;
  finite: boolean;
}

export function metrics(x: Float32Array, fs: number): SfxMetrics {
  const n = x.length;
  const finite = x.every((v) => Number.isFinite(v));
  let sum = 0;
  for (const v of x) sum += v;
  const edge = Math.max(1, Math.round(0.003 * fs));
  const peakOf = (a: number, b: number) => {
    let p = 0;
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) p = Math.max(p, Math.abs(x[i]!));
    return dbfs(p);
  };
  const audible = x.findIndex((v) => Math.abs(v) > 0.01);
  let high = 0;
  let low = 0;
  let all = 0;
  const size = 1024;
  for (const frame of spectrogram(x, size, 512)) {
    for (let k = 1; k < frame.length; k++) {
      const hz = (k * fs) / size;
      all += frame[k]!;
      if (hz > 10_000) high += frame[k]!;
      if (hz < 120) low += frame[k]!;
    }
  }
  return {
    seconds: n / fs,
    peakDb: dbfs(peak(x)),
    lufs: measureLufs(x, fs),
    dc: n ? sum / n : 0,
    edgeDb: n ? dbfs(Math.max(Math.abs(x[0]!), Math.abs(x[n - 1]!))) : -Infinity,
    startMs: audible < 0 ? Infinity : (audible / fs) * 1000,
    tailDb: peakOf(n - edge, n),
    endDb: peakOf(Math.floor(n * 0.9), n),
    highShare: all ? high / all : 0,
    lowShare: all ? low / all : 0,
    finite,
  };
}
