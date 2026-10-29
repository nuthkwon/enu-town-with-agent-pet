import { Dir } from '@enu/protocol';
import * as source from '@enu/sprites';
import { describe, expect, it } from 'vitest';
import * as spec from '../spriteSpec';
import {
  avatarAnimKey,
  avatarDirection,
  avatarFrames,
  dirFromDelta,
  petDirection,
  petFrames,
  walkFrameIndex,
  walkLift,
} from './direction';

describe('sprite spec copy', () => {
  it('matches @enu/sprites (the source of truth)', () => {
    expect(spec.AVATAR_FRAME).toBe(source.AVATAR_FRAME);
    expect(spec.AVATAR_COLUMNS).toBe(source.AVATAR_COLUMNS);
    expect(spec.AVATAR_DIRECTIONS).toEqual(source.AVATAR_DIRECTIONS);
    expect(spec.AVATAR_ANIMS).toEqual(source.AVATAR_ANIMS);
    expect(spec.AVATAR_ORIGIN).toEqual(source.AVATAR_ORIGIN);
    expect(spec.AVATAR_WALK_LIFT).toEqual(source.AVATAR_WALK_LIFT);
    expect(spec.PET_FRAME).toBe(source.PET_FRAME);
    expect(spec.PET_COLUMNS).toBe(source.PET_COLUMNS);
    expect(spec.PET_DIRECTIONS).toEqual(source.PET_DIRECTIONS);
    expect(spec.PET_ANIMS).toEqual(source.PET_ANIMS);
    expect(spec.PET_ORIGIN).toEqual(source.PET_ORIGIN);
    expect(spec.EFFECT_FRAME).toBe(source.EFFECT_FRAME);
    expect(spec.EFFECT_FRAMES).toEqual(source.EFFECT_FRAMES);
    expect(spec.EFFECT_COLUMNS).toBe(source.EFFECT_COLUMNS);
    expect(spec.EFFECT_ROWS).toBe(source.EFFECT_ROWS);
    expect(spec.EFFECT_ROWS).toBe(3);
    expect(spec.EFFECT_FRAMES).toMatchObject({
      headset: 16,
      focus: 17,
      cup: 18,
      laptop: 19,
      magnifier: 20,
      link: 21,
      clipboard: 22,
      plane: 23,
    });
    expect(spec.SPRITE_PATHS.effects).toBe(source.SPRITE_PATHS.effects);
    expect(spec.SPRITE_PATHS.pet('cat')).toBe(source.SPRITE_PATHS.pet('cat'));
    expect(spec.SPRITE_PATHS.avatarStatic('av-m-short-black-sky-warm')).toBe(
      source.SPRITE_PATHS.avatar('av-m-short-black-sky-warm'),
    );
  });
});

describe('direction <-> sprite rows', () => {
  it('maps Dir codes to sheet rows down/left/right/up', () => {
    expect(avatarDirection(Dir.Down)).toBe('down');
    expect(avatarDirection(Dir.Left)).toBe('left');
    expect(avatarDirection(Dir.Right)).toBe('right');
    expect(avatarDirection(Dir.Up)).toBe('up');
    expect(avatarDirection(99)).toBe('down');
  });

  it('computes avatar frame ranges per row', () => {
    expect(avatarFrames(Dir.Down, 'idle')).toEqual({ start: 0, end: 3 });
    expect(avatarFrames(Dir.Down, 'walk')).toEqual({ start: 4, end: 9 });
    expect(avatarFrames(Dir.Left, 'idle')).toEqual({ start: 10, end: 13 });
    expect(avatarFrames(Dir.Up, 'walk')).toEqual({ start: 34, end: 39 });
  });

  it('computes pet frame ranges for left/right rows', () => {
    expect(petFrames('left', 'idle')).toEqual({ start: 0, end: 3 });
    expect(petFrames('left', 'hop')).toEqual({ start: 4, end: 9 });
    expect(petFrames('right', 'sleep')).toEqual({ start: 22, end: 23 });
  });

  it('keeps the last horizontal facing for pets moving vertically', () => {
    expect(petDirection(Dir.Left, 'right')).toBe('left');
    expect(petDirection(Dir.Right, 'left')).toBe('right');
    expect(petDirection(Dir.Up, 'left')).toBe('left');
    expect(petDirection(Dir.Down, 'right')).toBe('right');
  });

  it('derives a direction from a tile delta', () => {
    expect(dirFromDelta(1, 0)).toBe(Dir.Right);
    expect(dirFromDelta(-1, 0)).toBe(Dir.Left);
    expect(dirFromDelta(0, 1)).toBe(Dir.Down);
    expect(dirFromDelta(0, -2)).toBe(Dir.Up);
    expect(dirFromDelta(0, 0)).toBeNull();
  });

  it('builds per-sheet animation keys', () => {
    expect(avatarAnimKey('av:x', Dir.Right, 'idle')).toBe('av:x:idle:right');
  });
});

describe('hop walk frames', () => {
  it('plays one half of the hop cycle per tile, alternating halves', () => {
    expect([0, 0.34, 0.7].map((h) => walkFrameIndex(h, 1))).toEqual([3, 4, 5]);
    expect([0, 0.34, 0.7].map((h) => walkFrameIndex(h, 2))).toEqual([0, 1, 2]);
    expect(walkFrameIndex(1, 2)).toBe(2);
  });

  it('lifts the body only on airborne frames', () => {
    expect([0, 1, 2, 3, 4, 5].map(walkLift)).toEqual([0, 0, 4, 0, 0, 4]);
  });
});
