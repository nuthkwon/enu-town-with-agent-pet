/**
 * The sound CLI (the den-fx skill's sound half). Claude cannot listen, so every render comes with a picture to LOOK
 * at: the waveform, a log-frequency spectrogram with a note grid, the pitch track and the numbers the check uses.
 *
 *   pnpm sfx:list [words]            every sound: id, category, length, one line
 *   pnpm sfx:render <ids|prefix.*|all>  records/sfx/<id>.wav + <id>.png (+ records/sfx/_sheet.png for several)
 *   pnpm sfx:check [ids]             every sound when no id is given; exits 1 on any error
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fxlib } from '@enu/fx';
import {
  CATEGORY_TARGETS,
  RECIPES,
  SFX_IDS,
  checkRecipe,
  encodeWav,
  metrics,
  noteName,
  pitchTrack,
  recipeLength,
  renderRecipe,
  spectrogram,
  type PitchPoint,
  type SfxId,
  type SfxMetrics,
} from '../src/index';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RECORDS_DIR = join(REPO_ROOT, 'records', 'sfx');
const FS = 48_000;

type Canvas = ReturnType<typeof fxlib.canvas>;

const args = process.argv.slice(2);
const cmd = args.shift();
const rel = (p: string) => relative(REPO_ROOT, p);

function resolveIds(patterns: string[]): SfxId[] {
  if (!patterns.length || patterns.includes('all')) return [...SFX_IDS];
  const out = new Set<SfxId>();
  for (const p of patterns) {
    const hits = p.endsWith('*')
      ? SFX_IDS.filter((id) => id.startsWith(p.slice(0, -1)))
      : SFX_IDS.filter((id) => id === p);
    if (!hits.length) throw new Error(`no sound matches "${p}" (try \`pnpm sfx:list\`)`);
    for (const id of hits) out.add(id);
  }
  return [...out];
}

/** Notes the pitch track holds for at least two frames (40 ms), in order, without repeats. */
function noteRuns(track: PitchPoint[]): string[] {
  const out: string[] = [];
  let run = '';
  let len = 0;
  for (const p of track) {
    const n = noteName(p.hz);
    len = n === run ? len + 1 : 1;
    run = n;
    if (len === 2 && out[out.length - 1] !== n) out.push(n);
  }
  return out.slice(0, 14);
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

function summary(id: SfxId, m: SfxMetrics, notes: string[]): string {
  const r = RECIPES[id];
  const t = CATEGORY_TARGETS[r.category];
  return [
    `${m.seconds.toFixed(2)} S`,
    `PEAK ${fmt(m.peakDb)} DBFS`,
    `LUFS ${fmt(m.lufs)} (TARGET ${t.lufs} +-${t.tolerance})`,
    `>10K ${(m.highShare * 100).toFixed(0)}%`,
    `<120 ${(m.lowShare * 100).toFixed(0)}%`,
    `NOTES ${notes.join(' ') || '-'}`,
  ].join('   ');
}

// ---- drawing ------------------------------------------------------------------------------------------------------

const BG = [12, 11, 16, 255];
const PANEL = [22, 20, 30, 255];
const GRID = [52, 46, 68, 255];
const TEXT = [214, 206, 232];
const DIM = [140, 130, 164];
const WARN = [255, 120, 120, 255];
const WAVE = [130, 226, 190, 255];
const PITCH = [255, 255, 255, 255];
/** Ink → lavender → pink → lemon → white (the house ramps). */
const HEAT: [number, number[]][] = [
  [0, [22, 20, 30]],
  [0.3, [59, 42, 82]],
  [0.55, [150, 112, 210]],
  [0.75, [255, 140, 190]],
  [0.9, [255, 228, 120]],
  [1, [255, 255, 255]],
];

function heat(k: number): number[] {
  const v = Math.max(0, Math.min(1, k));
  for (let i = 1; i < HEAT.length; i++) {
    const [k1, c1] = HEAT[i]!;
    const [k0, c0] = HEAT[i - 1]!;
    if (v <= k1) {
      const u = (v - k0) / (k1 - k0);
      return [0, 1, 2].map((j) => Math.round(c0[j]! + (c1[j]! - c0[j]!) * u)).concat(255);
    }
  }
  return [255, 255, 255, 255];
}

const F_MIN = 50;
const F_MAX = 20_000;
const yOfHz = (hz: number, y0: number, h: number) =>
  y0 + h - 1 - Math.round(((Math.log(hz) - Math.log(F_MIN)) / (Math.log(F_MAX) - Math.log(F_MIN))) * (h - 1));

function drawSpectrogram(
  c: Canvas,
  x: Float32Array,
  x0: number,
  y0: number,
  w: number,
  h: number,
  seconds: number,
): void {
  const size = 1024;
  const hop = Math.max(16, Math.ceil(x.length / w));
  const frames = spectrogram(x, size, hop);
  let max = 1e-20;
  for (const f of frames) for (const p of f) max = Math.max(max, p);
  for (let px = 0; px < w; px++) {
    const t = (px / w) * seconds;
    const frame = frames[Math.min(frames.length - 1, Math.round((t * FS) / hop + size / 2 / hop))];
    if (!frame) continue;
    for (let py = 0; py < h; py++) {
      const lo = F_MIN * (F_MAX / F_MIN) ** ((h - 1 - py - 0.5) / (h - 1));
      const hi = F_MIN * (F_MAX / F_MIN) ** ((h - 1 - py + 0.5) / (h - 1));
      const b0 = Math.max(1, Math.floor((lo * size) / FS));
      const b1 = Math.min(size / 2, Math.max(b0, Math.ceil((hi * size) / FS)));
      let p = 0;
      for (let b = b0; b <= b1; b++) p = Math.max(p, frame[b]!);
      const db = 10 * Math.log10(p / max + 1e-20);
      c.rect(x0 + px, y0 + py, 1, 1, heat((db + 90) / 90));
    }
  }
  // note grid (every C) and the check's limits
  for (let oct = 1; oct <= 9; oct++) {
    const hz = 32.703 * 2 ** (oct - 1);
    if (hz < F_MIN || hz > F_MAX) continue;
    const y = yOfHz(hz, y0, h);
    for (let px = 0; px < w; px += 4) c.rect(x0 + px, y, 2, 1, GRID);
    c.text(`C${oct}`, x0 - 22, y - 2, 1, DIM);
  }
  for (const [hz, label] of [
    [10_000, '10K'],
    [120, '120'],
  ] as const) {
    const y = yOfHz(hz, y0, h);
    for (let px = 0; px < w; px += 8) c.rect(x0 + px, y, 4, 1, WARN);
    c.text(label, x0 + w + 4, y - 2, 1, [255, 140, 140]);
  }
}

function drawPitch(
  c: Canvas,
  track: PitchPoint[],
  x0: number,
  y0: number,
  w: number,
  h: number,
  seconds: number,
): void {
  for (const p of track) {
    if (p.hz < F_MIN || p.hz > F_MAX) continue;
    const x = x0 + Math.round((p.t / seconds) * w);
    const y = yOfHz(p.hz, y0, h);
    c.rect(x - 1, y - 1, 3, 3, PITCH);
  }
}

function drawWave(
  c: Canvas,
  x: Float32Array,
  x0: number,
  y0: number,
  w: number,
  h: number,
  ceilingDb: number,
): void {
  c.rect(x0, y0, w, h, PANEL);
  const mid = y0 + Math.floor(h / 2);
  c.rect(x0, mid, w, 1, GRID);
  const ceiling = 10 ** (ceilingDb / 20);
  for (const s of [-1, 1]) {
    const y = mid - Math.round(s * ceiling * (h / 2 - 1));
    for (let px = 0; px < w; px += 6) c.rect(x0 + px, y, 3, 1, WARN);
  }
  const per = x.length / w;
  for (let px = 0; px < w; px++) {
    let lo = 0;
    let hi = 0;
    for (let i = Math.floor(px * per); i < Math.min(x.length, Math.floor((px + 1) * per)); i++) {
      lo = Math.min(lo, x[i]!);
      hi = Math.max(hi, x[i]!);
    }
    const yHi = mid - Math.round(hi * (h / 2 - 1));
    const yLo = mid - Math.round(lo * (h / 2 - 1));
    c.rect(x0 + px, yHi, 1, Math.max(1, yLo - yHi + 1), WAVE);
  }
}

function drawTimeAxis(c: Canvas, x0: number, y: number, w: number, seconds: number): void {
  for (let t = 0; t <= seconds + 1e-9; t += 0.1) {
    const x = x0 + Math.round((t / seconds) * w);
    const major = Math.abs(t * 2 - Math.round(t * 2)) < 1e-6;
    c.rect(x, y, 1, major ? 6 : 3, GRID);
    if (major) c.text(`${t.toFixed(1)}S`, x - 6, y + 8, 1, DIM);
  }
}

function soundPicture(
  id: SfxId,
  x: Float32Array,
  m: SfxMetrics,
  track: PitchPoint[],
  notes: string[],
): Buffer {
  const r = RECIPES[id];
  const W = 1200;
  const H = 560;
  const L = 40;
  const PW = W - L - 40;
  const c = fxlib.canvas(W, H, BG);
  c.text(`${id.toUpperCase()}  (${r.category.toUpperCase()})`, L, 12, 2, TEXT);
  c.text(r.desc.toUpperCase().replace(/[^A-Z0-9 +\-!?.,:/%x*'()<>=_#]/g, ' '), L, 30, 1, DIM);
  drawWave(c, x, L, 48, PW, 110, CATEGORY_TARGETS[r.category].peakDb);
  drawSpectrogram(c, x, L, 170, PW, 320, m.seconds);
  drawPitch(c, track, L, 170, PW, 320, m.seconds);
  drawTimeAxis(c, L, 492, PW, m.seconds);
  c.text(summary(id, m, notes), L, 520, 1, TEXT);
  return c.png();
}

function sheet(items: { id: SfxId; x: Float32Array; m: SfxMetrics; notes: string[] }[]): Buffer {
  const cols = 2;
  const TW = 580;
  const TH = 120;
  const rowH = TH + 34;
  const W = cols * (TW + 40) + 20;
  const H = Math.ceil(items.length / cols) * rowH + 20;
  const c = fxlib.canvas(W, H, BG);
  items.forEach((it, i) => {
    const x0 = 40 + (i % cols) * (TW + 40);
    const y0 = 10 + Math.floor(i / cols) * rowH;
    const t = CATEGORY_TARGETS[RECIPES[it.id].category];
    c.text(`${it.id.toUpperCase()}  ${it.m.seconds.toFixed(2)}S  ${fmt(it.m.lufs)} LUFS`, x0, y0, 1, TEXT);
    c.text(it.notes.slice(0, 8).join(' '), x0 + 300, y0, 1, DIM);
    drawSpectrogram(c, it.x, x0, y0 + 10, TW, TH, t.maxSeconds);
  });
  return c.png();
}

// ---- commands -----------------------------------------------------------------------------------------------------

function list(): void {
  const words = args.map((w) => w.toLowerCase());
  for (const id of SFX_IDS) {
    const r = RECIPES[id];
    const line = `${id.padEnd(16)} ${r.category.padEnd(7)} ${recipeLength(r).toFixed(2)}s  ${r.desc}`;
    if (words.every((w) => line.toLowerCase().includes(w))) console.log(line);
  }
}

function render(): void {
  const ids = resolveIds(args);
  mkdirSync(RECORDS_DIR, { recursive: true });
  const items: { id: SfxId; x: Float32Array; m: SfxMetrics; notes: string[] }[] = [];
  for (const id of ids) {
    const x = renderRecipe(RECIPES[id], FS);
    const m = metrics(x, FS);
    const track = pitchTrack(x, FS);
    const notes = noteRuns(track);
    writeFileSync(join(RECORDS_DIR, `${id}.wav`), encodeWav(x, FS));
    const png = join(RECORDS_DIR, `${id}.png`);
    writeFileSync(png, soundPicture(id, x, m, track, notes));
    items.push({ id, x, m, notes });
    console.log(`${id.padEnd(16)} ${summary(id, m, notes).toLowerCase()}\n${''.padEnd(17)}${rel(png)}`);
  }
  if (items.length > 1) {
    const file = join(RECORDS_DIR, '_sheet.png');
    writeFileSync(file, sheet(items));
    console.log(`\nsheet: ${rel(file)}`);
  }
  console.log(
    '\nOpen the PNGs and LOOK: the contour, the attack, the tail, where the energy sits (den-fx skill §8).',
  );
}

function check(): void {
  const ids = resolveIds(args);
  let bad = 0;
  for (const id of ids) {
    const { errors, metrics: m } = checkRecipe(RECIPES[id]);
    if (errors.length) {
      bad++;
      console.log(`✗ ${id}`);
      for (const e of errors) console.log(`    ${e}`);
    } else
      console.log(
        `✓ ${id.padEnd(16)} ${m.seconds.toFixed(2)} s, ${fmt(m.lufs)} LUFS, peak ${fmt(m.peakDb)} dBFS`,
      );
  }
  console.log(bad ? `\n${bad} of ${ids.length} sounds need work.` : `\nall ${ids.length} sounds pass.`);
  if (bad) process.exitCode = 1;
}

if (cmd === 'list') list();
else if (cmd === 'render') render();
else if (cmd === 'check') check();
else {
  console.log('usage: pnpm sfx <list [words] | render <ids|prefix.*|all> | check [ids]>');
  process.exitCode = cmd ? 1 : 0;
}
