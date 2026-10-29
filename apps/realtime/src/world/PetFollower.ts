import type { Point, WalkGrid } from '@enu/map';
import { Anim, STEP_MS, type Dir } from '@enu/protocol';
import { RingBuffer } from './RingBuffer';
import { adjacentWalkable, dirBetween, manhattan, samePoint } from './Movement';

/** The synced pet fields the follower drives (a `Pet` schema instance in the room). */
export interface PetBody {
  x: number;
  y: number;
  dir: number;
  anim: number;
}

export const PET_TRAIL_CAPACITY = 8;
export const PET_STEP_MS = Math.round(STEP_MS * 1.1);
/** Faster cadence while the trail is long, so the pet never falls off the ring buffer. */
export const PET_CATCHUP_STEP_MS = Math.round(STEP_MS * 0.9);
export const PET_IDLE_AFTER_MS = 1500;
/** Owner moves farther than this in one update count as a jump (teleport the pet). */
export const PET_JUMP_TILES = 2;
/** Safety net: a pet this far from its owner with nothing to follow is teleported back. */
export const PET_MAX_DRIFT_TILES = 6;

/**
 * Makes a pet trail its owner: the owner's vacated tiles go into a RingBuffer(8) and the pet walks
 * them one tile at a time (~STEP_MS*1.1), ending one tile behind the owner. Pets never block anyone.
 */
export class PetFollower {
  private readonly trail = new RingBuffer<Point>(PET_TRAIL_CAPACITY);
  private lastMoveAt = Number.NEGATIVE_INFINITY;
  private linked: boolean;

  constructor(
    private readonly pet: PetBody,
    private readonly grid: WalkGrid,
    opts: { linked: boolean },
  ) {
    this.linked = opts.linked;
    this.pet.anim = this.restAnim();
  }

  /** Places the pet on a walkable tile next to the owner (behind them when possible). */
  placeNear(owner: Point, ownerDir: Dir, nowMs: number): void {
    this.trail.clear();
    const spot = adjacentWalkable(this.grid, owner, ownerDir) ?? owner;
    this.pet.x = spot.x;
    this.pet.y = spot.y;
    this.pet.dir = ownerDir;
    this.lastMoveAt = nowMs;
  }

  /** Call after every accepted owner move (or server-side relocation). */
  ownerMoved(from: Point, to: Point, ownerDir: Dir, nowMs: number): void {
    if (samePoint(from, to)) return;
    if (manhattan(from, to) > PET_JUMP_TILES) {
      this.placeNear(to, ownerDir, nowMs);
      this.pet.anim = Anim.Walk;
      return;
    }
    this.trail.push({ x: from.x, y: from.y });
  }

  setLinked(linked: boolean): void {
    this.linked = linked;
    if (this.pet.anim !== Anim.Walk) this.pet.anim = this.restAnim();
  }

  get trailLength(): number {
    return this.trail.size;
  }

  /** Advances the pet (called from the room's fixed timestep). */
  update(nowMs: number, owner: Point, ownerDir: Dir): void {
    const interval = this.trail.size >= 3 ? PET_CATCHUP_STEP_MS : PET_STEP_MS;
    if (this.trail.size > 0 && nowMs - this.lastMoveAt >= interval) {
      let next = this.trail.shift();
      while (next && samePoint(next, this.pet)) next = this.trail.shift();
      if (next) {
        const here = { x: this.pet.x, y: this.pet.y };
        if (manhattan(here, next) > PET_JUMP_TILES) {
          // Lost the trail (e.g. it overflowed): rejoin next to the owner.
          this.placeNear(owner, ownerDir, nowMs);
        } else {
          this.pet.dir = dirBetween(here, next, this.pet.dir as Dir);
          this.pet.x = next.x;
          this.pet.y = next.y;
          this.lastMoveAt = nowMs;
        }
        this.pet.anim = Anim.Walk;
        return;
      }
    }
    if (this.trail.size === 0 && manhattan(this.pet, owner) > PET_MAX_DRIFT_TILES) {
      this.placeNear(owner, ownerDir, nowMs);
      this.pet.anim = Anim.Walk;
      return;
    }
    if (nowMs - this.lastMoveAt >= PET_IDLE_AFTER_MS) {
      const rest = this.restAnim();
      if (this.pet.anim !== rest) this.pet.anim = rest;
    }
  }

  private restAnim(): Anim {
    return this.linked ? Anim.Idle : Anim.Sleep;
  }
}
