import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../../env';
import type { Tap } from '../audio';
import { verifyVideo } from '../verify';
import { impactsFromSounds, refineImpacts } from './analyze';
import { FPS, SOURCES, planTrailer, type Source, type Storyboard } from './edit';
import type { Moment } from './moments';
import { mixTrailer, muxTrailer, renderPicture, soundsOnTimeline } from './render';

/**
 * Edits the gameplay trailer from the capture (demo/trailer.demo.ts) and the storyboard (storyboard.json), then
 * checks it: H.264 + AAC, loudness and true peak, a frame from every shot and the waveform to LOOK at.
 *
 *   pnpm --filter @enu/e2e demo:trailer:edit      → demo-output/trailer/enu-den-trailer.mp4
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(process.env.DEMO_OUT ?? path.join(ROOT, 'demo-output'), 'trailer');

function seconds(file: string): number {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    {
      encoding: 'utf8',
    },
  );
  return Number(r.stdout.trim());
}

const storyboard = JSON.parse(readFileSync(path.join(HERE, 'storyboard.json'), 'utf8')) as Storyboard;
const read = <T>(name: string): T[] => JSON.parse(readFileSync(path.join(DIR, name), 'utf8')) as T[];
const logged = [...read<Moment>('moments-town.json'), ...read<Moment>('moments-pet.json')];
const taps = [
  ...read<Tap & { source: Source }>('taps-town.json'),
  ...read<Tap & { source: Source }>('taps-pet.json'),
];
const captures = {
  town: path.join(DIR, SOURCES.town.file),
  pet: path.join(DIR, SOURCES.pet.file),
};

// Each burst lands on the frame the picture shows it (the logged times come from polling, a little late).
const moments = impactsFromSounds(refineImpacts(logged, captures, SOURCES), taps);
for (const [a, b] of logged.map((m, i) => [m, moments[i]!] as const))
  if (a.impact !== b.impact)
    console.log(`${a.name}: impact ${a.impact?.toFixed(2)} → ${b.impact?.toFixed(2)}`);
const plan = planTrailer(storyboard, moments, { town: seconds(captures.town), pet: seconds(captures.pet) });
writeFileSync(path.join(DIR, 'plan.json'), JSON.stringify(plan, null, 1));
console.log(
  `${plan.shots.length} shots, ${(plan.totalFrames / FPS).toFixed(1)} s at ${plan.bpm.toFixed(2)} BPM (${plan.framesPerBeat} frames a beat)`,
);

const picture = await renderPicture(plan, captures, path.join(DIR, 'shots'), {
  intro: 'ENU DEN',
  subtitle: '마법 사무소',
  tagline: storyboard.title_tagline,
  outro: 'ENU DEN',
});
const sounds = soundsOnTimeline(plan, taps);
const final = muxTrailer(picture, mixTrailer(plan, sounds), DIR, path.join(DIR, 'enu-den-trailer.mp4'));

// A frame from every shot (its peak, or its middle), tiled into contact sheets.
const times = plan.shots.map((s) => (s.peak !== undefined ? s.peak + 0.04 : (s.start + s.frames / 2) / FPS));
const report = verifyVideo(final, times);
for (let i = 0; i * 12 < report.frames.length; i++) {
  const group = report.frames.slice(i * 12, i * 12 + 12);
  const args = group.flatMap((f) => ['-i', f]);
  const filter =
    group.map((_, k) => `[${k}:v]scale=480:-1[s${k}]`).join(';') +
    ';' +
    group.map((_, k) => `[s${k}]`).join('') +
    `xstack=inputs=${group.length}:layout=${Array.from({ length: group.length }, (_, k) => `${(k % 4) * 480}_${Math.floor(k / 4) * 270}`).join('|')}:fill=black`;
  spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...args,
    '-filter_complex',
    filter,
    path.join(DIR, 'verify', `sheet-${i}.png`),
  ]);
}
console.log(
  JSON.stringify({ sounds: sounds.length, report: { ...report, frames: report.frames.length } }, null, 2),
);
