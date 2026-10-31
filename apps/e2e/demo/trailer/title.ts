import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FX_CATALOG } from '@enu/fx/catalog';
import {
  AVATAR_FEET_Y,
  AVATAR_FRAME,
  AVATAR_WAND_TIP,
  Canvas,
  PET_FRAME,
  PET_GROUND_Y,
  decodePng,
  renderAvatarFrame,
  renderPetFrame,
  type RGBA,
} from '@enu/sprites';
import { ROOT } from '../../env';
import { gradient, loadFont, renderText } from './pixelfont';

/**
 * The trailer's title cards, drawn like the game itself: a 480×270 pixel scene (×4 on screen) with the real wizard
 * and familiar sprites from @enu/sprites, the baked effect strips from @enu/fx and the logo in Galmuri, slammed in
 * on a beat with a flash and a shake. Frames are piped to ffmpeg as raw pixels and scaled with nearest neighbour.
 */

export const BASE = { w: 480, h: 270 } as const;
const INK: RGBA = [59, 42, 82, 255];
const DEEP: RGBA = [24, 15, 44, 255];

export interface TitleSpec {
  /** Seconds of the clip. */
  seconds: number;
  fps: number;
  /** Seconds per beat (the music's). */
  beat: number;
  /** When the logo lands (seconds into the clip). */
  slamAt: number;
  logo: string;
  subtitle: string;
  /** Typed under the subtitle (the outro's line). */
  tagline?: string;
  /** Fade to black over the last this many seconds. */
  fadeOut?: number;
  /** Everyone casts together after the slam (the outro), instead of one wizard per beat. */
  finale?: boolean;
}

interface Strip {
  frames: Canvas[];
  fps: number;
  pivot: [number, number];
}

const strips = new Map<string, Strip>();
function strip(id: keyof typeof FX_CATALOG, scale: number): Strip {
  const key = `${id}@${scale}`;
  const hit = strips.get(key);
  if (hit) return hit;
  const e = FX_CATALOG[id];
  const file = path.join(ROOT, 'apps/web/public', e.url.split('?')[0]!);
  const sheet = decodePng(readFileSync(file));
  const frames = Array.from({ length: e.frames }, (_, i) => sheet.crop(i * e.w, 0, e.w, e.h).scale(scale));
  const s: Strip = { frames, fps: e.fps, pivot: [e.pivot[0] * scale, e.pivot[1] * scale] };
  strips.set(key, s);
  return s;
}

/** Draws a strip's frame for `t` seconds after it started (nothing before or after it plays). */
function drawStrip(c: Canvas, id: keyof typeof FX_CATALOG, x: number, y: number, t: number, scale = 1): void {
  if (t < 0) return;
  const s = strip(id, scale);
  const i = Math.floor(t * s.fps);
  if (i >= s.frames.length) return;
  c.blit(s.frames[i]!, Math.round(x - s.pivot[0]), Math.round(y - s.pivot[1]));
}

type AvatarPreset = Parameters<typeof renderAvatarFrame>[0];
type PetSpecies = Parameters<typeof renderPetFrame>[0];
type PetTint = NonNullable<Parameters<typeof renderPetFrame>[4]>;

