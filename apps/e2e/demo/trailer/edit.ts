import type { Moment, Point } from './moments';
import { sectionKind } from './music';

/**
 * The trailer's edit decision list: the storyboard (shots counted in beats) laid on a frame-exact beat grid and
 * matched to the captured moments. Pure: the same storyboard and capture always give the same cuts.
 *
 * - The tempo snaps to a whole number of frames per beat (30 fps: 120, 128.57 or 138.46 BPM), so every cut lands on
 *   a beat exactly.
 * - Each shot shows its moment's wind-up for whole beats and lands the effect's peak on a beat (where a hit-stop
 *   freezes it), then plays on until the cut.
 * - Framing is a 16:9 crop around the subject scaled up by a whole number with nearest neighbour (pixel art stays
 *   crisp). The town is filmed at zoom 1 in 960×720 (its pixels at their own size): wide shows 960×540 of it ×2,
 *   medium ×4, close ×5, extreme ×6. The pet room is filmed at 1920×1080: medium ×2, close ×3.
 */

export const FPS = 30;
/** The trailer's frame. */
export const W = 1920;
export const H = 1080;
/**
 * Each recording's frame size (its pixels), the 16:9 frame a wide shot takes from it, and its pace: the town is
 * filmed with its clock at half speed (trailer.demo.ts), so its footage plays back twice as fast.
 */
export const SOURCES = {
  town: { file: 'capture-town.mp4', w: 960, h: 720, frameW: 960, frameH: 540, pace: 2 },
  pet: { file: 'capture-pet.mp4', w: 1920, h: 1080, frameW: 1920, frameH: 1080, pace: 1 },
} as const;
export type Source = keyof typeof SOURCES;

export type Framing = 'wide' | 'medium' | 'close' | 'extreme';

export interface StoryShot {
  moment: string;
  beats: number;
  framing: Framing;
  speed?: number;
  freeze_frames?: number;
  transition_in?: 'cut' | 'flash';
  callout?: { text: string; kind: 'big' | 'tag'; at_beat?: number } | null;
}

export interface Storyboard {
  concept?: string;
  bpm: number;
  sections: { name: string; bars: number; mood?: string }[];
  shots: StoryShot[];
  title_intro: string;
  title_tagline: string;
  title_outro: string;
}

export interface ShotPlan {
  index: number;
  shot: StoryShot;
  /** First output frame and length in frames (whole beats). */
  start: number;
  frames: number;
  title?: 'intro' | 'outro';
  /** Source window in capture seconds (before slow motion and the freeze). */
  src?: { start: number; end: number };
  speed: number;
  /** Output frame (within the shot) the freeze starts on, and its length. */
  freezeAt: number;
  freezeFrames: number;
  /** Which recording, and the crop in its pixels (scaled up `k` times to the trailer's frame), maybe panning. */
  source: Source;
  crop: { x: number; y: number; w: number; h: number; k: number; toX?: number; toY?: number };
  /** Big impacts shake the frame for a few frames after the freeze. */
  shake: boolean;
  flash: boolean;
  callout?: { text: string; kind: 'big' | 'tag'; frame: number };
  /** Output seconds of the moment's peak (for the music's accents), when there is one. */
  peak?: number;
  moment?: Moment;
}

export interface Plan {
  bpm: number;
  framesPerBeat: number;
  beat: number;
  totalFrames: number;
  sections: { name: string; bars: number; mood?: string }[];
  shots: ShotPlan[];
  /** Output seconds where the music lays an extra impact (the hardest hits). */
  accents: number[];
}

/**
 * How a moment plays: seconds of wind-up worth showing before its peak, the peak's delay after the effect starts,
 * and how far above the subject the shot looks (pixels of its recording: tall effects rise above the head).
 */
const TIMING: Record<string, { lead: number; peak: number; lift?: number; big?: boolean }> = {
  establish: { lead: 0, peak: 0 },
  arrive: { lead: 0.4, peak: 0.25, lift: 14 },
  leave: { lead: 0.5, peak: 0.15, lift: 14 },
  spellbook: { lead: 0, peak: 0, lift: 0 },
  cast: { lead: 0.25, peak: 0.25, lift: 10 },
  fireball: { lead: 1.1, peak: 0.05, lift: 14, big: true },
  coffee: { lead: 1.0, peak: 0.05, lift: 34, big: true },
  zap: { lead: 0.5, peak: 0.1, lift: 34, big: true },
  potion: { lead: 0.9, peak: 0.1, lift: 20 },
  fireworks: { lead: 0.6, peak: 0.85, lift: 70 },
  combo: { lead: 0.9, peak: 0.1, lift: 14, big: true },
  shield: { lead: 0.9, peak: 0.05, lift: 14 },
  raid: { lead: 2.2, peak: 0.4, lift: 56, big: true },
  party: { lead: 0.6, peak: 0.6, lift: 0 },
  dm: { lead: 1.0, peak: 0, lift: 10 },
  rune: { lead: 0.4, peak: 0.25, lift: 24 },
  ping: { lead: 0.3, peak: 0.2, lift: 20 },
  pat: { lead: 0.2, peak: 0.25, lift: 60 },
  snack: { lead: 0.2, peak: 0.35, lift: 40 },
  petshow_fire: { lead: 0.2, peak: 0.35, lift: 70 },
  petshow_ice: { lead: 0.2, peak: 0.35, lift: 70 },
  petshow_star: { lead: 0.2, peak: 0.35, lift: 70 },
  petshow_zap: { lead: 0.2, peak: 0.35, lift: 70 },
  hatch: { lead: 1.0, peak: 0.0, lift: 50, big: true },
  reply: { lead: 0.4, peak: 0.25, lift: -10 },
  quest: { lead: 0.2, peak: 0.45, lift: 0 },
};

