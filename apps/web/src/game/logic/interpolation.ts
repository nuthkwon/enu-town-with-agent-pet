import { STEP_MS, type Dir } from '@enu/protocol';
import { dirFromDelta } from './direction';
import type { Tile } from './movement';

export interface InterpSample {
  /** Position in tiles (fractional while moving). */
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  /** 0..1 progress through the current one-tile hop (0 when idle). */
  hop: number;
  /** Increments with every hop (drives the alternating walk frames). */
  steps: number;
}

export const TELEPORT_TILES = 3;
/** Queue length at which remote movement plays faster to catch up. */
export const CATCHUP_QUEUE = 2;
export const CATCHUP_FACTOR = 0.6;

/**
 * Smoothly replays tile positions: every new target is walked to over `stepMs` per tile, queued
 * targets chain without pauses, a backlog plays faster, and jumps longer than TELEPORT_TILES snap.
 */
export class TileInterpolator {
  private from: Tile;
  private to: Tile;
  private segStart = 0;
  private segDuration = 0;
  private active = false;
  private lastEnd = Number.NEGATIVE_INFINITY;
  private readonly queue: Tile[] = [];
  private steps = 0;
  dir: Dir;

  constructor(
    x: number,
    y: number,
    dir: Dir,
    private readonly stepMs: number = STEP_MS,
    private readonly teleportTiles: number = TELEPORT_TILES,
  ) {
    this.from = { x, y };
    this.to = { x, y };
    this.dir = dir;
  }

  /** Latest target (end of the queue). */
  get target(): Tile {
    return this.queue.at(-1) ?? this.to;
  }

  get queued(): number {
    return this.queue.length;
  }

  snap(x: number, y: number, dir?: Dir): void {
    this.queue.length = 0;
    this.from = { x, y };
    this.to = { x, y };
    this.active = false;
    if (dir !== undefined) this.dir = dir;
  }

  push(x: number, y: number): void {
    const last = this.target;
    if (last.x === x && last.y === y) return;
    const dist = Math.abs(last.x - x) + Math.abs(last.y - y);
    if (dist > this.teleportTiles) {
      this.snap(x, y);
      return;
    }
    this.queue.push({ x, y });
  }

  private startNext(at: number): boolean {
    const next = this.queue.shift();
    if (!next) return false;
    this.from = this.to;
    this.to = next;
    const dist = Math.abs(next.x - this.from.x) + Math.abs(next.y - this.from.y);
    const factor = this.queue.length >= CATCHUP_QUEUE ? CATCHUP_FACTOR : 1;
    this.segStart = at;
    this.segDuration = Math.max(1, this.stepMs * Math.max(1, dist) * factor);
    this.active = true;
    this.steps += 1;
    const d = dirFromDelta(next.x - this.from.x, next.y - this.from.y);
    if (d !== null) this.dir = d;
    return true;
  }

  update(now: number): InterpSample {
    // Finish segments whose time is up and chain queued ones from their exact end time.
    for (let guard = 0; guard < 16; guard++) {
      if (this.active) {
        const end = this.segStart + this.segDuration;
        if (now < end) break;
        this.active = false;
        this.from = this.to;
        this.lastEnd = end;
        if (!this.startNext(now - end < this.stepMs ? end : now)) break;
      } else if (!this.startNext(now - this.lastEnd < this.stepMs * 0.5 ? this.lastEnd : now)) {
        break;
      }
    }
    if (!this.active) {
      return {
        x: this.to.x,
        y: this.to.y,
        dir: this.dir,
        moving: now - this.lastEnd < this.stepMs * 0.6,
        hop: 0,
        steps: this.steps,
      };
    }
    const t = Math.min(1, Math.max(0, (now - this.segStart) / this.segDuration));
    return {
      x: this.from.x + (this.to.x - this.from.x) * t,
      y: this.from.y + (this.to.y - this.from.y) * t,
      dir: this.dir,
      moving: true,
      hop: t,
      steps: this.steps,
    };
  }
}

/** Vertical hop offset (px, negative = up) for hop progress 0..1. */
export function hopOffset(progress: number, amplitude: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  return -Math.sin(progress * Math.PI) * amplitude;
}
