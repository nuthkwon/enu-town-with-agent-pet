import { Dir, STEP_MS } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { LocalMover, SETTLE_MS, type Walkable } from './movement';

/** 5x5 room, walls on the border, one pillar at (2,2). */
const grid: Walkable = {
  isWalkable: (x, y) => x >= 1 && y >= 1 && x <= 3 && y <= 3 && !(x === 2 && y === 2),
};

describe('LocalMover: keyboard steps', () => {
  it('steps immediately, predicts the tile and keeps the STEP_MS cadence while held', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.hold(Dir.Right);
    const a = m.update(1000);
    expect(a).toEqual({ kind: 'step', seq: 1, dir: Dir.Right, from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
    expect(m.pos).toEqual({ x: 2, y: 1 });
    expect(m.update(1000 + STEP_MS - 1)).toBeNull();
    const b = m.update(1000 + STEP_MS);
    expect(b).toMatchObject({ kind: 'step', seq: 2, to: { x: 3, y: 1 } });
  });

  it('turns (face) instead of walking into a wall, once', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.hold(Dir.Up);
    expect(m.update(0)).toEqual({ kind: 'face', dir: Dir.Up });
    expect(m.pos).toEqual({ x: 1, y: 1 });
    expect(m.update(STEP_MS)).toBeNull();
    expect(m.update(STEP_MS * 3)).toBeNull();
  });

  it('stops when the key is released', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.hold(Dir.Down);
    expect(m.update(0)?.kind).toBe('step');
    m.hold(null);
    expect(m.update(STEP_MS)).toBeNull();
    expect(m.pos).toEqual({ x: 1, y: 2 });
  });
});

describe('LocalMover: click path', () => {
  it('walks a queued path tile by tile and empties it', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.setPath([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
    ]);
    const seen = [0, 1, 2].map((i) => m.update(i * STEP_MS));
    expect(seen.map((a) => (a?.kind === 'step' ? a.to : null))).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
    ]);
    expect(m.queuedPath).toHaveLength(0);
    expect(m.update(10 * STEP_MS)).toBeNull();
  });

  it('keyboard input cancels the path', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.setPath([{ x: 1, y: 2 }]);
    m.hold(Dir.Right);
    expect(m.queuedPath).toHaveLength(0);
    expect(m.update(0)).toMatchObject({ kind: 'step', dir: Dir.Right });
  });

  it('drops a path that no longer starts next to the avatar', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.setPath([{ x: 3, y: 3 }]);
    expect(m.update(0)).toBeNull();
    expect(m.queuedPath).toHaveLength(0);
  });
});

describe('LocalMover: server authority', () => {
  it("snaps back on 'move:correct' and clears queued steps", () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.setPath([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ]);
    m.update(0);
    expect(m.pos).toEqual({ x: 1, y: 2 });
    m.correct(1, 1, 50);
    expect(m.pos).toEqual({ x: 1, y: 1 });
    expect(m.queuedPath).toHaveLength(0);
  });

  it('ignores lagging server positions while walking, adopts a lasting mismatch when idle', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.hold(Dir.Down);
    m.update(0); // predicted (1,2)
    m.hold(null);
    expect(m.observeServer(1, 1, 50)).toBe(false); // server still behind: in flight
    expect(m.observeServer(1, 2, 120)).toBe(false); // caught up
    expect(m.pos).toEqual({ x: 1, y: 2 });
    // a step got lost: server keeps reporting (1,1) long after we stopped
    const t0 = SETTLE_MS + 10;
    expect(m.observeServer(1, 1, t0)).toBe(false);
    expect(m.observeServer(1, 1, t0 + SETTLE_MS)).toBe(true);
    expect(m.pos).toEqual({ x: 1, y: 1 });
  });

  it('teleport adopts a server relocation and drops queued input', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.setPath([{ x: 1, y: 2 }]);
    m.teleport(3, 3, Dir.Left);
    expect(m.pos).toEqual({ x: 3, y: 3 });
    expect(m.dir).toBe(Dir.Left);
    expect(m.queuedPath).toHaveLength(0);
  });

  it('numbers steps with an increasing seq', () => {
    const m = new LocalMover(grid, { x: 1, y: 1 }, Dir.Down);
    m.hold(Dir.Down);
    const seqs = [0, 1, 2].map((i) => {
      const a = m.update(i * STEP_MS);
      return a?.kind === 'step' ? a.seq : null;
    });
    expect(seqs).toEqual([1, 2, null]); // third step would hit the wall at y=4 -> face/no-op
    expect(m.lastSeq).toBe(2);
  });
});
