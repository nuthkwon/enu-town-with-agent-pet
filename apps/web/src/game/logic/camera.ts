/**
 * Pure camera maths for the overview map (no Phaser): the overview fit, the zoom list, cursor-anchored
 * zoom, drag panning with clamping, and pixel snapping. The camera never follows anyone by itself.
 *
 * The camera state is (zoom, focus): `focus` is the world point shown at the centre of the free area
 * (the canvas minus the top-bar band and the docked team rail), so resizing keeps what you look at.
 */

/** Zoom levels (spec §5.2). 1.5 is used only when it is the fit. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;
/**
 * Canvases narrower or shorter than the overview at 1 (the messenger's town panel, phones) get a compact fit
 * below 1, in 1/32 steps so a 32 px tile stays a whole number of pixels: the whole office stays in view and
 * the screen-space overlays shrink with it (`overlayScale`).
 */
export const MIN_ZOOM = 0.5;
const COMPACT_STEP = 1 / 32;
export const MAX_ZOOM = 4;
/** Zoom of `이 사람 보기` (at least; never below the fit). */
export const FOCUS_ZOOM = 2;

/** Rows 4–21 of the 22×23 office: rows 0–3 (balcony, window wall) and 22 (entrance wall) hold no spot. */
export const OVERVIEW_RECT = { x: 0, y: 128, w: 704, h: 576 } as const;

/** Screen space the React chrome keeps for itself (spec §5.2). */
export const TOP_BAR_PX = 56;
export const RAIL_PX = 320;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_INSETS: Insets = { top: TOP_BAR_PX, right: 0, bottom: 0, left: 0 };

/** Part of the canvas (CSS px) the map is laid out in. */
export interface FreeArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface MapSize {
  w: number;
  h: number;
}

export function freeArea(viewW: number, viewH: number, insets: Insets = DEFAULT_INSETS): FreeArea {
  const left = Math.max(0, insets.left);
  const top = Math.max(0, insets.top);
  return {
    x: left,
    y: top,
    w: Math.max(1, viewW - left - Math.max(0, insets.right)),
    h: Math.max(1, viewH - top - Math.max(0, insets.bottom)),
  };
}

/** Largest z in ZOOM_STEPS with 704z ≤ freeW ∧ 576z ≤ freeH (never below 1). */
export function fitZoom(freeW: number, freeH: number): number {
  const room = Math.min(freeW / OVERVIEW_RECT.w, freeH / OVERVIEW_RECT.h);
  if (room < 1) return Math.max(MIN_ZOOM, Math.floor(room / COMPACT_STEP) * COMPACT_STEP);
  let best = 1;
  for (const z of ZOOM_STEPS) {
    if (OVERVIEW_RECT.w * z <= freeW && OVERVIEW_RECT.h * z <= freeH) best = z;
  }
  return best;
}

/** Overlays (plates, tags, bubbles) keep their pixel size at 1 and above, and shrink with a compact fit. */
export function overlayScale(zoom: number): number {
  return Math.min(1, zoom);
}

/** The levels the wheel, the ± buttons and the keys step through: the integer steps plus the fit. */
export function zoomLevels(fit: number): number[] {
  const levels = new Set<number>(ZOOM_STEPS.filter((z) => Number.isInteger(z)));
  levels.add(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit)));
  return [...levels].sort((a, b) => a - b);
}

const EPS = 1e-6;

/** Next zoom from `current`, `delta` steps up (+) or down (−) the list; 0 = back to the fit. */
export function stepZoom(current: number, delta: number, fit: number): number {
  const levels = zoomLevels(fit);
  if (delta === 0 || levels.length === 0) return fit;
  if (delta > 0) {
    let i = -1;
    levels.forEach((z, k) => {
      if (z <= current + EPS) i = k;
    });
    return levels[Math.min(levels.length - 1, i + delta)] ?? current;
  }
  let j = levels.length;
  for (let k = levels.length - 1; k >= 0; k--) {
    if ((levels[k] ?? 0) >= current - EPS) j = k;
  }
  return levels[Math.max(0, j + delta)] ?? current;
}

/** World point at the centre of the overview rect (the focus at fit). */
export function overviewFocus(): Point {
  return { x: OVERVIEW_RECT.x + OVERVIEW_RECT.w / 2, y: OVERVIEW_RECT.y + OVERVIEW_RECT.h / 2 };
}

function freeCentre(free: FreeArea): Point {
  return { x: free.x + free.w / 2, y: free.y + free.h / 2 };
}

/** World coordinate shown at the canvas' left/top edge (what Phaser calls scroll at origin 0). */
export function scrollFor(focus: Point, zoom: number, free: FreeArea): Point {
  const c = freeCentre(free);
  return { x: focus.x - c.x / zoom, y: focus.y - c.y / zoom };
}

export function worldToScreen(world: Point, focus: Point, zoom: number, free: FreeArea): Point {
  const s = scrollFor(focus, zoom, free);
  return { x: (world.x - s.x) * zoom, y: (world.y - s.y) * zoom };
}

export function screenToWorld(screen: Point, focus: Point, zoom: number, free: FreeArea): Point {
  const s = scrollFor(focus, zoom, free);
  return { x: s.x + screen.x / zoom, y: s.y + screen.y / zoom };
}

/**
 * New focus after zooming from `fromZoom` to `toZoom` so the world point under `anchor` (canvas px; the
 * cursor for the wheel, the free-area centre for buttons and keys) stays under it.
 */
export function zoomAround(
  focus: Point,
  fromZoom: number,
  toZoom: number,
  anchor: Point,
  free: FreeArea,
): Point {
  const c = freeCentre(free);
  const wx = focus.x + (anchor.x - c.x) / fromZoom;
  const wy = focus.y + (anchor.y - c.y) / fromZoom;
  return { x: wx - (anchor.x - c.x) / toZoom, y: wy - (anchor.y - c.y) / toZoom };
}

/** Focus after dragging the map by (dx, dy) screen px. */
export function panBy(focus: Point, dx: number, dy: number, zoom: number): Point {
  return { x: focus.x - dx / zoom, y: focus.y - dy / zoom };
}

function clampAxis(focus: number, span: number, mapSize: number): number {
  if (span >= mapSize) return mapSize / 2;
  const half = span / 2;
  return Math.min(mapSize - half, Math.max(half, focus));
}

/**
 * Keeps the map in view. At or below the fit the overview rect is centred (nothing to pan); past the fit
 * the free area may not leave the map on an axis where the map is larger than the view, and the map is
 * centred on an axis where it is smaller.
 */
export function clampFocus(focus: Point, zoom: number, fit: number, free: FreeArea, map: MapSize): Point {
  if (zoom <= fit + EPS) return overviewFocus();
  return { x: clampAxis(focus.x, free.w / zoom, map.w), y: clampAxis(focus.y, free.h / zoom, map.h) };
}

/** Panning is offered only when zoomed past the fit. */
export function canPan(zoom: number, fit: number): boolean {
  return zoom > fit + EPS;
}

/** Snaps a world coordinate so it lands on a whole screen pixel at `zoom`. */
export function snapToScreenPixel(value: number, zoom: number): number {
  return Math.round(value * zoom) / zoom;
}
