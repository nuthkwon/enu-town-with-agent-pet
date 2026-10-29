import type { Template } from '../draw/template';

/**
 * Face edits for the companion expressions, done on the pet templates through the shared keys of
 * `parts/pets.ts` (`w` eye shine, `e` eye, `E` lower eye row, `n` nose or mouth): no species needs its own face art.
 */

const isPixel = (ch: string | undefined): boolean => ch !== undefined && ch !== '.' && ch !== ' ';

/** Pupils glance sideways: every `w`/`e` pair swaps places. */
export function glanceAside(t: Template): Template {
  return t.map((row) => row.replace(/we|ew/g, (pair) => `${pair[1]}${pair[0]}`));
}

/** The key that marks an open mouth (no species uses it as a colour). */
export const MOUTH_KEY = '!';

/**
 * An open mouth: a 2x2 patch at the anchor (the first `n` by default, see `PetArt.mouth`), kept inside the
 * silhouette.
 */
export function openMouth(
  t: Template,
  anchor: { key: string; dx?: number; dy?: number } = { key: 'n' },
): Template {
  const rows = t.map((row) => [...row]);
  const y0 = t.findIndex((row) => row.includes(anchor.key));
  if (y0 < 0) return t;
  const x = t[y0]!.indexOf(anchor.key) + (anchor.dx ?? 0);
  const y = y0 + (anchor.dy ?? 0);
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const r = rows[y + dy];
    if (r && isPixel(r[x + dx])) r[x + dx] = MOUTH_KEY;
  }
  return rows.map((r) => r.join(''));
}
