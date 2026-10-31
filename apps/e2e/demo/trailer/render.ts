import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeWav, measureLufs, renderSfx, type SfxId } from '@enu/sfx';
import { Canvas, encodePng } from '@enu/sprites';
import type { Tap } from '../audio';
import { FPS, H, SOURCES, W, sectionStarts, type Plan, type ShotPlan, type Source } from './edit';
import { FS, renderMusic } from './music';
import { gradient, loadFont, renderText } from './pixelfont';
import { renderTitle } from './title';

/**
 * Renders the edit: each shot cut from the capture with ffmpeg (trim, slow motion, hit-stop, whole-number
 * nearest-neighbour crop, shake, white flash, pixel callouts), the title cards, then one track of the synthesized
 * music with 직원07's own sounds moved to where their shots landed, ducked under them and limited.
 */

function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
}

const INK = [59, 42, 82, 255] as const;
const DEEP = [24, 15, 44, 255] as const;

/** A callout's pop: whole-number scales on consecutive frames (small, overshoot, settle). */
const BIG_POP = [4, 10, 9, 8];
const TAG_SCALE = 3;

/** A HUD plate behind a tag: dark, with notched corners and a lavender bar on the left (pixels of `k`). */
function plate(text: Canvas, k: number): Canvas {
  const padX = 4 * k;
  const padY = 2 * k;
  const bar = 2 * k;
  const w = text.width + padX * 2 + bar;
  const h = text.height + padY * 2;
  const c = new Canvas(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edgeX = x < k || x >= w - k;
      const edgeY = y < k || y >= h - k;
      if (edgeX && edgeY) continue;
      c.set(x, y, x < bar ? [155, 109, 255, 255] : [24, 15, 44, 222]);
    }
  c.blit(text, bar + padX, padY);
  return c;
}

interface CalloutArt {
  files: string[];
  sizes: { w: number; h: number }[];
}

function calloutArt(dir: string, id: string, text: string, kind: 'big' | 'tag'): CalloutArt {
  const bold = loadFont('Galmuri11-Bold');
  const scales = kind === 'big' ? BIG_POP : [TAG_SCALE];
  const files: string[] = [];
  const sizes: { w: number; h: number }[] = [];
  scales.forEach((k, i) => {
    const art =
      kind === 'big'
        ? renderText(bold, text, {
            scale: k,
            fill: gradient([255, 252, 214, 255], [255, 214, 102, 255], [255, 150, 84, 255]),
            outline: 1,
            ink: [...INK],
            shadow: { dx: 0, dy: 1, color: [...DEEP] },
            shine: [255, 255, 255, 255],
            tracking: 1,
          })
        : plate(
            renderText(bold, text, {
              scale: k,
              fill: () => [255, 248, 230, 255],
              outline: 0,
              tracking: 1,
            }),
            k,
          );
    const file = path.join(dir, `${id}-${i}.png`);
    writeFileSync(file, encodePng(art));
    files.push(file);
    sizes.push({ w: art.width, h: art.height });
  });
  return { files, sizes };
}

