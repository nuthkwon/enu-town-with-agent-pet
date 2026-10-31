import { measureLufs, peak } from './loudness';
import { CATEGORY_TARGETS, type Env, type Glide, type SfxRecipe, type Voice } from './types';

/**
 * A small deterministic synthesizer: band-limited oscillators (PolyBLEP), seeded noise, RBJ biquads with cutoff
 * sweeps, envelopes, glides and vibrato per voice; then master filters, a damped feedback echo, a DC blocker and a
 * soft clip; then loudness normalisation to the category target, the peak ceiling and 3 ms guard fades.
 * Pure: the same recipe and sample rate always give the same samples. No clocks, no Math.random.
 */

const TAU = Math.PI * 2;
const GUARD_S = 0.003;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  set(type: 'lp' | 'hp' | 'bp', hz: number, q: number, fs: number): void {
    const f = Math.min(Math.max(hz, 10), fs * 0.45);
    const w = (TAU * f) / fs;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lp') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === 'hp') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const ENV_K = 4;
const ENV_END = Math.exp(-ENV_K);
/** 1 → 0 over k in [0, 1] on an exponential curve that lands exactly on 0. */
const fall = (k: number) => (Math.exp(-ENV_K * k) - ENV_END) / (1 - ENV_END);

export function envLength(env: Env): number {
  return env.a + env.d + (env.hold ?? 0) + (env.s > 0 ? env.r : 0);
}

export function envelope(env: Env, t: number): number {
  if (t < 0) return 0;
  if (t < env.a) return env.a > 0 ? t / env.a : 1;
  let u = t - env.a;
  if (u < env.d) return env.s + (1 - env.s) * fall(u / env.d);
  u -= env.d;
  const hold = env.hold ?? 0;
  if (u < hold) return env.s;
  u -= hold;
  if (env.s > 0 && u < env.r) return env.s * fall(u / env.r);
  return 0;
}

function frequency(v: Voice, t: number): number {
  let f = v.hz;
  let start = 0;
  const glides: Glide[] = v.glide ? (Array.isArray(v.glide) ? v.glide : [v.glide]) : [];
  for (const g of glides) {
    if (t <= start) break;
    const k = Math.min(1, (t - start) / g.t);
    const from = f;
    f = g.curve === 'lin' ? from + (g.to - from) * k : from * (g.to / from) ** k;
    if (k < 1) return withVibrato(v, f, t);
    start += g.t;
  }
  return withVibrato(v, f, t);
}

function withVibrato(v: Voice, f: number, t: number): number {
  if (!v.vibrato) return f;
  const delay = v.vibrato.delay ?? 0;
  if (t < delay) return f;
  const ramp = Math.min(1, (t - delay) / 0.05);
  return f * 2 ** ((ramp * v.vibrato.cents * Math.sin(TAU * v.vibrato.hz * (t - delay))) / 1200);
}

function renderVoice(v: Voice, fs: number, rng: () => number, out: Float32Array): void {
  const len = envLength(v.env);
  const start = Math.round(v.at * fs);
  const n = Math.min(out.length - start, Math.ceil(len * fs));
  const filt = v.filter ? new Biquad() : null;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const f = frequency(v, t);
    const dt = f / fs;
    let s: number;
    switch (v.wave) {
      case 'sine':
        s = Math.sin(TAU * phase);
        break;
      case 'triangle':
        s = 4 * Math.abs(phase - 0.5) - 1;
        break;
      case 'square':
        s = (phase < 0.5 ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1, dt);
        break;
      case 'pulse': {
        const d = v.duty ?? 0.5;
        s = (phase < d ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase + 1 - d) % 1, dt);
        break;
      }
      case 'saw':
        s = 2 * phase - 1 - polyBlep(phase, dt);
        break;
      case 'noise':
        s = rng() * 2 - 1;
        break;
    }
    phase += dt;
    phase -= Math.floor(phase);
    if (filt && v.filter) {
      if (i % 32 === 0) {
        const fl = v.filter;
        const k = fl.to && fl.t ? Math.min(1, t / fl.t) : 0;
        const hz = fl.to ? fl.hz * (fl.to / fl.hz) ** k : fl.hz;
        filt.set(fl.type, hz, fl.q ?? 0.707, fs);
      }
      s = filt.process(s);
    }
    out[start + i]! += s * envelope(v.env, t) * v.gain;
  }
}

/** Seconds a recipe lasts, echo tail included. */
export function recipeLength(r: SfxRecipe): number {
  const dry = Math.max(...r.voices.map((v) => v.at + envLength(v.env)));
  if (!r.echo || r.echo.mix <= 0) return dry + GUARD_S;
  const repeats = Math.min(12, Math.ceil(Math.log(0.002) / Math.log(Math.max(0.05, r.echo.feedback))));
  return Math.min(dry + r.echo.delay * repeats, dry + 0.9) + GUARD_S;
}

/** Renders a recipe to mono samples at `fs`, normalised to its category's loudness and peak targets. */
export function renderRecipe(r: SfxRecipe, fs: number): Float32Array {
  const n = Math.ceil(recipeLength(r) * fs);
  const out = new Float32Array(n);
  const rng = mulberry32(r.seed ?? 1);
  for (const v of r.voices) renderVoice(v, fs, rng, out);

  if (r.highpass || r.lowpass) {
    const hp = r.highpass ? new Biquad() : null;
    const lp = r.lowpass ? new Biquad() : null;
    hp?.set('hp', r.highpass!, 0.707, fs);
    lp?.set('lp', r.lowpass!, 0.707, fs);
    for (let i = 0; i < n; i++) {
      let s = out[i]!;
      if (hp) s = hp.process(s);
      if (lp) s = lp.process(s);
      out[i] = s;
    }
  }
  if (r.echo && r.echo.mix > 0) {
    const d = Math.max(1, Math.round(r.echo.delay * fs));
    const line = new Float32Array(d);
    const damp = Math.exp((-TAU * 4000) / fs);
    let lpState = 0;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const delayed = line[w]!;
      lpState = (1 - damp) * delayed + damp * lpState;
      line[w] = out[i]! + lpState * r.echo.feedback;
      out[i] = out[i]! + delayed * r.echo.mix;
      w = (w + 1) % d;
    }
  }
  // DC blocker (20 Hz) and a soft clip above 0.8
  const R = 1 - (TAU * 20) / fs;
  let xPrev = 0;
  let yPrev = 0;
  for (let i = 0; i < n; i++) {
    const x = out[i]!;
    const y = x - xPrev + R * yPrev;
    xPrev = x;
    yPrev = y;
    const a = Math.abs(y);
    out[i] = a < 0.8 ? y : Math.sign(y) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  // loudness, peak ceiling, trim
  const target = CATEGORY_TARGETS[r.category];
  const lufs = measureLufs(out, fs);
  let gain = Number.isFinite(lufs) ? 10 ** ((target.lufs - lufs) / 20) : 1;
  const ceiling = 10 ** (target.peakDb / 20);
  const p = peak(out) * gain;
  if (p > ceiling) gain *= ceiling / p;
  gain *= 10 ** ((r.trimDb ?? 0) / 20);
  const guard = Math.max(1, Math.round(GUARD_S * fs));
  for (let i = 0; i < n; i++) {
    const edge = Math.min(1, i / guard, (n - 1 - i) / guard);
    out[i] = out[i]! * gain * edge;
  }
  return out;
}
