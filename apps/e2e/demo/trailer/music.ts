import { measureLufs } from '@enu/sfx';

/**
 * The trailer's soundtrack, synthesized like the app's own sounds (no audio files): upbeat chiptune-pop in D major
 * (D · A · Bm · G) whose sections follow the storyboard. Drums from sines and seeded noise, an octave pulse bass,
 * a square lead with a hook, a 16th arpeggio, detuned-saw pads, a riser and a gap into every drop and an impact on
 * its downbeat (plus impacts where the picture hits). Deterministic: the same plan always renders the same samples.
 */

export const FS = 48_000;

export type SectionKind = 'intro' | 'build' | 'groove' | 'drop' | 'sting' | 'break' | 'final' | 'outro';

export interface MusicSection {
  name: string;
  bars: number;
  mood?: string;
}

export interface MusicPlan {
  bpm: number;
  sections: MusicSection[];
  /** Seconds where the picture hits hard (an impact is layered there). */
  accents?: number[];
  /** Integrated loudness of the rendered music (LUFS). */
  lufs?: number;
}

export interface RenderedMusic {
  samples: Float32Array;
  /** Seconds per beat. */
  beat: number;
  sections: { name: string; kind: SectionKind; start: number; end: number; bars: number }[];
  seconds: number;
}

/** The section's role in the arrangement, from the storyboard's words. */
export function sectionKind(name: string, mood = ''): SectionKind {
  const n = name.toLowerCase();
  // The name decides; the mood words only break a tie.
  if (/outro|logo|ending|엔딩|마무리/.test(n)) return 'outro';
  if (/final|climax|finale|클라이맥스|피날레/.test(n)) return 'final';
  if (/break|breath|calm|브레이크|쉼/.test(n)) return 'break';
  if (/title|sting|logo|타이틀/.test(n)) return 'sting';
  if (/drop|chorus|hook|main|드롭|후렴/.test(n)) return 'drop';
  if (/groove|verse|montage|그루브/.test(n)) return 'groove';
  if (/build|rise|riser|빌드/.test(n)) return 'build';
  if (/intro|cold|open|인트로/.test(n)) return 'intro';
  const m = mood.toLowerCase();
  if (/calm|soft|gentle|cozy/.test(m)) return 'break';
  if (/drive|bounce|groove/.test(m)) return 'groove';
  if (/rise|tension|build/.test(m)) return 'build';
  if (/hit|punch|energy|hype/.test(m)) return 'drop';
  return 'intro';
}

/* ------------------------------------------------------------------ primitives */

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A seeded xorshift noise source in −1..1. */
function noiseSource(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return (x / 0xffffffff) * 2 - 1;
  };
}

/** PolyBLEP residual for band-limited steps. */
function blep(t: number, dt: number): number {
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

/** A topology-preserving state-variable filter (stable under per-sample cutoff changes). */
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  constructor(private readonly q = 0.707) {}
  run(x: number, cutoff: number): { lp: number; bp: number; hp: number } {
    const g = Math.tan((Math.PI * Math.min(cutoff, FS * 0.45)) / FS);
    const k = 1 / this.q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  }
}

type Wave = 'square' | 'pulse' | 'saw' | 'triangle' | 'sine';

interface ToneOpts {
  wave: Wave;
  duty?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  /** Vibrato depth (cents) and rate, after `delay` seconds. */
  vibrato?: { cents: number; rate: number; delay: number };
  /** Lowpass cutoff (Hz) or a cutoff that moves over the note (0..1 of its length). */
  cutoff?: number | ((u: number) => number);
  /** Pitch slide: start this many semitones off and reach the note after `t` seconds. */
  slide?: { from: number; t: number };
  detuneCents?: number;
}

