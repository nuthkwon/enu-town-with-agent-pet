import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Checks a finished demo video before anyone watches it: H.264 1920×1080 with an AAC track, its integrated loudness
 * and true peak (ebur128), and pictures to LOOK at (frames at chosen moments and the waveform), as with effects.
 *
 *   pnpm --filter @enu/e2e exec tsx demo/verify.ts demo-output/enu-den-effects.mp4 [seconds…]
 */

export interface VideoReport {
  seconds: number;
  video: string;
  audio: string;
  lufs: number;
  truePeak: number;
  frames: string[];
  waveform: string;
}

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}

export function verifyVideo(file: string, moments: number[] = []): VideoReport {
  const out = path.join(path.dirname(file), 'verify');
  mkdirSync(out, { recursive: true });
  const probe = JSON.parse(
    run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]),
  ) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      sample_rate?: string;
    }[];
    format: { duration: string };
  };
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const r128 = run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]);
  const summary = r128.slice(r128.lastIndexOf('Summary:'));
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1] ?? NaN);
  const truePeak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1] ?? NaN);
  const frames = moments.map((t, i) => {
    const png = path.join(out, `frame-${String(i).padStart(2, '0')}-${t.toFixed(1)}s.png`);
    run('ffmpeg', [
      '-hide_banner',
      '-y',
      '-ss',
      String(t),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=960:-1',
      png,
    ]);
    return png;
  });
  const waveform = path.join(out, 'waveform.png');
  run('ffmpeg', [
    '-hide_banner',
    '-y',
    '-i',
    file,
    '-filter_complex',
    'aformat=channel_layouts=mono,showwavespic=s=1800x240:colors=0x9b6dff:scale=sqrt',
    '-frames:v',
    '1',
    waveform,
  ]);
  return {
    seconds: Number(probe.format.duration),
    video: v ? `${v.codec_name} ${v.width}x${v.height}` : 'none',
    audio: a ? `${a.codec_name} ${a.sample_rate} Hz` : 'none',
    lufs,
    truePeak,
    frames,
    waveform,
  };
}

if (process.argv[1] && process.argv[1].endsWith('verify.ts')) {
  const [file, ...times] = process.argv.slice(2);
  if (!file) {
    console.log('usage: tsx demo/verify.ts <video.mp4> [seconds…]');
    process.exit(1);
  }
  console.log(JSON.stringify(verifyVideo(file, times.map(Number)), null, 2));
}
