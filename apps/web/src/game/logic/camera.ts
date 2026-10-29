/** Pure camera maths (integer zoom, clamped/centred scroll, pixel snapping). */

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 6;
/** World pixels we aim to show across the viewport at the chosen zoom (about 20 x 11 tiles). */
export const TARGET_VIEW = { width: 640, height: 352 } as const;

/** Largest integer zoom that still shows about TARGET_VIEW of the office (never below MIN_ZOOM). */
export function chooseZoom(viewW: number, viewH: number, bias = 0): number {
  if (!(viewW > 0) || !(viewH > 0)) return MIN_ZOOM;
  const fit = Math.floor(Math.min(viewW / TARGET_VIEW.width, viewH / TARGET_VIEW.height));
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit + bias));
}

/**
 * Scroll (top-left of the visible world rect, camera origin 0,0) that centres `focus`, clamped to
 * the map; when the map is smaller than the view on an axis it is centred on that axis instead.
 */
export function targetScroll(
  focus: number,
  viewWorld: number,
  mapSize: number,
): number {
  if (mapSize <= viewWorld) return -(viewWorld - mapSize) / 2;
  const s = focus - viewWorld / 2;
  return Math.min(mapSize - viewWorld, Math.max(0, s));
}

/** Frame-rate independent exponential smoothing factor for a lerp per 60 fps frame. */
export function smoothing(lerpPerFrame: number, dtMs: number): number {
  const clamped = Math.min(1, Math.max(0, lerpPerFrame));
  return 1 - Math.pow(1 - clamped, dtMs / (1000 / 60));
}

/** Snaps a world coordinate so it lands on a whole screen pixel at `zoom`. */
export function snapToScreenPixel(value: number, zoom: number): number {
  return Math.round(value * zoom) / zoom;
}
