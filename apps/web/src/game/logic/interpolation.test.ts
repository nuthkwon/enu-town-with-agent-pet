import { Dir } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { CATCHUP_FACTOR, TELEPORT_TILES, TileInterpolator, hopOffset } from './interpolation';

const STEP = 160;

describe('TileInterpolator', () => {
  it('walks to a new tile over one step and reports hop progress and direction', () => {
    const it0 = new TileInterpolator(2, 2, Dir.Down, STEP);
    it0.push(3, 2);
    const a = it0.update(1000);
    expect(a).toMatchObject({ x: 2, y: 2, moving: true, hop: 0, dir: Dir.Right });
    const mid = it0.update(1080);
    expect(mid.x).toBeCloseTo(2.5);
    expect(mid.hop).toBeCloseTo(0.5);
    const end = it0.update(1160);
    expect(end).toMatchObject({ x: 3, y: 2, hop: 0 });
  });

  it('chains queued tiles without a pause between hops', () => {
    const ip = new TileInterpolator(0, 0, Dir.Down, STEP);
    ip.push(0, 1);
    ip.push(0, 2);
    ip.update(0);
    const s = ip.update(STEP + 40); // 40ms into the second hop
    expect(s.y).toBeCloseTo(1 + 40 / STEP);
    expect(s.moving).toBe(true);
    expect(s.steps).toBe(2);
  });

  it('plays a backlog faster', () => {
    const ip = new TileInterpolator(0, 0, Dir.Down, STEP);
    ip.push(0, 1);
    ip.push(0, 2);
    ip.push(0, 3);
    ip.update(0); // first hop starts with 2 still queued -> catch-up speed
    const s = ip.update(STEP * CATCHUP_FACTOR);
    expect(s.y).toBeCloseTo(1);
  });

  it('snaps on jumps longer than TELEPORT_TILES', () => {
    const ip = new TileInterpolator(0, 0, Dir.Down, STEP);
    ip.push(TELEPORT_TILES + 2, 0);
    expect(ip.update(10)).toMatchObject({ x: TELEPORT_TILES + 2, y: 0, moving: false });
  });

  it('ignores repeated targets and stays idle', () => {
    const ip = new TileInterpolator(4, 4, Dir.Up, STEP);
    ip.push(4, 4);
    expect(ip.update(500)).toMatchObject({ x: 4, y: 4, moving: false, dir: Dir.Up });
  });

  it('snap() drops the queue', () => {
    const ip = new TileInterpolator(0, 0, Dir.Down, STEP);
    ip.push(0, 1);
    ip.push(0, 2);
    ip.snap(5, 5, Dir.Left);
    expect(ip.update(100)).toMatchObject({ x: 5, y: 5, moving: false, dir: Dir.Left });
  });
});

describe('hopOffset', () => {
  it('is an upward arc that lands at both ends', () => {
    expect(hopOffset(0, 3)).toBe(0);
    expect(hopOffset(1, 3)).toBe(0);
    expect(hopOffset(0.5, 3)).toBeCloseTo(-3);
    expect(hopOffset(0.25, 3)).toBeLessThan(0);
  });
});
