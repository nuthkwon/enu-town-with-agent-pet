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

  it('perch mode: flies straight to the perch (over walls), one tile per PET_STEP_MS, then rests facing its way', () => {
    const { pet, f } = setup(true);
    f.placeNear({ x: 8, y: 6 }, Dir.Right, 0);
    expect({ x: pet.x, y: pet.y }).toEqual({ x: 7, y: 6 });
    const perch = { x: 10, y: 8, dir: Dir.Up }; // a blocked tile (the wall column): pets fly
    let t = 0;
    const seen: { x: number; y: number }[] = [];
    for (let i = 0; i < 40; i++) {
      t += 50;
      f.update(t, { x: 8, y: 6 }, Dir.Right, perch);
      const last = seen.at(-1);
      if (!last || last.x !== pet.x || last.y !== pet.y) seen.push({ x: pet.x, y: pet.y });
    }
    expect(seen.at(-1)).toEqual({ x: 10, y: 8 });
    // every hop is one tile
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i]!.x - seen[i - 1]!.x) + Math.abs(seen[i]!.y - seen[i - 1]!.y)).toBe(1);
    }
    expect(f.perching).toBe(true);
    expect(pet.dir).toBe(Dir.Up);
    t += PET_IDLE_AFTER_MS;
    f.update(t, { x: 8, y: 6 }, Dir.Right, perch);
    expect(pet.anim).toBe(Anim.Idle);
    // back to the owner: placeNear leaves perch mode
    f.placeNear({ x: 3, y: 3 }, Dir.Down, t);
    expect(f.perching).toBe(false);
    expect(Math.abs(pet.x - 3) + Math.abs(pet.y - 3)).toBe(1);
  });

  it('perchAt snaps onto the perch; setAsleep puts the pet to sleep there (office closed)', () => {
    const { pet, f } = setup(true);
    f.perchAt({ x: 10, y: 6, dir: Dir.Down }, 0);
    expect({ x: pet.x, y: pet.y, dir: pet.dir, anim: pet.anim }).toEqual({ x: 10, y: 6, dir: Dir.Down, anim: Anim.Idle });
    f.setAsleep(true);
    expect(pet.anim).toBe(Anim.Sleep);
    f.update(5000, { x: 2, y: 2 }, Dir.Down, { x: 10, y: 6, dir: Dir.Down });
    expect({ x: pet.x, y: pet.y, anim: pet.anim }).toEqual({ x: 10, y: 6, anim: Anim.Sleep });
    f.setAsleep(false);
    expect(pet.anim).toBe(Anim.Idle);
    f.setLinked(false);
    expect(pet.anim).toBe(Anim.Sleep);
  });
});