/** One shot of its recording as a 1920×1080 clip of exactly `frames` frames. */
function renderShot(capture: string, s: ShotPlan, dir: string): string {
  const out = path.join(dir, `shot-${String(s.index).padStart(2, '0')}.mp4`);
  const src = s.src!;
  const c = s.crop;
  const chain: string[] = [];
  chain.push(`trim=start=${src.start.toFixed(4)}:end=${(src.end + 0.2).toFixed(4)}`, 'setpts=PTS-STARTPTS');
  if (s.speed !== 1) chain.push(`setpts=PTS/${s.speed}`);
  chain.push(`fps=${FPS}`);
  if (s.freezeFrames > 0)
    chain.push(`loop=loop=${s.freezeFrames}:size=1:start=${s.freezeAt}`, `setpts=N/${FPS}/TB`);
  // The crop: a slow pan when it has an end position; a few frames of shake after a big hit.
  const panX = c.toX !== undefined ? `+(${c.toX - c.x})*n/${s.frames}` : '';
  const panY = c.toY !== undefined ? `+(${c.toY - c.y})*n/${s.frames}` : '';
  let shakeX = '';
  let shakeY = '';
  if (s.shake) {
    const a = s.freezeAt + s.freezeFrames;
    // About 12 px of the trailer's frame, in the recording's pixels.
    const amp = Math.max(1, Math.round(12 / c.k));
    shakeX = `+if(between(n,${a},${a + 7}),${amp}*(${a + 8}-n)/8*(2*mod(n,2)-1),0)`;
    shakeY = `+if(between(n,${a},${a + 7}),${Math.round(amp * 0.6)}*(${a + 8}-n)/8*(1-2*mod(floor(n/2),2)),0)`;
  }
  const maxX = SOURCES[s.source].w - c.w;
  const maxY = SOURCES[s.source].h - c.h;
  chain.push(
    `crop=${c.w}:${c.h}:'clip(${c.x}${panX}${shakeX},0,${maxX})':'clip(${c.y}${panY}${shakeY},0,${maxY})':exact=1`,
    `scale=${W}:${H}:flags=neighbor`,
  );
  if (s.flash) chain.push(`fade=t=in:st=0:d=${(5 / FPS).toFixed(3)}:color=white`);
  chain.push('format=yuv420p', `trim=end_frame=${s.frames}`, 'setpts=N/FRAME_RATE/TB');

  const inputs = ['-i', capture];
  let graph = `[0:v]${chain.join(',')}[v0]`;
  let last = 'v0';
  if (s.callout) {
    const art = calloutArt(dir, `callout-${s.index}`, s.callout.text, s.callout.kind);
    art.files.forEach((f, i) => {
      inputs.push('-i', f);
      const size = art.sizes[i]!;
      const first = s.callout!.frame + i;
      const lastFrame = i === art.files.length - 1 ? s.frames : first;
      const x =
        s.callout!.kind === 'big'
          ? Math.round((W - size.w) / 2)
          : `'min(64, -${size.w}+(n-${first})*${Math.ceil((size.w + 64) / 5)})'`;
      const y = s.callout!.kind === 'big' ? Math.round(H * 0.2 - size.h / 2) : H - 72 - size.h;
      const next = `v${i + 1}`;
      graph += `;[${last}][${i + 1}:v]overlay=x=${x}:y=${y}:eval=frame:enable='between(n,${first},${lastFrame})'[${next}]`;
      last = next;
    });
  }
  ffmpeg([
    ...inputs,
    '-filter_complex',
    graph,
    '-map',
    `[${last}]`,
    '-frames:v',
    String(s.frames),
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '12',
    '-pix_fmt',
    'yuv420p',
    out,
  ]);
  return out;
}

/** Renders every shot and the titles, then joins them (H.264, 30 fps, silent). */
export async function renderPicture(
  plan: Plan,
  captures: Record<Source, string>,
  dir: string,
  texts: { intro: string; subtitle: string; tagline: string; outro: string },
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const starts = sectionStarts(plan);
  for (const s of plan.shots) {
    if (s.title) {
      const out = path.join(dir, `shot-${String(s.index).padStart(2, '0')}.mp4`);
      const shotStart = s.start / FPS;
      const seconds = s.frames / FPS;
      // The logo lands on the first drop (or the outro's downbeat) inside the shot, else one beat in.
      const drop = starts.find(
        (x) =>
          x.at >= shotStart - 1e-6 && x.at < shotStart + seconds && x.kind !== 'intro' && x.kind !== 'build',
      );
      const slamAt = drop ? drop.at - shotStart : Math.min(plan.beat, seconds / 2);
      await renderTitle(
        {
          seconds,
          fps: FPS,
          beat: plan.beat,
          slamAt: Math.max(0, slamAt),
          logo: s.title === 'intro' ? texts.intro : texts.outro,
          subtitle: texts.subtitle,
          tagline: s.title === 'outro' ? texts.tagline : undefined,
          finale: s.title === 'outro',
          fadeOut: s.title === 'outro' ? Math.min(1.2, seconds / 3) : undefined,
        },
        out,
      );
      files.push(out);
      continue;
    }
    files.push(renderShot(captures[s.source], s, dir));
    console.log(`shot ${s.index} ${s.shot.moment} ${s.frames}f crop×${s.crop.k} freeze ${s.freezeFrames}`);
  }
  const list = path.join(dir, 'shots.txt');
  writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
  const joined = path.join(dir, 'picture.mp4');
  ffmpeg([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    `fps=${FPS},format=yuv420p`,
    '-frames:v',
    String(plan.totalFrames),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '16',
    '-movflags',
    '+faststart',
    joined,
  ]);
  return joined;
}