/** How many times smaller than a wide frame each framing's crop is (a town pixel ends up 2× this; a pet-room one 1×). */
const ZOOM: Record<Source, Record<Framing, number>> = {
  town: { wide: 1, medium: 2, close: 2.5, extreme: 3 },
  pet: { wide: 2, medium: 2, close: 3, extreme: 3 },
};

/** Frames per beat nearest the storyboard's tempo. */
export function snapTempo(bpm: number): { bpm: number; framesPerBeat: number } {
  const framesPerBeat = Math.max(10, Math.round((60 * FPS) / bpm));
  return { bpm: (60 * FPS) / framesPerBeat, framesPerBeat };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A 16:9 crop `zoom` times smaller than a wide frame around a point, kept inside the recording; `k` scales it up. */
function cropAround(
  src: Source,
  c: Point,
  zoom: number,
): { x: number; y: number; w: number; h: number; k: number } {
  const { w: sw, h: sh, frameW, frameH } = SOURCES[src];
  const w = Math.round(frameW / zoom);
  const h = Math.round(frameH / zoom);
  return {
    x: Math.round(clamp(c.x - w / 2, 0, sw - w)),
    y: Math.round(clamp(c.y - h / 2, 0, sh - h)),
    w,
    h,
    k: W / w,
  };
}

/**
 * Where a shot looks: the effect above the subject (lifted for tall effects), pulled towards the caster when both
 * fit so the spell's flight is in the frame, but never so far that the effect leaves it.
 */
function aim(m: Moment, zoom: number): Point {
  const t = TIMING[m.name] ?? { lead: 0.5, peak: 0, lift: 14 };
  const lift = t.lift ?? 14;
  const c: Point = { x: m.at.x, y: m.at.y - lift };
  if (!m.from) return c;
  const w = SOURCES[m.source].frameW / zoom;
  const h = SOURCES[m.source].frameH / zoom;
  const dx = m.from.x - m.at.x;
  const dy = m.from.y - m.at.y;
  // Half the way towards the caster, at most a quarter of the frame (the effect stays well inside).
  return {
    x: c.x + Math.sign(dx) * Math.min(Math.abs(dx) / 2, w * 0.25),
    y: c.y + Math.sign(dy) * Math.min(Math.abs(dy) / 2, h * 0.2),
  };
}

export function planTrailer(sb: Storyboard, moments: Moment[], captureSeconds: Record<Source, number>): Plan {
  const { bpm, framesPerBeat } = snapTempo(sb.bpm);
  const beat = framesPerBeat / FPS;
  const sectionBeats = sb.sections.reduce((s, x) => s + x.bars * 4, 0);
  const shotBeats = sb.shots.reduce((s, x) => s + x.beats, 0);
  if (sectionBeats !== shotBeats)
    throw new Error(`storyboard: shots take ${shotBeats} beats but the sections ${sectionBeats}`);

  const used = new Map<string, number>();
  /** The moment's peak in its recording (its effect's start plus the delay to its best frame). */
  const peakOf = (m: Moment): number | undefined =>
    m.impact === undefined ? undefined : m.impact + (TIMING[m.name]?.peak ?? 0) * SOURCES[m.source].pace;
  const take = (name: string): Moment | undefined => {
    // A take whose effect never showed (a cast that did not go through) is left out, and so is one whose peak
    // comes after the next thing on screen (a menu opening over it), unless there is nothing else.
    const needsPeak = (TIMING[name]?.lead ?? 1) > 0;
    const shown = moments.filter((m) => m.name === name && (!needsPeak || m.impact !== undefined));
    const clean = shown.filter((m) => !needsPeak || cleanEnd(m) - peakOf(m)! > 0.4);
    const all = clean.length ? clean : shown;
    if (!all.length) return undefined;
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    return all[n % all.length];
  };

  /**
   * Where a take's footage stops being its own: the next thing that happens on the same screen (a menu opening for
   * the next cast; older captures without `ui` assume the town's menu opens about a second and a half before it).
   */
  const cleanEnd = (m: Moment): number => {
    const after = m.impact ?? m.t;
    let end = Infinity;
    for (const k of moments) {
      if (k === m || k.source !== m.source || k.name === 'cast' || k.name === 'establish') continue;
      const b = k.ui ?? k.t - (k.source === 'town' && k.from ? 1.6 : 0.2);
      if (b > after + 0.2 && b < end) end = b;
    }
    return end;
  };

  const shots: ShotPlan[] = [];
  const accents: number[] = [];
  let frame = 0;
  sb.shots.forEach((shot, index) => {
    const frames = shot.beats * framesPerBeat;
    const start = frame;
    frame += frames;
    const flash = shot.transition_in === 'flash';
    const calloutFrame = Math.min(frames - 1, Math.round((shot.callout?.at_beat ?? 0) * framesPerBeat));
    const callout = shot.callout?.text
      ? { text: shot.callout.text, kind: shot.callout.kind, frame: calloutFrame }
      : undefined;
    const base: ShotPlan = {
      index,
      shot,
      start,
      frames,
      speed: 1,
      freezeAt: 0,
      freezeFrames: 0,
      source: 'town',
      crop: { x: 0, y: 0, w: W, h: H, k: 1 },
      shake: false,
      flash,
      callout,
    };
    if (shot.moment === 'title_intro' || shot.moment === 'title_outro') {
      shots.push({ ...base, title: shot.moment === 'title_intro' ? 'intro' : 'outro' });
      return;
    }
    const m = take(shot.moment);
    if (!m) throw new Error(`storyboard: no captured moment "${shot.moment}"`);
    const t = TIMING[m.name] ?? { lead: 0.5, peak: 0 };
    // The pet room is the messenger around the familiar: never wider than medium, never so close it cuts the spells.
    const zoom = m.name === 'spellbook' ? 2 : (ZOOM[m.source][shot.framing] ?? 2);
    // Seconds of footage per second of trailer: the storyboard's slow motion times the recording's pace.
    const pace = SOURCES[m.source].pace;
    const speed = (shot.speed && shot.speed > 0 && shot.speed < 1 ? shot.speed : 1) * pace;
    const peak = m.impact !== undefined ? m.impact + t.peak * pace : undefined;
    const freezeFrames = peak !== undefined ? Math.max(0, Math.min(8, shot.freeze_frames ?? 0)) : 0;
    const outSeconds = (frames - freezeFrames) / FPS;
    let srcStart: number;
    let freezeAt = 0;
    if (peak !== undefined) {
      // The peak lands on a beat: after enough whole beats of wind-up (at least one when the shot has room)...
      let leadBeats =
        shot.beats >= 2 ? clamp(Math.round((t.lead * pace) / speed / beat + 0.25), 1, shot.beats - 1) : 0;
      // ...and late enough that the shot ends before the next thing on screen begins.
      const afterPeak = (beats: number) => ((shot.beats - beats) * beat - freezeFrames / FPS) * speed;
      const room = cleanEnd(m) - peak;
      while (leadBeats < shot.beats - 1 && afterPeak(leadBeats) > room) leadBeats += 1;
      freezeAt = leadBeats * framesPerBeat;
      srcStart = peak - (freezeAt / FPS) * speed;
    } else {
      srcStart = m.t + 0.2 * pace;
    }
    srcStart = clamp(srcStart, 0, Math.max(0, captureSeconds[m.source] - outSeconds * speed - 0.05));
    const src = { start: srcStart, end: srcStart + outSeconds * speed };
    let crop: ShotPlan['crop'] = cropAround(m.source, aim(m, zoom), zoom);
    if (m.name === 'establish' && zoom > 1) {
      // A slow pan across the office, left to right (a different stretch of it for each take).
      const n = (used.get('establish') ?? 1) - 1;
      const { w: sw, h: sh } = SOURCES[m.source];
      const y = sh * [0.35, 0.6, 0.45, 0.75][n % 4]!;
      const left = cropAround(m.source, { x: sw * 0.25, y }, zoom);
      const right = cropAround(m.source, { x: sw * 0.75, y }, zoom);
      crop = n % 2 ? { ...right, toX: left.x, toY: left.y } : { ...left, toX: right.x, toY: right.y };
    }
    const outPeak = peak !== undefined ? (start + freezeAt) / FPS : undefined;
    if (outPeak !== undefined && freezeFrames >= 3 && (t.big || m.name === 'fireworks'))
      accents.push(outPeak);
    shots.push({
      ...base,
      src,
      speed,
      freezeAt,
      freezeFrames,
      source: m.source,
      crop,
      shake: !!t.big && zoom >= 2 && peak !== undefined,
      peak: outPeak,
      moment: m,
    });
  });
  return { bpm, framesPerBeat, beat, totalFrames: frame, sections: sb.sections, shots, accents };
}

/** Output seconds of each section's first beat (for titles that slam on a drop). */
export function sectionStarts(
  plan: Plan,
): { name: string; kind: ReturnType<typeof sectionKind>; at: number }[] {
  let beats = 0;
  return plan.sections.map((s) => {
    const at = beats * plan.beat;
    beats += s.bars * 4;
    return { name: s.name, kind: sectionKind(s.name, s.mood), at };
  });
}
