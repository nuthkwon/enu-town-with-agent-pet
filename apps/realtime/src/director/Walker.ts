import { findPath, type Point, type WalkGrid } from '@enu/map';
import { STEP_MS } from '@enu/protocol';

/** A* node budget per walk (the 606 map has ~250 walkable tiles; this is a safety cap). */
export const WALK_MAX_NODES = 6000;

/** What `walkTo` did. `teleport`: no path exists, so the caller places the person directly. */
export type WalkStart = 'walk' | 'arrived' | 'teleport';

export interface WalkStep {
  from: Point;
  to: Point;
  /** True on the last tile of the path. */
  arrived: boolean;
}

/**
 * Follows a path one tile per `stepMs` (STEP_MS by default). The director starts it with a
 * `startAtMs` in the future to stagger people who leave together. Pure: time comes from the caller.
 */
export class Walker {
  private path: Point[] = [];
  private nextAt = 0;
  private dest: Point | null = null;
  private readonly stepMs: number;
  private readonly maxNodes: number;

  constructor(
    private readonly grid: WalkGrid,
    opts: { stepMs?: number; maxNodes?: number } = {},
  ) {
    this.stepMs = opts.stepMs ?? STEP_MS;
    this.maxNodes = opts.maxNodes ?? WALK_MAX_NODES;
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  /** The tile the current walk ends on (null when idle). */
  get target(): Point | null {
    return this.walking ? this.dest : null;
  }

  /** Tiles left to walk. */
  get remaining(): number {
    return this.path.length;
  }

  /**
   * Walks from `from` (the current tile) to `to`, first step at `startAtMs`. A new target re-paths from
   * `from`; while already walking the cadence is kept (the next step never comes earlier than planned).
   */
  walkTo(from: Point, to: Point, startAtMs: number): WalkStart {
    if (from.x === to.x && from.y === to.y) {
      this.stop();
      return 'arrived';
    }
    const path = findPath(this.grid, from, to, { maxNodes: this.maxNodes });
    if (!path || path.length === 0) {
      this.stop();
      return 'teleport';
    }
    this.nextAt = this.walking ? Math.max(this.nextAt, startAtMs) : startAtMs;
    this.path = path;
    this.dest = { x: to.x, y: to.y };
    return 'walk';
  }

  stop(): void {
    this.path = [];
    this.dest = null;
  }

  /** Advances at most one tile when its time has come; null when nothing moved. */
  step(nowMs: number, at: Point): WalkStep | null {
    if (this.path.length === 0 || nowMs < this.nextAt) return null;
    const to = this.path.shift() as Point;
    // Keep the average cadence on a coarse timer, but never burst after a stall.
    this.nextAt = Math.max(this.nextAt + this.stepMs, nowMs + this.stepMs / 2);
    const arrived = this.path.length === 0;
    if (arrived) this.dest = null;
    return { from: { x: at.x, y: at.y }, to, arrived };
  }
}
