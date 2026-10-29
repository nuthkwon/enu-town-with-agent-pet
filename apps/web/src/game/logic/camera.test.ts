import { describe, expect, it } from 'vitest';
import {
  OVERVIEW_RECT,
  RAIL_PX,
  TOP_BAR_PX,
  canPan,
  clampFocus,
  fitZoom,
  freeArea,
  overviewFocus,
  panBy,
  screenToWorld,
  snapToScreenPixel,
  stepZoom,
  worldToScreen,
  zoomAround,
  zoomLevels,
} from './camera';

const MAP = { w: 704, h: 736 };

describe('fitZoom', () => {
  it('picks the largest listed zoom that shows the overview rect in the free area (spec §5.2)', () => {
    expect(fitZoom(1600, 894)).toBe(1.5);
    expect(fitZoom(1120, 844)).toBe(1);
    expect(fitZoom(2240, 1360)).toBe(2);
    expect(fitZoom(1366, 712)).toBe(1);
  });

  it('never goes below 1 and never above 4', () => {
    expect(fitZoom(300, 200)).toBe(1);
    expect(fitZoom(0, 0)).toBe(1);
    expect(fitZoom(10_000, 10_000)).toBe(4);
  });

  it('takes the free area: the canvas minus the top bar and the docked rail', () => {
    const maximized1080p = freeArea(1920, 950, { top: TOP_BAR_PX, right: RAIL_PX, bottom: 0, left: 0 });
    expect(maximized1080p).toEqual({ x: 0, y: 56, w: 1600, h: 894 });
    expect(fitZoom(maximized1080p.w, maximized1080p.h)).toBe(1.5);
    const laptop = freeArea(1440, 900, { top: TOP_BAR_PX, right: RAIL_PX, bottom: 0, left: 0 });
    expect(fitZoom(laptop.w, laptop.h)).toBe(1);
  });
});

describe('zoom steps', () => {
  it('steps through the integer zooms; 1.5 appears only when it is the fit', () => {
    expect(zoomLevels(1.5)).toEqual([1, 1.5, 2, 3, 4]);
    expect(zoomLevels(1)).toEqual([1, 2, 3, 4]);
    expect(zoomLevels(2)).toEqual([1, 2, 3, 4]);
  });

  it('buttons/keys/wheel move one step; 0 resets to the fit; the ends clamp', () => {
    expect(stepZoom(1.5, 1, 1.5)).toBe(2);
    expect(stepZoom(2, -1, 1.5)).toBe(1.5);
    expect(stepZoom(1.5, -1, 1.5)).toBe(1);
    expect(stepZoom(1, 1, 1)).toBe(2);
    expect(stepZoom(4, 1, 1)).toBe(4);
    expect(stepZoom(1, -1, 1)).toBe(1);
    expect(stepZoom(3, 0, 1.5)).toBe(1.5);
    // A stale fractional zoom (the window was resized so the fit changed) still steps sensibly.
    expect(stepZoom(1.5, 1, 2)).toBe(2);
    expect(stepZoom(1.5, -1, 2)).toBe(1);
  });
});

describe('focus, zoom around a point and panning', () => {
  const free = freeArea(1440, 900, { top: TOP_BAR_PX, right: RAIL_PX, bottom: 0, left: 0 });

  it('centres the overview rect in the free area at the fit', () => {
    const f = overviewFocus();
    expect(f).toEqual({ x: 352, y: 416 });
    const topLeft = worldToScreen({ x: OVERVIEW_RECT.x, y: OVERVIEW_RECT.y }, f, 1, free);
    expect(topLeft).toEqual({ x: (1120 - 704) / 2, y: 56 + (844 - 576) / 2 });
  });

  it('keeps the world point under the cursor fixed (cursor-anchored zoom)', () => {
    const cursor = { x: 300, y: 500 };
    const before = screenToWorld(cursor, overviewFocus(), 1, free);
    const focus = zoomAround(overviewFocus(), 1, 2, cursor, free);
    const after = screenToWorld(cursor, focus, 2, free);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // Buttons and keys zoom around the free-area centre: the focus does not move.
    expect(
      zoomAround({ x: 200, y: 300 }, 1, 3, { x: free.x + free.w / 2, y: free.y + free.h / 2 }, free),
    ).toEqual({
      x: 200,
      y: 300,
    });
  });

  it('pans by screen deltas divided by the zoom', () => {
    expect(panBy({ x: 300, y: 400 }, 40, -20, 2)).toEqual({ x: 280, y: 410 });
  });

  it('clamps panning to the map past the fit and recentres at or below the fit', () => {
    expect(canPan(1, 1)).toBe(false);
    expect(canPan(2, 1)).toBe(true);
    expect(clampFocus({ x: -500, y: 9999 }, 1, 1, free, MAP)).toEqual(overviewFocus());
    // zoom 3: the free area spans 1120/3 x 844/3 world px, so the focus stays half a span inside the map.
    const c = clampFocus({ x: -500, y: 9999 }, 3, 1, free, MAP);
    expect(c.x).toBeCloseTo(1120 / 6, 6);
    expect(c.y).toBeCloseTo(736 - 844 / 6, 6);
    // An axis where the map is narrower than the view is centred.
    const wide = freeArea(3000, 900, { top: TOP_BAR_PX, right: 0, bottom: 0, left: 0 });
    expect(clampFocus({ x: 10, y: 300 }, 2, 1, wide, MAP).x).toBe(352);
  });

  it('snaps to whole screen pixels', () => {
    expect(snapToScreenPixel(10.3, 2)).toBe(10.5);
    expect(snapToScreenPixel(10.2, 3)).toBeCloseTo(10.333, 2);
    expect(snapToScreenPixel(10.4, 1.5)).toBeCloseTo(10.6667, 3);
  });
});