/** One oscillator note into `out` at `at` seconds, `dur` seconds long (+ release). */
function tone(out: Float32Array, at: number, dur: number, freq: number, gain: number, o: ToneOpts): void {
  const a = o.attack ?? 0.004;
  const d = o.decay ?? 0.08;
  const s = o.sustain ?? 0.7;
  const r = o.release ?? 0.06;
  const start = Math.round(at * FS);
  const n = Math.round((dur + r) * FS);
  const f0 = freq * 2 ** ((o.detuneCents ?? 0) / 1200);
  const svf = o.cutoff ? new Svf(0.8) : null;
  let phase = 0;
  let tri = 0;
  for (let i = 0; i < n; i++) {
    const j = start + i;
    if (j < 0) continue;
    if (j >= out.length) break;
    const t = i / FS;
    let env: number;
    if (t < a) env = t / a;
    else if (t < a + d) env = 1 - (1 - s) * ((t - a) / d);
    else if (t < dur) env = s;
    else env = s * Math.max(0, 1 - (t - dur) / r);
    let f = f0;
    if (o.slide && t < o.slide.t) f *= 2 ** ((o.slide.from * (1 - t / o.slide.t)) / 12);
    if (o.vibrato && t > o.vibrato.delay)
      f *= 2 ** ((o.vibrato.cents * Math.sin(2 * Math.PI * o.vibrato.rate * (t - o.vibrato.delay))) / 1200);
    const dt = f / FS;
    let v: number;
    switch (o.wave) {
      case 'sine':
        v = Math.sin(2 * Math.PI * phase);
        break;
      case 'saw':
        v = 2 * phase - 1 - blep(phase, dt);
        break;
      case 'triangle': {
        // Integrated band-limited square.
        let sq = phase < 0.5 ? 1 : -1;
        sq += blep(phase, dt) - blep((phase + 0.5) % 1, dt);
        tri = dt * sq + (1 - dt) * tri;
        v = tri * 4;
        break;
      }
      default: {
        const duty = o.wave === 'square' ? 0.5 : (o.duty ?? 0.25);
        v = phase < duty ? 1 : -1;
        v += blep(phase, dt) - blep((phase + 1 - duty) % 1, dt);
      }
    }
    if (svf) {
      const c = typeof o.cutoff === 'function' ? o.cutoff(Math.min(1, t / dur)) : (o.cutoff as number);
      v = svf.run(v, c).lp;
    }
    out[j]! += v * env * gain;
    phase += dt;
    phase -= Math.floor(phase);
  }
}

function kick(out: Float32Array, at: number, gain: number): void {
  const start = Math.round(at * FS);
  const n = Math.round(0.32 * FS);
  let phase = 0;
  const click = noiseSource(7 + start);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / FS;
    const f = 52 + 110 * Math.exp(-t / 0.028);
    phase += f / FS;
    const body = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.12) * Math.min(1, t / 0.0015);
    const tick = t < 0.004 ? click() * (1 - t / 0.004) * 0.35 : 0;
    out[start + i]! += (body + tick) * gain;
  }
}

function snare(out: Float32Array, at: number, gain: number, seed: number): void {
  const start = Math.round(at * FS);
  const n = Math.round(0.24 * FS);
  const rnd = noiseSource(seed);
  const svf = new Svf(0.9);
  let phase = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / FS;
    const noise = svf.run(rnd(), 3800).bp * 1.6 * Math.exp(-t / 0.075);
    phase += (180 + 60 * Math.exp(-t / 0.02)) / FS;
    const body = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.045) * 0.7;
    out[start + i]! += (noise + body) * Math.min(1, t / 0.001) * gain;
  }
}

function clap(out: Float32Array, at: number, gain: number, seed: number): void {
  const start = Math.round(at * FS);
  const n = Math.round(0.26 * FS);
  const rnd = noiseSource(seed);
  const svf = new Svf(1.4);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / FS;
    // Three quick slaps, then the tail.
    const slap = [0, 0.011, 0.022].reduce(
      (acc, s) => acc + (t >= s && t < s + 0.009 ? Math.exp(-(t - s) / 0.004) : 0),
      0,
    );
    const tail = t >= 0.022 ? Math.exp(-(t - 0.022) / 0.09) : 0;
    out[start + i]! += svf.run(rnd(), 1300).bp * (slap + tail * 0.8) * 2.2 * gain;
  }
}

function hat(out: Float32Array, at: number, gain: number, open: boolean, seed: number): void {
  const start = Math.round(at * FS);
  const decay = open ? 0.16 : 0.03;
  const n = Math.round((open ? 0.45 : 0.09) * FS);
  const rnd = noiseSource(seed);
  const svf = new Svf(0.7);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / FS;
    out[start + i]! += svf.run(rnd(), 8200).hp * Math.exp(-t / decay) * gain;
  }
}

