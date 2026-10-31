import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Canvas, type RGBA } from '@enu/sprites';

/**
 * Galmuri (OFL, the town's own pixel font) read from its BDF bitmaps, so the trailer's words are drawn pixel by
 * pixel like the rest of the art: no anti-aliasing, a hard ink outline and a drop shadow, at whole-number scales.
 */

interface Glyph {
  w: number;
  h: number;
  xoff: number;
  yoff: number;
  advance: number;
  rows: number[];
}

export interface PixelFont {
  ascent: number;
  descent: number;
  glyphs: Map<number, Glyph>;
}

const fonts = new Map<string, PixelFont>();

/** `Galmuri11-Bold`, `Galmuri11`, `Galmuri14`… from the galmuri package the web app ships. */
export function loadFont(name: string): PixelFont {
  const cached = fonts.get(name);
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const pkg = require.resolve('galmuri/package.json');
  const text = readFileSync(path.join(path.dirname(pkg), 'dist', `${name}.bdf`), 'utf8');
  const font: PixelFont = { ascent: 0, descent: 0, glyphs: new Map() };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('FONT_ASCENT ')) font.ascent = Number(line.slice(12));
    else if (line.startsWith('FONT_DESCENT ')) font.descent = Number(line.slice(13));
    else if (line.startsWith('ENCODING ')) {
      const code = Number(line.slice(9));
      let advance = 0;
      let bbx = [0, 0, 0, 0];
      let j = i + 1;
      for (; j < lines.length && lines[j] !== 'BITMAP'; j++) {
        const l = lines[j]!;
        if (l.startsWith('DWIDTH ')) advance = Number(l.split(' ')[1]);
        else if (l.startsWith('BBX ')) bbx = l.split(' ').slice(1).map(Number);
      }
      const rows: number[] = [];
      for (j += 1; j < lines.length && lines[j] !== 'ENDCHAR'; j++) rows.push(parseInt(lines[j]!, 16));
      const [w, h, xoff, yoff] = bbx as [number, number, number, number];
      // Each row is ceil(w / 8) bytes, left-aligned: pixel x is bit (bytes * 8 - 1 - x).
      font.glyphs.set(code, { w, h, xoff, yoff, advance, rows });
      i = j;
    }
  }
  fonts.set(name, font);
  return font;
}

/** The text as a 1-bit mask (1 = ink), one font pixel per cell; `tracking` adds space between letters. */
export function textMask(
  font: PixelFont,
  text: string,
  tracking = 0,
): { w: number; h: number; bits: Uint8Array } {
  const chars = [...text].map((c) => font.glyphs.get(c.codePointAt(0)!) ?? font.glyphs.get(0x3f)!);
  const w = Math.max(
    1,
    chars.reduce((sum, g) => sum + g.advance + tracking, -tracking),
  );
  const h = font.ascent + font.descent;
  const bits = new Uint8Array(w * h);
  let pen = 0;
  for (const g of chars) {
    const bytes = Math.ceil(g.w / 8);
    for (let r = 0; r < g.h; r++) {
      const row = g.rows[r] ?? 0;
      const y = font.ascent - g.yoff - g.h + r;
      for (let c = 0; c < g.w; c++) {
        if (!((row >> (bytes * 8 - 1 - c)) & 1)) continue;
        const x = pen + g.xoff + c;
        if (x >= 0 && x < w && y >= 0 && y < h) bits[y * w + x] = 1;
      }
    }
    pen += g.advance + tracking;
  }
  return { w, h, bits };
}

export interface TextStyle {
  /** Pixels per font pixel. */
  scale: number;
  /** Fill colour by row (0 = top of the ink, 1 = bottom): a vertical gradient. */
  fill: (v: number) => RGBA;
  /** Outline width in font pixels (0 = none) and colour. */
  outline?: number;
  ink?: RGBA;
  /** Drop shadow offset in font pixels and colour. */
  shadow?: { dx: number; dy: number; color: RGBA };
  /** A one-pixel highlight along the top edge of each stroke. */
  shine?: RGBA;
  tracking?: number;
}

/** Draws pixel text into a new canvas (transparent around it). */
export function renderText(font: PixelFont, text: string, style: TextStyle): Canvas {
  const m = textMask(font, text, style.tracking ?? 1);
  const o = style.outline ?? 1;
  const sh = style.shadow;
  const pad = o + (sh ? Math.max(Math.abs(sh.dx), Math.abs(sh.dy)) : 0);
  const W = m.w + pad * 2;
  const H = m.h + pad * 2;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < m.w && y < m.h ? m.bits[y * m.w + x]! : 0);
  // The ink and outline masks in font pixels.
  const solid = new Uint8Array(W * H);
  const rim = new Uint8Array(W * H);
  let top = m.h;
  let bottom = 0;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (at(x, y)) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const mx = x - pad;
      const my = y - pad;
      if (at(mx, my)) solid[y * W + x] = 1;
      else if (o > 0) {
        let near = false;
        for (let dy = -o; dy <= o && !near; dy++)
          for (let dx = -o; dx <= o && !near; dx++)
            if (Math.abs(dx) + Math.abs(dy) <= o + (o > 1 ? 1 : 0)) near = !!at(mx + dx, my + dy);
        if (near) rim[y * W + x] = 1;
      }
    }
  const k = style.scale;
  const c = new Canvas(W * k, H * k);
  const paint = (x: number, y: number, col: RGBA) => {
    for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) c.set(x * k + xx, y * k + yy, col);
  };
  if (sh)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const sx = x - sh.dx;
        const sy = y - sh.dy;
        if (sx >= 0 && sy >= 0 && sx < W && sy < H && (solid[sy * W + sx] || rim[sy * W + sx]))
          paint(x, y, sh.color);
      }
  const ink = style.ink ?? [59, 42, 82, 255];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (rim[y * W + x]) paint(x, y, ink);
      if (solid[y * W + x]) {
        const v = bottom > top ? (y - pad - top) / (bottom - top) : 0;
        const lit = style.shine && !at(x - pad, y - pad - 1);
        paint(x, y, lit ? style.shine! : style.fill(v));
      }
    }
  return c;
}

/** Scales a canvas by a whole number with nearest-neighbour sampling. */
export function upscale(src: Canvas, k: number): Canvas {
  const out = new Canvas(src.width * k, src.height * k);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const i = (Math.floor(y / k) * src.width + Math.floor(x / k)) * 4;
      const j = (y * out.width + x) * 4;
      out.data[j] = src.data[i]!;
      out.data[j + 1] = src.data[i + 1]!;
      out.data[j + 2] = src.data[i + 2]!;
      out.data[j + 3] = src.data[i + 3]!;
    }
  return out;
}

/** A vertical two- or three-stop gradient. */
export function gradient(...stops: RGBA[]): (v: number) => RGBA {
  return (v) => {
    const t = Math.min(1, Math.max(0, v)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    const u = t - i;
    // Banded, like a palette ramp: four steps between stops.
    const q = Math.round(u * 4) / 4;
    const a = stops[i]!;
    const b = stops[i + 1]!;
    return [0, 1, 2, 3].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * q)) as unknown as RGBA;
  };
}
