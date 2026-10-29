import { writeFileSync } from 'node:fs';

/**
 * Captions for the demo video, timed against the recording clock and burned into a band under the app
 * (ASS subtitles rendered by ffmpeg/libass): who is on screen on the left, what happens next to it.
 */
interface Cue {
  start: number;
  end: number | null;
  speaker: string;
  text: string;
}

export const VIDEO = { width: 1920, height: 1080, appHeight: 1000 } as const;

function assTime(s: number): string {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const escape = (t: string) => t.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')');

export class Captions {
  private readonly cues: Cue[] = [];
  private speaker = '';

  constructor(private readonly now: () => number) {}

  /** Who the viewer is looking at from now on (shown on the left of every caption). */
  as(speaker: string): void {
    this.speaker = speaker;
  }

  /** Shows `text` until the next caption (or `clear`). */
  say(text: string): void {
    const t = this.now();
    this.close(t);
    this.cues.push({ start: t, end: null, speaker: this.speaker, text });
  }

  clear(): void {
    this.close(this.now());
  }

  private close(t: number): void {
    const last = this.cues.at(-1);
    if (last && last.end === null) last.end = t;
  }

  write(file: string, totalSeconds: number): void {
    this.close(totalSeconds);
    const y = VIDEO.appHeight + (VIDEO.height - VIDEO.appHeight) / 2;
    const lines = [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${VIDEO.width}`,
      `PlayResY: ${VIDEO.height}`,
      'WrapStyle: 2',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Caption,Noto Sans CJK KR,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,4,0,0,0,1',
      'Style: Speaker,Noto Sans CJK KR,28,&H00FFD9F2,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,4,0,0,0,1',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];
    for (const c of this.cues) {
      if (c.end === null || c.end - c.start < 0.05) continue;
      const span = `${assTime(c.start)},${assTime(c.end)}`;
      if (c.speaker)
        lines.push(`Dialogue: 0,${span},Speaker,,0,0,0,,{\\an4\\pos(40,${y})}${escape(c.speaker)}`);
      lines.push(
        `Dialogue: 0,${span},Caption,,0,0,0,,{\\an4\\pos(${c.speaker ? 420 : 40},${y})}${escape(c.text)}`,
      );
    }
    writeFileSync(file, `${lines.join('\n')}\n`);
  }
}
