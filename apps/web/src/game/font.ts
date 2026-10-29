/** Pixel font used inside the canvas (name tags, bubbles). */
export const PIXEL_FONT_FALLBACK = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
export const PIXEL_FONT_SIZE = 12;
/**
 * Small crisp pixel font for secondary plate lines (source, time): Galmuri9 is drawn for 10px, so it
 * stays sharp where Galmuri11 at 10-11px would blur. Its @font-face lives in town.module.css.
 */
export const SMALL_PIXEL_FONT = `Galmuri9, ${PIXEL_FONT_FALLBACK}`;
export const SMALL_PIXEL_FONT_SIZE = 10;

/** CSS custom properties the app shell may use to expose its Galmuri font family. */
const FONT_VARIABLES = ['--font-galmuri', '--font-pixel', '--font-galmuri11', '--town-font'];

function firstFamily(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const first = v.split(',')[0]?.trim() ?? '';
  return first ? first : null;
}

/**
 * Finds the Galmuri family name: next/font exposes a generated family through a CSS variable,
 * a plain @font-face uses "Galmuri11". Returns a full font-family list for Phaser Text.
 */
export function resolvePixelFontFamily(): string {
  if (typeof document === 'undefined') return `Galmuri11, ${PIXEL_FONT_FALLBACK}`;
  const styles = [getComputedStyle(document.documentElement), getComputedStyle(document.body)];
  for (const name of FONT_VARIABLES) {
    for (const s of styles) {
      const fam = firstFamily(s.getPropertyValue(name));
      if (fam) return `${fam}, Galmuri11, ${PIXEL_FONT_FALLBACK}`;
    }
  }
  return `Galmuri11, ${PIXEL_FONT_FALLBACK}`;
}

async function loadFace(spec: string, timeoutMs: number): Promise<boolean> {
  try {
    const loaded = await Promise.race([
      document.fonts.load(spec, '가A').then((faces) => faces.length > 0),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    return loaded || document.fonts.check(spec, '가A');
  } catch {
    return false;
  }
}

/**
 * Waits (bounded) until the pixel fonts are usable so canvas text does not render in a fallback: the
 * main family at 12px and the small Galmuri9 at 10px (both in parallel).
 */
export async function waitForPixelFont(family: string, timeoutMs = 2500): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const first = family.split(',')[0]?.trim() ?? 'Galmuri11';
  const [main] = await Promise.all([
    loadFace(`${PIXEL_FONT_SIZE}px ${first}`, timeoutMs),
    loadFace(`${SMALL_PIXEL_FONT_SIZE}px Galmuri9`, timeoutMs),
  ]);
  return main;
}