/* ------------------------------------------------------------------ sound */

/** 직원07's sounds that fell inside a shot's window (of the same recording), moved to where that shot plays them. */
export function soundsOnTimeline(plan: Plan, taps: (Tap & { source: Source })[]): Tap[] {
  const out: Tap[] = [];
  for (const s of plan.shots) {
    if (!s.src) continue;
    const shotStart = s.start / FPS;
    const freezeSrc = s.src.start + (s.freezeAt / FPS) * s.speed;
    for (const tap of taps) {
      if (tap.source !== s.source) continue;
      if (tap.t < s.src.start - 0.02 || tap.t >= s.src.end) continue;
      let at = shotStart + (tap.t - s.src.start) / s.speed;
      if (s.freezeFrames && tap.t >= freezeSrc - 0.02) at += s.freezeFrames / FPS;
      if (at < shotStart + s.frames / FPS) out.push({ id: tap.id, t: at });
    }
  }
  return out;
}

/** Peak limiter with a short look-ahead (sample peaks under `ceilingDb`). */
function limit(x: Float32Array, ceilingDb: number): void {
  const ceiling = 10 ** (ceilingDb / 20);
  const look = Math.round(0.004 * FS);
  const rel = Math.exp(-1 / (0.08 * FS));
  const need = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) need[i] = Math.min(1, ceiling / Math.max(1e-9, Math.abs(x[i]!)));
  // The lowest gain needed within the look-ahead, eased back up afterwards.
  const g = new Float32Array(x.length);
  let env = 1;
  for (let i = x.length - 1; i >= 0; i--) {
    let m = need[i]!;
    for (let j = 1; j < look && i + j < x.length; j++) m = Math.min(m, need[i + j]!);
    g[i] = m;
  }
  for (let i = 0; i < x.length; i++) {
    env = g[i]! < env ? g[i]! : rel * env + (1 - rel) * g[i]!;
    x[i] = x[i]! * Math.min(env, g[i]!);
  }
}

/** The trailer's sound: the music under 직원07's sounds (ducked a little under them), around −14 LUFS. */
export function mixTrailer(plan: Plan, sounds: Tap[]): Float32Array {
  const music = renderMusic({
    bpm: plan.bpm,
    sections: plan.sections,
    accents: plan.accents,
    lufs: -16,
  });
  const n = Math.ceil((plan.totalFrames / FPS + 0.2) * FS);
  const fx = new Float32Array(n);
  for (const tap of sounds) {
    const samples = renderSfx(tap.id as SfxId, FS);
    const at = Math.round(tap.t * FS);
    for (let i = 0; i < samples.length && at + i < n; i++) fx[at + i]! += samples[i]!;
  }
  const fxLufs = measureLufs(fx, FS);
  const g = Number.isFinite(fxLufs) ? 10 ** ((-15 - fxLufs) / 20) : 1;
  const out = new Float32Array(n);
  const att = Math.exp(-1 / (0.004 * FS));
  const rel = Math.exp(-1 / (0.25 * FS));
  let env = 0;
  for (let i = 0; i < n; i++) {
    const f = fx[i]! * g;
    const level = Math.abs(f);
    env = level > env ? att * env + (1 - att) * level : rel * env + (1 - rel) * level;
    const duck = 1 - 0.4 * Math.min(1, env / 0.1);
    out[i] = f + (music.samples[i] ?? 0) * duck;
  }
  // The last frames fade (the outro rings out over the logo).
  const fade = Math.round(0.4 * FS);
  for (let i = 0; i < fade; i++) out[n - 1 - i] = out[n - 1 - i]! * (i / fade);
  const lufs = measureLufs(out, FS);
  const k = 10 ** ((-14 - lufs) / 20);
  for (let i = 0; i < n; i++) out[i] = out[i]! * k;
  limit(out, -2.6);
  return out;
}

export function muxTrailer(picture: string, track: Float32Array, dir: string, final: string): string {
  const wav = path.join(dir, 'trailer.wav');
  writeFileSync(wav, encodeWav(track, FS));
  ffmpeg([
    '-i',
    picture,
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
    '256k',
    '-shortest',
    '-movflags',
    '+faststart',
    final,
  ]);
  return final;
}
