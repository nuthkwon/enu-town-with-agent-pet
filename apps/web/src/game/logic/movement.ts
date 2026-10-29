import { STEP_MS } from '@enu/protocol';
import type { Dir } from '@enu/protocol';
import { dirDelta, dirFromDelta } from './direction';

export interface Tile {
  x: number;
  y: number;
}

/** The part of the collision world movement needs (`OfficeWorld` from @enu/map satisfies it). */
export interface Walkable {
  isWalkable(x: number, y: number): boolean;
}

export type MoverAction =
  | { kind: 'step'; seq: number; dir: Dir; from: Tile; to: Tile }
  | { kind: 'face'; dir: Dir };

/** How long the server may disagree with an idle client before the client adopts its position. */
export const SETTLE_MS = 700;

/**
 * Client-side prediction for the local avatar.
 *
 * Input is either a held direction (keyboard, re-evaluated every step so holding a key keeps
 * walking at the STEP_MS cadence) or a queued path (click/tap A*). Each accepted step moves the
 * predicted tile immediately and yields a `step` {seq, dir} to send. The server is authoritative:
 * `correct()` (from 'move:correct') snaps back and drops queued steps; `observeServer()` adopts
 * the synced position if it still disagrees after the client has been idle for SETTLE_MS.
 */
export class LocalMover {
  pos: Tile;
  dir: Dir;
  private seq = 0;
  private held: Dir | null = null;
  private path: Tile[] = [];
  private nextStepAt = 0;
  private lastStepAt = Number.NEGATIVE_INFINITY;
  private mismatchSince: number | null = null;
  private faceSent: Dir;

  constructor(
    private readonly grid: Walkable,
    start: Tile,
    dir: Dir,
    private readonly stepMs: number = STEP_MS,
  ) {
    this.pos = { x: start.x, y: start.y };
    this.dir = dir;
    this.faceSent = dir;
  }

  get lastSeq(): number {
    return this.seq;
  }

  get queuedPath(): readonly Tile[] {
    return this.path;
  }

  /** Keyboard: the direction currently held (null when released). Cancels any click path. */
  hold(dir: Dir | null): void {
    this.held = dir;
    if (dir !== null) this.path = [];
  }

  get heldDir(): Dir | null {
    return this.held;
  }

  /** Click-to-move: tiles to walk through (excluding the current tile). */
  setPath(path: readonly Tile[]): void {
    this.path = path.map((p) => ({ x: p.x, y: p.y }));
  }

  clearPath(): void {
    this.path = [];
  }

  /** Server-side relocation or (re)spawn: adopt without animation, drop queued input. */
  teleport(x: number, y: number, dir?: Dir): void {
    this.pos = { x, y };
    if (dir !== undefined) {
      this.dir = dir;
      this.faceSent = dir;
    }
    this.path = [];
    this.mismatchSince = null;
  }

  isMoving(now: number): boolean {
    return now - this.lastStepAt < this.stepMs * 1.25;
  }

  /** Call every frame; returns at most one action to send. */
  update(now: number): MoverAction | null {
    if (now < this.nextStepAt) return null;

    let want: Dir | null = null;
    let fromPath = false;
    if (this.held !== null) {
      want = this.held;
    } else if (this.path.length > 0) {
      const next = this.path[0] as Tile;
      const d = dirFromDelta(next.x - this.pos.x, next.y - this.pos.y);
      if (d === null || Math.abs(next.x - this.pos.x) + Math.abs(next.y - this.pos.y) !== 1) {
        // The path no longer starts next to us (corrected or teleported): give up on it.
        this.path = [];
        return null;
      }
      want = d;
      fromPath = true;
    }
    if (want === null) return null;

    const delta = dirDelta(want);
    const to = { x: this.pos.x + delta.dx, y: this.pos.y + delta.dy };
    if (!this.grid.isWalkable(to.x, to.y)) {
      if (fromPath) this.path = [];
      if (this.dir !== want || this.faceSent !== want) {
        this.dir = want;
        this.faceSent = want;
        this.nextStepAt = now + this.stepMs;
        return { kind: 'face', dir: want };
      }
      return null;
    }

    if (fromPath) this.path.shift();
    const from = this.pos;
    this.pos = to;
    this.dir = want;
    this.faceSent = want;
    this.seq += 1;
    // Keep an even cadence while walking continuously; restart the clock after a pause.
    this.nextStepAt = now - this.nextStepAt > this.stepMs ? now + this.stepMs : this.nextStepAt + this.stepMs;
    this.lastStepAt = now;
    this.mismatchSince = null;
    return { kind: 'step', seq: this.seq, dir: want, from, to };
  }

  /** 'move:correct' from the server: snap to its tile and drop everything queued. */
  correct(x: number, y: number, now: number): void {
    this.pos = { x, y };
    this.path = [];
    this.mismatchSince = null;
    this.nextStepAt = Math.max(this.nextStepAt, now + this.stepMs / 2);
  }

  /**
   * Synced position of the local player. While steps are in flight the server lags behind the
   * prediction; once idle for SETTLE_MS a lasting disagreement means a step was lost.
   * Returns true when the predicted tile was replaced by the server's.
   */
  observeServer(x: number, y: number, now: number): boolean {
    if (x === this.pos.x && y === this.pos.y) {
      this.mismatchSince = null;
      return false;
    }
    if (now - this.lastStepAt < SETTLE_MS || this.held !== null || this.path.length > 0) {
      this.mismatchSince = null;
      return false;
    }
    if (this.mismatchSince === null) {
      this.mismatchSince = now;
      return false;
    }
    if (now - this.mismatchSince >= SETTLE_MS) {
      this.pos = { x, y };
      this.mismatchSince = null;
      return true;
    }
    return false;
  }
}
