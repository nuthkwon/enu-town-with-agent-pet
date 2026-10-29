/** Pixel font used inside the canvas (name tags, bubbles). */
export const PIXEL_FONT_FALLBACK = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
export const PIXEL_FONT_SIZE = 12;

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

/** Waits (bounded) until the pixel font is usable so canvas text does not render in a fallback. */
export async function waitForPixelFont(family: string, timeoutMs = 2500): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const first = family.split(',')[0]?.trim() ?? 'Galmuri11';
  const spec = `${PIXEL_FONT_SIZE}px ${first}`;
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
