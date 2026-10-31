import { spawnSync } from 'node:child_process';
import type { Moment } from './moments';

/**
 * Finds the frame an effect really bursts on. The capture logs an impact when the scene's effect counter moves,
 * which polling sees a little late; the picture knows better: around the logged time, the frame that changes most
 * from the one before, in a box around the subject, is the burst. Hit-stops then freeze on the hit itself.
 */

/** Moments whose effect starts with a burst (the others build up and keep their logged time). */
const BURSTS = new Set([
  'fireball',
  'coffee',
  'zap',
  'potion',
  'combo',
  'shield',
  'raid',
  'arrive',
  'leave',
  'ping',
  'rune',
]);

/** The time (seconds) of the frame that changes most inside `box` between `from` and `to`, or null. */
export function sharpestChange(
  file: string,
  box: { x: number; y: number; w: number; h: number },
  from: number,
  to: number,
): number | null {
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-ss',
      from.toFixed(3),
      '-t',
      (to - from).toFixed(3),
      '-i',
      file,
      '-vf',
      `crop=${box.w}:${box.h}:${box.x}:${box.y},tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  let best: number | null = null;
  let bestValue = -1;
  let time = 0;
  for (const line of r.stderr.split('\n')) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) time = Number(pts[1]);
    const avg = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (avg && Number(avg[1]) > bestValue) {
      bestValue = Number(avg[1]);
      best = from + time;
    }
  }
  return bestValue > 0.15 ? best : null;
}

/** Moves each burst's impact to the frame it really lands on (within a fraction of a second of the logged time). */
export function refineImpacts(
  moments: Moment[],
  files: Record<Moment['source'], string>,
  size: Record<Moment['source'], { w: number; h: number; pace: number }>,
): Moment[] {
  return moments.map((m) => {
    if (m.impact === undefined || !BURSTS.has(m.name) || m.source !== 'town') return m;
    const { w: sw, h: sh } = size[m.source];
    const w = 112;
    const h = 96;
    const box = {
      x: Math.round(Math.max(0, Math.min(sw - w, m.at.x - w / 2))),
      y: Math.round(Math.max(0, Math.min(sh - h, m.at.y - h * 0.7))),
      w,
      h,
    };
    // The logged time is late by one poll or two (real time); the burst itself unfolds at the recording's pace.
    const pace = size[m.source].pace;
    const t = sharpestChange(files[m.source], box, Math.max(0, m.impact - 0.4), m.impact + 0.25 * pace);
    return t === null ? m : { ...m, impact: t };
  });
}

/** The sound each pet-room moment makes when its effect starts (the page plays both together). */
const PET_SOUND: Record<string, string> = {
  pat: 'pet.pat',
  snack: 'pet.munch',
  petshow_fire: 'pet.spell',
  petshow_ice: 'pet.spell',
  petshow_star: 'pet.spell',
  petshow_zap: 'pet.spell',
  quest: 'quest.done',
  reply: 'pet.reply',
  hatch: 'pet.hatch',
};

/**
 * In the pet room the effects are CSS (no counters to read), but each starts with its sound: the first matching
 * sound after the click is the impact (a quest, for one, lands only when the server has saved it).
 */
export function impactsFromSounds(
  moments: Moment[],
  taps: { id: string; t: number; source: string }[],
): Moment[] {
  return moments.map((m) => {
    const id = PET_SOUND[m.name];
    if (m.source !== 'pet' || !id) return m;
    const tap = taps.find((x) => x.source === 'pet' && x.id === id && x.t >= m.t - 0.15 && x.t <= m.t + 4);
    return tap ? { ...m, impact: tap.t } : m;
  });
}