function crash(out: Float32Array, at: number, gain: number, seed: number, reverse = false, len = 1.8): void {
  const n = Math.round(len * FS);
  const start = Math.round((reverse ? at - len : at) * FS);
  const rnd = noiseSource(seed);
  const svf = new Svf(0.6);
  for (let i = 0; i < n; i++) {
    const j = start + i;
    if (j < 0) continue;
    if (j >= out.length) break;
    const t = (reverse ? n - i : i) / FS;
    const env = reverse ? Math.exp(-t / 0.5) : Math.exp(-t / 0.55) * Math.min(1, t / 0.002);
    out[j]! += svf.run(rnd(), 5200).hp * env * gain;
  }
}

/** A noise sweep plus a rising saw, `from` → `to` seconds; it stops dead at `to` (the gap before a drop). */
function riser(out: Float32Array, from: number, to: number, gain: number, seed: number): void {
  const start = Math.round(from * FS);
  const n = Math.round((to - from) * FS);
  const rnd = noiseSource(seed);
  const svf = new Svf(2.2);
  let phase = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const u = i / n;
    const cutoff = 300 * 30 ** u;
    const swell = u * u;
    const noise = svf.run(rnd(), cutoff).bp * 1.4;
    const f = hz(50) * 4 ** u;
    phase += f / FS;
    phase -= Math.floor(phase);
    const saw = (2 * phase - 1) * 0.12;
    out[start + i]! += (noise + saw) * swell * gain;
  }
}

/** A sub boom and a crash: the downbeat of a drop, or a hit the picture lands on. */
function impact(out: Float32Array, at: number, gain: number, seed: number): void {
  const start = Math.round(at * FS);
  const n = Math.round(1.3 * FS);
  let phase = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const t = i / FS;
    phase += (38 + 70 * Math.exp(-t / 0.07)) / FS;
    out[start + i]! += Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.32) * Math.min(1, t / 0.002) * gain;
  }
  crash(out, at, gain * 0.55, seed);
  snare(out, at, gain * 0.5, seed + 1);
}

/* ------------------------------------------------------------------ the song */

/** D · A · Bm · G (I–V–vi–IV); the outro rests on D. */
const CHORDS = [
  { root: 38, tones: [62, 66, 69], arp: [74, 78, 81, 86] },
  { root: 33, tones: [61, 64, 69], arp: [69, 73, 76, 81] },
  { root: 35, tones: [62, 66, 71], arp: [71, 74, 78, 83] },
  { root: 31, tones: [62, 67, 71], arp: [67, 71, 74, 79] },
] as const;

/** The hook: [16th step, length in 16ths, MIDI note], eight bars over the four chords twice. */
const HOOK: readonly (readonly [number, number, number])[][] = [
  [
    [0, 3, 69],
    [3, 3, 74],
    [6, 2, 78],
    [8, 4, 81],
    [12, 2, 79],
    [14, 2, 78],
  ],
  [
    [0, 3, 76],
    [3, 3, 73],
    [6, 2, 76],
    [8, 6, 81],
    [14, 2, 79],
  ],
  [
    [0, 3, 78],
    [3, 3, 74],
    [6, 2, 78],
    [8, 4, 83],
    [12, 2, 81],
    [14, 2, 78],
  ],
  [
    [0, 3, 79],
    [3, 3, 78],
    [6, 2, 76],
    [8, 4, 74],
    [12, 4, 76],
  ],
  [
    [0, 3, 69],
    [3, 3, 74],
    [6, 2, 78],
    [8, 4, 81],
    [12, 2, 79],
    [14, 2, 78],
  ],
  [
    [0, 3, 76],
    [3, 3, 81],
    [6, 2, 85],
    [8, 6, 85],
    [14, 2, 83],
  ],
  [
    [0, 3, 83],
    [3, 3, 81],
    [6, 2, 78],
    [8, 4, 74],
    [12, 2, 78],
    [14, 2, 81],
  ],
  [
    [0, 4, 83],
    [4, 4, 81],
    [8, 6, 79],
    [14, 2, 81],
  ],
];
const ARP_STEPS = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];

interface Buses {
  drums: Float32Array;
  bass: Float32Array;
  lead: Float32Array;
  arp: Float32Array;
  pad: Float32Array;
  fx: Float32Array;
}

