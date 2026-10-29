import type { Measure } from './logic/textLayout';

/** Canvas-based text width for a CSS font string (browser only; cached per font). */
const cache = new Map<string, Measure>();

export function canvasMeasure(font: string): Measure {
  const hit = cache.get(font);
  if (hit) return hit;
  const ctx = document.createElement('canvas').getContext('2d');
  const widths = new Map<string, number>();
  const measure: Measure = (text) => {
    if (!ctx) return text.length * 12;
    const w = widths.get(text);
    if (w !== undefined) return w;
    ctx.font = font;
    const m = ctx.measureText(text).width;
    if (widths.size > 2000) widths.clear();
    widths.set(text, m);
    return m;
  };
  cache.set(font, measure);
  return measure;
}
