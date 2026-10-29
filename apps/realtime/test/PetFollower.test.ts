import type { WalkGrid } from '@enu/map';
import { Anim, Dir } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { PET_IDLE_AFTER_MS, PET_STEP_MS, PetFollower, type PetBody } from '../src/world/PetFollower';

/** 20x10 open floor with a wall column at x=10 for y>=5. */
const grid: WalkGrid = {
  width: 20,
  height: 10,
  isWalkable: (x, y) => x >= 0 && y >= 0 && x < 20 && y < 10 && !(x === 10 && y >= 5),
};

function setup(linked = true) {
  const pet: PetBody = { x: 0, y: 0, dir: Dir.Down, anim: 0 };
  const f = new PetFollower(pet, grid, { linked });
  return { pet, f };
}

describe('PetFollower', () => {
  it('spawns behind the owner and rests (Idle when linked, Sleep when not)', () => {
    const a = setup(true);
    a.f.placeNear({ x: 5, y: 5 }, Dir.Right, 0);
    expect({ x: a.pet.x, y: a.pet.y }).toEqual({ x: 4, y: 5 });
    a.f.update(PET_IDLE_AFTER_MS + 1, { x: 5, y: 5 }, Dir.Right);
    expect(a.pet.anim).toBe(Anim.Idle);
    const b = setup(false);
    b.f.placeNear({ x: 5, y: 5 }, Dir.Right, 0);
    b.f.update(PET_IDLE_AFTER_MS + 1, { x: 5, y: 5 }, Dir.Right);
    expect(b.pet.anim).toBe(Anim.Sleep);
  });

  it('walks the owner trail with lag and ends one tile behind', () => {
    const { pet, f } = setup();
    let t = 0;
    f.placeNear({ x: 2, y: 2 }, Dir.Right, t);
    expect(pet.x).toBe(1);
    // owner walks right 5 tiles at STEP_MS
    const owner = { x: 2, y: 2 };
    for (let i = 0; i < 5; i++) {
      t += 160;
      const from = { ...owner };
      owner.x += 1;
      f.ownerMoved(from, owner, Dir.Right, t);
      f.update(t, owner, Dir.Right);
      // the pet never overtakes or stands more than a few tiles back
      expect(pet.x).toBeLessThan(owner.x);
      expect(owner.x - pet.x).toBeLessThanOrEqual(3);
    }
    expect(pet.anim).toBe(Anim.Walk);
    for (let i = 0; i < 20; i++) {
      t += 50;
      f.update(t, owner, Dir.Right);
    }
    expect({ x: pet.x, y: pet.y }).toEqual({ x: owner.x - 1, y: owner.y });
    expect(pet.dir).toBe(Dir.Right);
    expect(f.trailLength).toBe(0);
    t += PET_IDLE_AFTER_MS;
    f.update(t, owner, Dir.Right);
    expect(pet.anim).toBe(Anim.Idle);
  });

  it('moves at most one tile per PET_STEP_MS', () => {
    const { pet, f } = setup();
    f.placeNear({ x: 2, y: 2 }, Dir.Right, 0);
    f.ownerMoved({ x: 2, y: 2 }, { x: 3, y: 2 }, Dir.Right, 0);
    f.ownerMoved({ x: 3, y: 2 }, { x: 4, y: 2 }, Dir.Right, 0);
    f.update(PET_STEP_MS, { x: 4, y: 2 }, Dir.Right);
    expect(pet.x).toBe(2);
    f.update(PET_STEP_MS + 10, { x: 4, y: 2 }, Dir.Right);
    expect(pet.x).toBe(2);
    f.update(2 * PET_STEP_MS + 1, { x: 4, y: 2 }, Dir.Right);
    expect(pet.x).toBe(3);
  });

  it('follows turns and sets its facing from its own movement', () => {
    const { pet, f } = setup();
    f.placeNear({ x: 5, y: 2 }, Dir.Down, 0);
    expect({ x: pet.x, y: pet.y }).toEqual({ x: 5, y: 1 });
    f.ownerMoved({ x: 5, y: 2 }, { x: 5, y: 3 }, Dir.Down, 0);
    f.ownerMoved({ x: 5, y: 3 }, { x: 6, y: 3 }, Dir.Right, 0);
    f.update(1000, { x: 6, y: 3 }, Dir.Right);
    expect({ x: pet.x, y: pet.y, dir: pet.dir }).toEqual({ x: 5, y: 2, dir: Dir.Down });
    f.update(2000, { x: 6, y: 3 }, Dir.Right);
    expect({ x: pet.x, y: pet.y, dir: pet.dir }).toEqual({ x: 5, y: 3, dir: Dir.Down });
  });

  it('teleports next to the owner when the owner jumps more than 2 tiles', () => {
    const { pet, f } = setup();
    f.placeNear({ x: 2, y: 2 }, Dir.Right, 0);
    f.ownerMoved({ x: 2, y: 2 }, { x: 15, y: 8 }, Dir.Up, 100);
    expect(Math.abs(pet.x - 15) + Math.abs(pet.y - 8)).toBe(1);
    expect(grid.isWalkable(pet.x, pet.y)).toBe(true);
    expect(f.trailLength).toBe(0);
  });

  it('picks a walkable neighbour when the tile behind is a wall', () => {
    const { pet, f } = setup();
    f.placeNear({ x: 11, y: 6 }, Dir.Right, 0); // behind = (10,6) is a wall
    expect(grid.isWalkable(pet.x, pet.y)).toBe(true);
    expect(Math.abs(pet.x - 11) + Math.abs(pet.y - 6)).toBe(1);
  });

  it('goes back to sleep when the link is lost', () => {
    const { pet, f } = setup(true);
    f.placeNear({ x: 5, y: 5 }, Dir.Down, 0);
    f.update(PET_IDLE_AFTER_MS + 1, { x: 5, y: 5 }, Dir.Down);
    expect(pet.anim).toBe(Anim.Idle);
    f.setLinked(false);
    expect(pet.anim).toBe(Anim.Sleep);
    f.setLinked(true);
    expect(pet.anim).toBe(Anim.Idle);
  });
});
