import { DIR_DELTA, Dir } from '@enu/protocol';
import {
  AVATAR_DIRECTIONS,
  AVATAR_WALK_LIFT,
  avatarAnimFrames,
  petAnimFrames,
  type AvatarAnim,
  type AvatarDirection,
  type PetAnim,
  type PetDirection,
} from '../spriteSpec';

export { Dir };

export function isDir(n: unknown): n is Dir {
  return n === Dir.Down || n === Dir.Left || n === Dir.Right || n === Dir.Up;
}

export function toDir(n: number, fallback: Dir = Dir.Down): Dir {
  return isDir(n) ? n : fallback;
}

/** Dir codes equal sprite rows: 0 down, 1 left, 2 right, 3 up. */
export function avatarDirection(dir: number): AvatarDirection {
  return AVATAR_DIRECTIONS[toDir(dir)];
}

export function dirDelta(dir: number): { dx: number; dy: number } {
  return DIR_DELTA[toDir(dir)];
}

/** Direction of a one-tile (or dominant-axis) move; null when there is no movement. */
export function dirFromDelta(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? Dir.Right : Dir.Left;
  return dy > 0 ? Dir.Down : Dir.Up;
}

/** Animation key for an avatar sheet (one set of anims per sheet key). */
export function avatarAnimKey(sheetKey: string, dir: number, anim: AvatarAnim): string {
  return `${sheetKey}:${anim}:${avatarDirection(dir)}`;
}

export function avatarFrames(dir: number, anim: AvatarAnim): { start: number; end: number } {
  return avatarAnimFrames(avatarDirection(dir), anim);
}

/** Lift (px) of the current walk frame (0..5) for the drop shadow; idle never lifts. */
export function walkLift(frameInCycle: number): number {
  const i = ((Math.floor(frameInCycle) % AVATAR_WALK_LIFT.length) + AVATAR_WALK_LIFT.length) % AVATAR_WALK_LIFT.length;
  return AVATAR_WALK_LIFT[i] ?? 0;
}

/**
 * Pets only have left/right rows. Moving up/down keeps the last horizontal facing so the sprite
 * does not flip back and forth on vertical stretches.
 */
export function petDirection(dir: number, lastHorizontal: PetDirection): PetDirection {
  const d = toDir(dir);
  if (d === Dir.Left) return 'left';
  if (d === Dir.Right) return 'right';
  return lastHorizontal;
}

export function petAnimKey(species: string, dir: PetDirection, anim: PetAnim): string {
  return `pet-${species}:${anim}:${dir}`;
}

export function petFrames(dir: PetDirection, anim: PetAnim): { start: number; end: number } {
  return petAnimFrames(dir, anim);
}

/**
 * Walk frame (0..5 within the hop-walk cycle) for hop progress 0..1. Each tile step plays one
 * half of the cycle (land+squash, take-off+stretch, air), alternating halves on every step so the
 * frame hop and the per-step y tween stay in sync.
 */
export function walkFrameIndex(hop: number, steps: number): number {
  const half = (((Math.floor(steps) % 2) + 2) % 2) * 3;
  const phase = Math.min(2, Math.max(0, Math.floor(hop * 3)));
  return half + phase;
}
