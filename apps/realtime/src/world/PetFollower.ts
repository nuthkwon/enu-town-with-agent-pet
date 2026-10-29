import type { Point, WalkGrid } from '@enu/map';
import { Anim, STEP_MS, type Dir } from '@enu/protocol';
import { RingBuffer } from './RingBuffer';
import { adjacentWalkable, dirBetween, manhattan, samePoint, stepTarget } from './Movement';

/** The synced pet fields the follower drives (a `Pet` schema instance in the room). */
export interface PetBody {
  x: number;
  y: number;
  dir: number;
  anim: number;
}

/** Where a pet rests while its owner is hidden: the owner's desk surface (pets fly; the tile may be blocked). */
export interface PerchTarget {
  x: number;
  y: number;
  dir: Dir;
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
 * While the owner is hidden the pet flies (straight over desks) to its perch and rests there, so the
 * owner still sees their bubbles; it sleeps while not linked or while the office is closed.
 */
export class PetFollower {
  private readonly trail = new RingBuffer<Point>(PET_TRAIL_CAPACITY);
  private lastMoveAt = Number.NEGATIVE_INFINITY;
  private linked: boolean;
  private asleep = false;
  /** The perch the pet is flying to or resting on (null while following the owner). */
  private perch: PerchTarget | null = null;

  constructor(
    private readonly pet: PetBody,
    private readonly grid: WalkGrid,
    opts: { linked: boolean },
  ) {
    this.linked = opts.linked;
    this.pet.anim = this.restAnim();
  }

  /** Places the pet on a walkable tile next to the owner (behind them when possible) and follows them. */
  placeNear(owner: Point, ownerDir: Dir, nowMs: number): void {
    this.trail.clear();
    this.perch = null;
    const spot = adjacentWalkable(this.grid, owner, ownerDir) ?? owner;
    this.set('x', spot.x);
    this.set('y', spot.y);
    this.set('dir', ownerDir);
    this.lastMoveAt = nowMs;
  }

  /** Puts the pet straight onto its perch (room creation and resync). */
  perchAt(p: PerchTarget, nowMs: number): void {
    this.trail.clear();
    this.perch = { ...p };
    this.set('x', p.x);
    this.set('y', p.y);
    this.set('dir', p.dir);
    this.set('anim', this.restAnim());
    this.lastMoveAt = nowMs - PET_IDLE_AFTER_MS;
  }

  /** Call after every owner move (the director's walker). */
  ownerMoved(from: Point, to: Point, ownerDir: Dir, nowMs: number): void {
    if (samePoint(from, to)) return;
    if (manhattan(from, to) > PET_JUMP_TILES) {
      this.placeNear(to, ownerDir, nowMs);
      this.set('anim', Anim.Walk);
      return;
    }
    this.trail.push({ x: from.x, y: from.y });
  }

  setLinked(linked: boolean): void {
    this.linked = linked;
    if (this.pet.anim !== Anim.Walk) this.set('anim', this.restAnim());
  }

  /** Office closed: every pet sleeps (at its perch). */
  setAsleep(asleep: boolean): void {
    this.asleep = asleep;
    if (this.pet.anim !== Anim.Walk) this.set('anim', this.restAnim());
  }

  get trailLength(): number {
    return this.trail.size;
  }

  get perching(): boolean {
    return this.perch !== null;
  }

  /**
   * Advances the pet (called from the room's fixed timestep). With `perch` (the owner is hidden) the
   * pet flies to it one tile per PET_STEP_MS and rests there; otherwise it follows the owner's trail.
   */
  update(nowMs: number, owner: Point, ownerDir: Dir, perch: PerchTarget | null = null): void {
    if (perch) {
      this.flyTo(perch, nowMs);
      return;
    }
    if (this.perch) {
      // Back from the perch without a placement (should not happen): rejoin the owner.
      this.placeNear(owner, ownerDir, nowMs);
      this.set('anim', Anim.Walk);
      return;
    }
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
          this.set('dir', dirBetween(here, next, this.pet.dir as Dir));
          this.set('x', next.x);
          this.set('y', next.y);
          this.lastMoveAt = nowMs;
        }
        this.set('anim', Anim.Walk);
        return;
      }
    }
    if (this.trail.size === 0 && manhattan(this.pet, owner) > PET_MAX_DRIFT_TILES) {
      this.placeNear(owner, ownerDir, nowMs);
      this.set('anim', Anim.Walk);
      return;
    }
    if (nowMs - this.lastMoveAt >= PET_IDLE_AFTER_MS) this.set('anim', this.restAnim());
  }

  private flyTo(perch: PerchTarget, nowMs: number): void {
    if (!this.perch || !samePoint(this.perch, perch) || this.perch.dir !== perch.dir) {
      this.perch = { ...perch };
      this.trail.clear();
    }
    const here = { x: this.pet.x, y: this.pet.y };
    if (samePoint(here, perch)) {
      this.set('dir', perch.dir);
      if (nowMs - this.lastMoveAt >= PET_IDLE_AFTER_MS) this.set('anim', this.restAnim());
      return;
    }
    if (nowMs - this.lastMoveAt < PET_STEP_MS) return;
    const dir = dirBetween(here, perch, this.pet.dir as Dir);
    const next = stepTarget(here, dir);
    this.set('dir', dir);
    this.set('x', next.x);
    this.set('y', next.y);
    this.set('anim', Anim.Walk);
    this.lastMoveAt = nowMs;
  }

  /** Writes only real changes, so an idle pet produces no state patches. */
  private set<K extends keyof PetBody>(key: K, value: PetBody[K]): void {
    if (this.pet[key] !== value) this.pet[key] = value;
  }

  private restAnim(): Anim {
    return this.linked && !this.asleep ? Anim.Idle : Anim.Sleep;
  }
}
