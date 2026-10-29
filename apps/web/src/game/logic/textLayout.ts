/**
 * Grapheme-safe word wrapping and line clamping for speech bubbles (pure; the width function is
 * injected so tests can use a fake monospace measure and the browser a canvas measureText).
 * Text is only split into lines and, when it does not fit, cut at a grapheme boundary with '…'.
 * Nothing is ever added in front of or inside the text.
 */
export type Measure = (text: string) => number;

export const ELLIPSIS = String.fromCharCode(0x2026);

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('ko', { granularity: 'grapheme' })
    : null;

/** User-perceived characters (Hangul syllables, emoji ZWJ sequences and flags stay whole). */
export function graphemes(text: string): string[] {
  if (!segmenter) return Array.from(text);
  const out: string[] = [];
  for (const s of segmenter.segment(text)) out.push(s.segment);
  return out;
}

/** Breaks one over-long token into chunks that each fit `maxWidth` (at least one grapheme each). */
function breakToken(token: string, maxWidth: number, measure: Measure): string[] {
  const out: string[] = [];
  let chunk = '';
  for (const g of graphemes(token)) {
    if (chunk && measure(chunk + g) > maxWidth) {
      out.push(chunk);
      chunk = g;
    } else {
      chunk += g;
    }
  }
  if (chunk) out.push(chunk);
  return out;
}

/**
 * Greedy wrap: explicit newlines are kept, words break at spaces, and words wider than the line
 * break between graphemes. Runs of spaces are drawn as one space.
 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ').filter((w) => w !== '');
    let line = '';
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== '') lines.push(line);
      if (measure(word) <= maxWidth) {
        line = word;
      } else {
        const parts = breakToken(word, maxWidth, measure);
        lines.push(...parts.slice(0, -1));
        line = parts.at(-1) ?? '';
      }
    }
    lines.push(line);
  }
  // Drop trailing empty lines produced by a trailing newline.
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** Keeps at most `maxLines`; the last kept line ends with '…' (grapheme-safe) when text was cut. */
export function clampLines(
  lines: readonly string[],
  maxLines: number,
  maxWidth: number,
  measure: Measure,
): { lines: string[]; truncated: boolean } {
  if (lines.length <= maxLines) return { lines: [...lines], truncated: false };
  const kept = lines.slice(0, Math.max(1, maxLines));
  const lastIndex = kept.length - 1;
  const g = graphemes(kept[lastIndex] ?? '');
  let last = `${g.join('').trimEnd()}${ELLIPSIS}`;
  while (g.length > 0 && measure(last) > maxWidth) {
    g.pop();
    last = `${g.join('').trimEnd()}${ELLIPSIS}`;
  }
  kept[lastIndex] = last;
  return { lines: kept, truncated: true };
}

export interface TextLayout {
  lines: string[];
  truncated: boolean;
  width: number;
}

export function layoutText(
  text: string,
  opts: { maxWidth: number; maxLines: number; measure: Measure },
): TextLayout {
  const wrapped = wrapText(text, opts.maxWidth, opts.measure);
  const { lines, truncated } = clampLines(wrapped, opts.maxLines, opts.maxWidth, opts.measure);
  const width = lines.reduce((w, l) => Math.max(w, opts.measure(l)), 0);
  return { lines, truncated, width: Math.ceil(width) };
}