export function renderMusic(plan: MusicPlan): RenderedMusic {
  const beat = 60 / plan.bpm;
  const bar = beat * 4;
  const step = beat / 4;
  const sections: RenderedMusic['sections'] = [];
  let t = 0;
  for (const s of plan.sections) {
    const kind = sectionKind(s.name, s.mood);
    sections.push({ name: s.name, kind, start: t, end: t + s.bars * bar, bars: s.bars });
    t += s.bars * bar;
  }
  const tail = 4.5;
  const seconds = t;
  const len = Math.ceil((seconds + tail) * FS);
  const bus: Buses = {
    drums: new Float32Array(len),
    bass: new Float32Array(len),
    lead: new Float32Array(len),
    arp: new Float32Array(len),
    pad: new Float32Array(len),
    fx: new Float32Array(len),
  };
  /** Sidechain: how much the kick pushes the bass, pads and arp down (drop and final only). */
  const pump = new Float32Array(len).fill(1);
  let seed = 11;
  let hookBar = 0;

  sections.forEach((sec, si) => {
    const next = sections[si + 1];
    const intoDrop =
      next &&
      (next.kind === 'drop' || next.kind === 'final' || next.kind === 'outro' || next.kind === 'sting');
    for (let b = 0; b < sec.bars; b++) {
      const t0 = sec.start + b * bar;
      const chord = sec.kind === 'outro' ? CHORDS[0]! : CHORDS[b % 4]!;
      const lastBar = b === sec.bars - 1;
      const big = sec.kind === 'drop' || sec.kind === 'final';
      const groove = sec.kind === 'groove';
      // A short gap right before a drop: everything stops for the last 8th (the riser stops with it).
      const gapAt = intoDrop && lastBar ? t0 + bar - beat / 2 : Infinity;
      const until = (x: number) => Math.min(x, gapAt);

      /* drums */
      if (big || groove) {
        for (let k = 0; k < 4; k++) {
          const bt = t0 + k * beat;
          if (bt >= gapAt) break;
          kick(bus.drums, bt, 0.72);
          const p0 = Math.round(bt * FS);
          for (let i = 0; i < Math.round(beat * FS) && p0 + i < len; i++) {
            const x = i / FS;
            pump[p0 + i] = Math.min(pump[p0 + i]!, 1 - 0.55 * Math.exp(-x / 0.11));
          }
          if (k % 2 === 1) {
            clap(bus.drums, bt, 0.75, seed++);
            snare(bus.drums, bt, 0.32, seed++);
          }
        }
        for (let s16 = 0; s16 < 16; s16++) {
          const ht = t0 + s16 * step;
          if (ht >= gapAt) break;
          const off = s16 % 4 === 2;
          if (off) hat(bus.drums, ht, 0.22, true, seed++);
          else hat(bus.drums, ht, s16 % 2 ? 0.08 : 0.12, false, seed++);
        }
        // A snare fill closing every fourth bar.
        if (b % 4 === 3 && !intoDrop)
          for (let s16 = 12; s16 < 16; s16++)
            snare(bus.drums, t0 + s16 * step, 0.28 + 0.06 * (s16 - 12), seed++);
        if (sec.kind === 'final' && b % 2 === 0) crash(bus.drums, t0, 0.16, seed++);
        if (groove && b === 0) crash(bus.drums, t0, 0.14, seed++);
      } else if (sec.kind === 'build') {
        const half = b >= sec.bars / 2;
        for (let k = 0; k < 4; k++) {
          const bt = t0 + k * beat;
          if (bt >= gapAt) break;
          if (half || k % 2 === 0) kick(bus.drums, bt, 0.75);
          hat(bus.drums, bt + beat / 2, 0.12, false, seed++);
        }
        if (lastBar) {
          // A snare roll: 8ths, then 16ths, louder as it climbs.
          for (let s16 = 0; s16 < 16; s16++) {
            const st = t0 + s16 * step;
            if (st >= gapAt) break;
            if (s16 < 8 && s16 % 2) continue;
            snare(bus.drums, st, 0.16 + 0.03 * s16, seed++);
          }
        }
      } else if (sec.kind === 'break' && b >= sec.bars - 1) {
        for (let s16 = 0; s16 < 16; s16 += 2) {
          const st = t0 + s16 * step;
          if (st >= gapAt) break;
          snare(bus.drums, st, 0.1 + 0.025 * s16, seed++);
        }
      } else if (sec.kind === 'break' && sec.bars >= 4 && b >= sec.bars / 2) {
        // A long break picks the beat back up at half time before its last bar.
        kick(bus.drums, t0, 0.6);
        kick(bus.drums, t0 + 2 * beat, 0.6);
        clap(bus.drums, t0 + 2 * beat, 0.45, seed++);
        for (let k = 0; k < 4; k++) hat(bus.drums, t0 + k * beat + beat / 2, 0.09, false, seed++);
      } else if (sec.kind === 'intro' && lastBar && sec.bars > 1) {
        for (let k = 0; k < 4; k++) hat(bus.drums, t0 + k * beat + beat / 2, 0.08, false, seed++);
      }

      /* bass: octave 8ths in the drops; whole notes elsewhere (none in the intro's first bars) */
      if (big || groove || sec.kind === 'build') {
        for (let e = 0; e < 8; e++) {
          const et = t0 + e * (beat / 2);
          if (et >= gapAt) break;
          const note = chord.root + (e % 2 ? 12 : 0) + 12;
          const cut = sec.kind === 'build' ? 500 + 1200 * ((b + e / 8) / sec.bars) : 1600;
          tone(bus.bass, et, beat / 2 - 0.02, hz(note), 0.32, {
            wave: 'pulse',
            duty: 0.25,
            decay: 0.12,
            sustain: 0.6,
            release: 0.02,
            cutoff: cut,
          });
          if (e % 2 === 0)
            tone(bus.bass, et, beat - 0.03, hz(chord.root + 12), 0.22, {
              wave: 'sine',
              sustain: 0.9,
              release: 0.03,
            });
        }
      } else if (sec.kind === 'break' || (sec.kind === 'intro' && b >= sec.bars / 2)) {
        tone(bus.bass, t0, until(t0 + bar) - t0 - 0.05, hz(chord.root + 12), 0.26, {
          wave: 'triangle',
          attack: 0.05,
          sustain: 0.8,
          release: 0.2,
        });
      }

      /* pads: every section; brighter in the drops */
      if (sec.kind !== 'outro' && sec.kind !== 'sting') {
        const cutoff =
          sec.kind === 'intro'
            ? (u: number) => 500 + 900 * ((b + u) / sec.bars)
            : sec.kind === 'build'
              ? (u: number) => 900 + 2200 * ((b + u) / sec.bars)
              : big
                ? 2600
                : groove
                  ? 2000
                  : 1300;
        for (const m of chord.tones)
          for (const det of [-9, 0, 9])
            tone(bus.pad, t0, until(t0 + bar) - t0, hz(m), 0.045, {
              wave: 'saw',
              attack: big ? 0.01 : 0.25,
              decay: 0.3,
              sustain: 0.75,
              release: 0.25,
              cutoff,
              detuneCents: det,
            });
      }

      /* arp: 16ths everywhere but the outro and the sting (filtered open through the intro) */
      if (sec.kind !== 'outro' && sec.kind !== 'sting') {
        for (let s16 = 0; s16 < 16; s16++) {
          const at = t0 + s16 * step;
          if (at >= gapAt) break;
          const note = chord.arp[ARP_STEPS[s16]!]!;
          const g =
            sec.kind === 'intro' ? 0.05 + 0.05 * ((b + s16 / 16) / sec.bars) : big || groove ? 0.075 : 0.065;
          tone(bus.arp, at, step * 0.6, hz(note), g, {
            wave: 'pulse',
            duty: 0.125,
            decay: 0.06,
            sustain: 0.3,
            release: 0.03,
          });
        }
      }

      /* lead: the hook in the drops (an octave up doubled in the final); a quiet hint in the break */
      if (big || sec.kind === 'break') {
        const phrase = HOOK[hookBar % HOOK.length]!;
        hookBar += 1;
        for (const [s16, l, m] of phrase) {
          const at = t0 + s16 * step;
          if (at >= gapAt) continue;
          const dur = Math.min(l * step - 0.012, gapAt - at);
          const g = sec.kind === 'break' ? 0.07 : 0.13;
          const opts: ToneOpts = {
            wave: sec.kind === 'break' ? 'triangle' : 'pulse',
            duty: 0.25,
            attack: 0.003,
            decay: 0.1,
            sustain: 0.75,
            release: 0.05,
            vibrato: { cents: 18, rate: 5.5, delay: 0.16 },
            slide: s16 === 0 ? { from: -1, t: 0.03 } : undefined,
          };
          tone(bus.lead, at, dur, hz(m), g, opts);
          if (sec.kind === 'final')
            tone(bus.lead, at, dur, hz(m + 12), g * 0.45, { ...opts, wave: 'square' });
        }
      }

      /* risers and the reverse cymbal into a drop */
      if (intoDrop && b === Math.max(0, sec.bars - 2))
        riser(bus.fx, t0, sec.start + sec.bars * bar - beat / 2, 0.35, seed++);
      if (intoDrop && lastBar) crash(bus.fx, t0 + bar - beat / 2, 0.22, seed++, true, 1.4);
    }

    /* the drop's downbeat */
    if (sec.kind === 'drop' || sec.kind === 'final') impact(bus.fx, sec.start, 0.6, seed++);
    if (sec.kind === 'sting') {
      // The logo's moment: one big hit and a bright chord that rings, no beat; a quick run up on top.
      impact(bus.fx, sec.start, 0.8, seed++);
      const hold = sec.end - sec.start;
      for (const m of [50, 62, 66, 69, 74, 78])
        for (const det of [-8, 8])
          tone(bus.pad, sec.start, hold, hz(m), 0.045, {
            wave: 'saw',
            attack: 0.01,
            decay: hold * 0.8,
            sustain: 0.35,
            release: 0.3,
            cutoff: (u) => 3600 - 2200 * u,
            detuneCents: det,
          });
      tone(bus.bass, sec.start, hold, hz(38), 0.3, { wave: 'sine', decay: hold, sustain: 0.3, release: 0.2 });
      [74, 78, 81, 86, 90].forEach((m, i) =>
        tone(bus.lead, sec.start + beat / 2 + 0.07 * i, 0.35, hz(m), 0.07, {
          wave: 'square',
          decay: 0.15,
          sustain: 0.3,
          release: 0.3,
        }),
      );
    }
    if (sec.kind === 'outro') {
      impact(bus.fx, sec.start, 0.75, seed++);
      const hold = sec.end - sec.start + 1.5;
      for (const m of [50, 62, 66, 69, 74])
        for (const det of [-7, 7])
          tone(bus.pad, sec.start, hold, hz(m), 0.05, {
            wave: 'saw',
            attack: 0.02,
            decay: hold,
            sustain: 0.15,
            release: 1.5,
            cutoff: (u) => 3000 - 2000 * u,
            detuneCents: det,
          });
      tone(bus.bass, sec.start, hold, hz(38), 0.3, { wave: 'sine', decay: hold, sustain: 0.1, release: 1 });
      // A last flourish: up the D major arpeggio, then a bell on top.
      [62, 66, 69, 74, 78, 81, 86].forEach((m, i) =>
        tone(bus.lead, sec.start + 0.06 * i, 0.5, hz(m), 0.08, {
          wave: 'square',
          decay: 0.2,
          sustain: 0.3,
          release: 0.4,
        }),
      );
    }
  });

  for (const at of plan.accents ?? []) impact(bus.fx, at, 0.6, seed++);

  // Echo on the lead and the arp (a dotted 8th), then the mix.
  for (const [b, fb, mix] of [
    [bus.lead, 0.28, 0.22],
    [bus.arp, 0.3, 0.3],
  ] as const) {
    const d = Math.round(beat * 0.75 * FS);
    for (let i = d; i < len; i++) b[i] = b[i]! + b[i - d]! * fb * (mix / 0.3);
  }
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const p = pump[i]!;
    out[i] =
      bus.drums[i]! * 0.9 +
      bus.bass[i]! * p +
      bus.lead[i]! +
      bus.arp[i]! * (0.6 + 0.4 * p) +
      bus.pad[i]! * p +
      bus.fx[i]!;
  }
  // Gentle saturation glues the mix; then the master EQ: nothing under 35 Hz (it only eats headroom) and the lows
  // shelved down a little, so the kick and the booms leave room for the spells' own sounds on small speakers.
  const sub = new Svf(0.707);
  const low = new Svf(0.6);
  for (let i = 0; i < len; i++) {
    const x = Math.tanh(out[i]! * 1.2) / 1.2;
    const hp = sub.run(x, 35).hp;
    out[i] = hp - 0.3 * low.run(hp, 140).lp;
  }
  const lufs = measureLufs(out, FS);
  const k = Number.isFinite(lufs) ? 10 ** (((plan.lufs ?? -16) - lufs) / 20) : 1;
  for (let i = 0; i < len; i++) out[i] = out[i]! * k;
  return { samples: out, beat, sections, seconds };
}