/** A small seeded random source (the same frames every render). */
function rng(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

/** Wizards from the pseudonymous example roster (looks only: no names on the card). */
const CAST: { avatar: AvatarPreset; pet: PetSpecies; tint: PetTint }[] = [
  {
    avatar: {
      body: 'm',
      hair: 'short',
      hairColor: 'black',
      outfit: 'sky',
      skin: 'warm',
      wings: false,
      hat: true,
    },
    pet: 'cat',
    tint: 'base',
  },
  {
    avatar: {
      body: 'f',
      hair: 'long',
      hairColor: 'black',
      outfit: 'lilac',
      skin: 'light',
      wings: false,
      hat: true,
    },
    pet: 'lamb',
    tint: 'lilac',
  },
  {
    avatar: {
      body: 'f',
      hair: 'ponytail',
      hairColor: 'chestnut',
      outfit: 'rose',
      skin: 'light',
      wings: false,
      hat: true,
    },
    pet: 'puppy',
    tint: 'rose',
  },
  {
    avatar: {
      body: 'm',
      hair: 'curly',
      hairColor: 'chestnut',
      outfit: 'mint',
      skin: 'warm',
      wings: false,
      hat: true,
    },
    pet: 'hamster',
    tint: 'base',
  },
  {
    avatar: {
      body: 'f',
      hair: 'bun',
      hairColor: 'brown',
      outfit: 'lemon',
      skin: 'warm',
      wings: false,
      hat: true,
    },
    pet: 'penguin',
    tint: 'sky',
  },
];
/** The wizards stand at twice the scene's pixel size (their pixels are 8 screen px). */
const CAST_SCALE = 2;
const FEET_Y = 252;
const FLOOR_Y = 244;

const avatarFrames = new Map<string, Canvas>();
function avatar(i: number, anim: 'idle' | 'cast', f: number): Canvas {
  const key = `${i}:${anim}:${f}`;
  let c = avatarFrames.get(key);
  if (!c) {
    c = renderAvatarFrame(CAST[i]!.avatar, 'down', anim, f).scale(CAST_SCALE);
    avatarFrames.set(key, c);
  }
  return c;
}
const petFrames = new Map<string, Canvas>();
function pet(i: number, f: number): Canvas {
  const key = `${i}:${f}`;
  let c = petFrames.get(key);
  if (!c) {
    c = renderPetFrame(CAST[i]!.pet, i % 2 ? 'left' : 'right', 'hop', f, CAST[i]!.tint).scale(CAST_SCALE);
    petFrames.set(key, c);
  }
  return c;
}

function sky(c: Canvas, t: number): void {
  const ramp = gradient([16, 10, 34, 255], [38, 26, 66, 255], [70, 48, 104, 255]);
  for (let y = 0; y < BASE.h; y++) {
    const col = ramp(y / BASE.h);
    for (let x = 0; x < BASE.w; x++) c.set(x, y, col);
  }
  const r = rng(7);
  for (let k = 0; k < 90; k++) {
    const x = Math.floor(r() * BASE.w);
    const y = Math.floor(r() * 190);
    const period = 0.8 + r() * 1.6;
    const phase = r();
    const on = (t / period + phase) % 1 < 0.75;
    const big = r() < 0.12;
    const col: RGBA = on ? [255, 246, 214, 255] : [150, 130, 190, 255];
    c.set(x, y, col);
    if (big && on) {
      c.set(x - 1, y, [200, 180, 240, 255]);
      c.set(x + 1, y, [200, 180, 240, 255]);
      c.set(x, y - 1, [200, 180, 240, 255]);
      c.set(x, y + 1, [200, 180, 240, 255]);
    }
  }
}

/** A pixel twinkle: a dot that grows into a four-armed star and back (k = 0..7). */
function sparkle(c: Canvas, x: number, y: number, k: number): void {
  const size = [0, 1, 2, 3, 3, 2, 1, 0][k] ?? -1;
  if (size < 0) return;
  const core: RGBA = [255, 255, 246, 255];
  const arm: RGBA = [255, 232, 150, 255];
  const tip: RGBA = [200, 170, 255, 255];
  c.set(x, y, core);
  for (let d = 1; d <= size; d++) {
    const col = d === size && size > 1 ? tip : arm;
    c.set(x + d, y, col);
    c.set(x - d, y, col);
    c.set(x, y + d, col);
    c.set(x, y - d, col);
  }
  if (size >= 3)
    for (const [dx, dy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const)
      c.set(x + dx, y + dy, arm);
}

function floor(c: Canvas): void {
  const top = FLOOR_Y;
  c.rect(0, top, BASE.w, BASE.h - top, [92, 74, 128, 255]);
  c.hline(0, BASE.w - 1, top, [150, 128, 196, 255]);
  c.hline(0, BASE.w - 1, top + 1, [118, 98, 160, 255]);
  // A carpet runner pattern.
  for (let y = top + 6; y < BASE.h; y += 6)
    for (let x = (y / 6) % 2 ? 0 : 6; x < BASE.w; x += 12) c.rect(x, y, 3, 1, [104, 85, 142, 255]);
}

/** Renders the title clip to `out` (H.264, 1920×1080, `fps`). */
export async function renderTitle(spec: TitleSpec, out: string): Promise<void> {
  const bold = loadFont('Galmuri11-Bold');
  const logoFill = gradient([255, 246, 176, 255], [255, 184, 122, 255], [255, 122, 176, 255]);
  const logoStyle = (scale: number) => ({
    scale,
    fill: logoFill,
    outline: 1,
    ink: INK,
    shadow: { dx: 0, dy: 2, color: DEEP },
    shine: [255, 255, 238, 255] as RGBA,
    tracking: 1,
  });
  // The landing: a few whole-number scales, biggest first.
  const logos = [7, 6, 5, 4].map((k) => renderText(bold, spec.logo, logoStyle(k)));
  const sub = [3, 2].map((k) =>
    renderText(bold, spec.subtitle, {
      scale: k,
      fill: gradient([236, 226, 255, 255], [184, 150, 255, 255]),
      outline: 1,
      ink: INK,
      shadow: { dx: 0, dy: 1, color: DEEP },
      tracking: 1,
    }),
  );
  const frames = Math.round(spec.seconds * spec.fps);
  const ff = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${BASE.w}x${BASE.h}`,
      '-r',
      String(spec.fps),
      '-i',
      '-',
      '-vf',
      'scale=1920:1080:flags=neighbor,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '14',
      '-r',
      String(spec.fps),
      out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise<void>((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  const write = (buf: Uint8Array) =>
    new Promise<void>((resolve) => {
      if (ff.stdin!.write(buf)) resolve();
      else ff.stdin!.once('drain', () => resolve());
    });

  const r = rng(42);
  const sparkles = Array.from({ length: 18 }, () => ({
    x: 60 + r() * 360,
    y: 14 + r() * 150,
    at: r() * 6,
  }));
  const slamFrame = Math.round(spec.slamAt * spec.fps);
  for (let f = 0; f < frames; f++) {
    const t = f / spec.fps;
    const since = t - spec.slamAt;
    const beats = since / spec.beat;
    const c = new Canvas(BASE.w, BASE.h);
    sky(c, t);

    // Fireworks behind the logo: one on each beat after the landing, around the sky.
    if (since >= 0) {
      // Rockets go up from behind the wizards and burst around the logo.
      const spots = [96, 384, 240, 30, 450, 160, 320];
      for (let k = 0; k < spots.length; k++) {
        const at = (spec.finale ? k * 0.5 : k) * spec.beat;
        drawStrip(c, 'spell/fireworks', spots[k]!, FLOOR_Y + (k % 2 ? 6 : -4), since - at, 2);
      }
    }
    floor(c);

    // The wizards: idle, and on the beat one raises the wand (all at once in the finale).
    const n = CAST.length;
    const k2 = CAST_SCALE;
    for (let i = 0; i < n; i++) {
      const x = Math.round(BASE.w / n / 2 + (i * BASE.w) / n) + (i % 2 ? 10 : -10);
      const castStart = spec.finale ? spec.beat * 2 : spec.beat * (1 + i);
      const castT = since - castStart;
      const casting = since >= 0 && castT >= 0 && castT < 0.9;
      const fr = casting
        ? avatar(i, 'cast', Math.min(3, Math.floor(castT * 10)))
        : avatar(i, 'idle', Math.floor(t * 6 + i) % 4);
      // Everyone hops on the downbeat after the landing.
      const hop = since >= 0 && since < 0.25 ? Math.round(6 * Math.sin((since / 0.25) * Math.PI)) : 0;
      const pf = pet(i, Math.floor(t * 12 + i * 2) % 6);
      const px = x + (i % 2 ? -34 : 34);
      c.blit(pf, px - (PET_FRAME * k2) / 2, FEET_Y + 4 - PET_GROUND_Y * k2);
      c.blit(fr, x - (AVATAR_FRAME * k2) / 2, FEET_Y - AVATAR_FEET_Y * k2 - hop);
      if (casting) {
        const tip = AVATAR_WAND_TIP.down;
        drawStrip(c, 'spell/charge', x + tip.x * k2, FEET_Y + tip.y * k2 - hop, castT);
        if (castT > 0.15)
          sparkle(
            c,
            Math.round(x + tip.x * k2),
            Math.round(FEET_Y + tip.y * k2 - hop - 6),
            Math.floor((castT - 0.15) * 16),
          );
      }
    }

    // Sparkles twinkling around the logo after it lands.
    if (since > 0)
      for (const s of sparkles) {
        const local = since - s.at * spec.beat * 0.5;
        if (local >= 0)
          sparkle(c, Math.round(s.x), Math.round(s.y), Math.floor((local % (spec.beat * 3)) * 16));
      }

    // The logo: lands over four frames (biggest first), then bobs a pixel on every beat.
    if (f >= slamFrame) {
      const k = Math.min(logos.length - 1, f - slamFrame);
      const logo = logos[k]!;
      const bob = since > 0.2 && beats % 1 < 0.15 ? -1 : 0;
      c.blit(logo, Math.round((BASE.w - logo.width) / 2), Math.round(64 - logo.height / 2) + bob);
      const subT = since - spec.beat;
      if (subT >= 0) {
        const s = sub[subT < 2 / spec.fps ? 0 : 1]!;
        c.blit(s, Math.round((BASE.w - s.width) / 2), 108);
      }
      if (spec.tagline) {
        const typed = Math.floor(Math.max(0, since - 2 * spec.beat) * 18);
        const text = [...spec.tagline].slice(0, typed).join('');
        if (text) {
          const line = renderText(bold, text, {
            scale: 1,
            fill: () => [255, 246, 214, 255],
            outline: 1,
            ink: DEEP,
            tracking: 1,
          });
          const full = renderText(bold, spec.tagline, {
            scale: 1,
            fill: () => [0, 0, 0, 0],
            outline: 1,
            tracking: 1,
          });
          c.blit(line, Math.round((BASE.w - full.width) / 2), 150);
        }
      }
    } else {
      // Before the landing: sparks gather towards the middle.
      const u = Math.max(0, Math.min(1, 1 - (spec.slamAt - t) / (spec.beat * 4)));
      for (const s of sparkles) {
        const x = 240 + (s.x - 240) * (1 - u * 0.85);
        const y = 64 + (s.y - 64) * (1 - u * 0.85);
        sparkle(c, Math.round(x), Math.round(y), (f + Math.round(s.at * 10)) % 8);
      }
    }

    // The flash and the shake at the landing.
    let shake = { x: 0, y: 0 };
    if (f >= slamFrame && f < slamFrame + 6) {
      const k = f - slamFrame;
      const flash = [0.9, 0.55, 0.25, 0.1, 0, 0][k]!;
      if (flash > 0)
        for (let i = 0; i < c.data.length; i += 4)
          for (let ch = 0; ch < 3; ch++)
            c.data[i + ch] = Math.round(c.data[i + ch]! + (255 - c.data[i + ch]!) * flash);
      shake = { x: [3, -3, 2, -2, 1, 0][k]!, y: [-2, 2, -1, 1, 0, 0][k]! };
    }
    let frame = c;
    if (shake.x || shake.y) {
      frame = new Canvas(BASE.w, BASE.h);
      for (let y = 0; y < BASE.h; y++)
        for (let x = 0; x < BASE.w; x++)
          frame.set(
            x,
            y,
            c.get(
              Math.min(BASE.w - 1, Math.max(0, x - shake.x)),
              Math.min(BASE.h - 1, Math.max(0, y - shake.y)),
            ),
          );
    }
    if (spec.fadeOut && t > spec.seconds - spec.fadeOut) {
      const k = Math.max(0, (spec.seconds - t) / spec.fadeOut);
      const q = Math.round(k * 6) / 6;
      for (let i = 0; i < frame.data.length; i += 4)
        for (let ch = 0; ch < 3; ch++) frame.data[i + ch] = Math.round(frame.data[i + ch]! * q);
    }
    await write(frame.data);
  }
  ff.stdin!.end();
  await done;
}
