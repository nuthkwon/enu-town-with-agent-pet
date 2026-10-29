import { describe, expect, it } from 'vitest';
import { MIN_ZOOM, chooseZoom, smoothing, snapToScreenPixel, targetScroll } from './camera';

describe('camera', () => {
  it('chooses an integer zoom of at least 2 that shows about 20x11 tiles', () => {
    expect(chooseZoom(1280, 720)).toBe(2);
    expect(chooseZoom(1920, 1080)).toBe(3);
    expect(chooseZoom(2560, 1440)).toBe(4);
    expect(chooseZoom(390, 844)).toBe(MIN_ZOOM);
    expect(chooseZoom(0, 0)).toBe(MIN_ZOOM);
    expect(chooseZoom(1920, 1080, 1)).toBe(4);
    expect(chooseZoom(1920, 1080, -5)).toBe(MIN_ZOOM);
  });

  it('centres the focus but never scrolls past the map', () => {
    expect(targetScroll(400, 320, 704)).toBe(240);
    expect(targetScroll(10, 320, 704)).toBe(0);
    expect(targetScroll(700, 320, 704)).toBe(384);
  });

  it('centres the map when it is smaller than the view', () => {
    expect(targetScroll(100, 960, 704)).toBe(-128);
  });

  it('smooths frame-rate independently and snaps to screen pixels', () => {
    expect(smoothing(0.1, 1000 / 60)).toBeCloseTo(0.1);
    expect(smoothing(0.1, 2000 / 60)).toBeCloseTo(0.19);
    expect(snapToScreenPixel(10.3, 2)).toBe(10.5);
    expect(snapToScreenPixel(10.2, 3)).toBeCloseTo(10.333, 2);
  });
});
