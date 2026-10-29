import { DESK_IDS } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  allocateSpots,
  buildSpots,
  buildWorld,
  FACING_DELTA,
  findObjectLayer,
  reachableMask,
  rectContains,
  validateOfficeMap,
  type AllocatedSpot,
  type Spot,
  type SpotRequest,
} from '../src/index';
import { freshMap, key, setTile, shippedMap, world } from './fixtures';

const { spots } = world;
const at = (x: number, y: number, facing: Spot['facing']): Spot => ({ x, y, facing });
const seatKeys = new Set(world.desks.map((d) => `${d.seatX},${d.seatY}`));

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const req = (userId: string, deskId: string | null, intent: SpotRequest['intent']): SpotRequest => ({
  userId,
  deskId,
  intent,
  current: null,
});

function expectDistinct(result: Map<string, AllocatedSpot>): void {
  const tiles = [...result.values()].map(key);
  expect(new Set(tiles).size).toBe(tiles.length);
}

describe('buildSpots on the 606 map', () => {
  it('equals what buildWorld attached (and what the generator output yields)', () => {
    const rebuilt = buildSpots(shippedMap, world);
    expect(rebuilt.meetingSeats).toEqual(spots.meetingSeats);
    expect(rebuilt.overflowTiles).toEqual(spots.overflowTiles);
    expect(buildWorld(freshMap()).spots.breakSpots).toEqual(spots.breakSpots);
  });

  it('has 12 meeting seats around the table, each facing it, in (y, x) order', () => {
    expect(spots.meetingSeats).toEqual([
      at(3, 18, 'down'),
      at(4, 18, 'down'),
      at(5, 18, 'down'),
      at(6, 18, 'down'),
      at(2, 19, 'right'),
      at(7, 19, 'left'),
      at(2, 20, 'right'),
      at(7, 20, 'left'),
      at(3, 21, 'up'),
      at(4, 21, 'up'),
      at(5, 21, 'up'),
      at(6, 21, 'up'),
    ]);
    for (const s of spots.meetingSeats) expect(world.zoneAt(s.x, s.y)?.zoneId).toBe('meeting');
  });

  it('has break spots on every walkable pantry tile, facing down', () => {
    expect(spots.breakSpots).toHaveLength(19);
    for (const s of spots.breakSpots) {
      expect(world.zoneAt(s.x, s.y)?.zoneId, key(s)).toBe('pantry');
      expect(world.isWalkable(s.x, s.y)).toBe(true);
      expect(s.facing).toBe('down');
    }
    const order = spots.breakSpots.map((s) => s.y * world.width + s.x);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('has the walkable spawn tiles as guest spots, facing up', () => {
    expect(spots.guestSpots).toEqual([at(10, 21, 'up'), at(11, 21, 'up')]);
    for (const s of spots.guestSpots) expect(rectContains(world.spawn.tileRect, s.x, s.y)).toBe(true);
  });

  it('gives every desk (R1 included) at least one visitor tile next to the seat, facing it', () => {
    for (const d of world.desks) {
      const tiles = spots.visitorTiles(d.deskId);
      expect(tiles.length, d.deskId).toBeGreaterThanOrEqual(1);
      for (const t of tiles) {
        expect(world.isWalkable(t.x, t.y)).toBe(true);
        expect(seatKeys.has(key(t)), `${d.deskId} ${key(t)}`).toBe(false);
        const front = { x: t.x + FACING_DELTA[t.facing].x, y: t.y + FACING_DELTA[t.facing].y };
        expect(front, `${d.deskId} ${key(t)} faces the seat`).toEqual({ x: d.seatX, y: d.seatY });
      }
    }
    // the desk returns (ㄱ-shaped desks, the CEO's return on his right) take the tiles beside the chairs
    expect(spots.visitorTiles('R1')).toEqual([at(18, 6, 'left')]);
    expect(spots.visitorTiles('L1a')).toEqual([at(4, 5, 'left'), at(3, 4, 'down')]);
    expect(spots.visitorTiles('L2a')).toEqual([at(4, 8, 'left'), at(3, 9, 'up')]);
    expect(spots.visitorTiles('nope')).toEqual([]);
  });

  it('perches every pet on the desk-surface tile its seat faces', () => {
    for (const id of DESK_IDS) {
      const d = world.deskById(id)!;
      const p = spots.perch(id);
      expect(p, id).toEqual({
        x: d.seatX + FACING_DELTA[d.facing].x,
        y: d.seatY + FACING_DELTA[d.facing].y,
        facing: d.facing,
      });
      expect(rectContains(d.tileRect, p.x, p.y), id).toBe(true);
    }
    expect(spots.perch('R1')).toEqual(at(16, 6, 'left'));
    expect(spots.perch('nope')).toEqual(spots.guestSpots[0]);
  });

  it('can reach every spot from every seat', () => {
    const all = [
      ...spots.meetingSeats,
      ...spots.breakSpots,
      ...spots.guestSpots,
      ...world.desks.flatMap((d) => spots.visitorTiles(d.deskId)),
    ];
    for (const d of world.desks) {
      const mask = reachableMask(world, { x: d.seatX, y: d.seatY });
      for (const s of all) expect(mask[s.y * world.width + s.x], `${d.deskId} -> ${key(s)}`).toBe(1);
    }
  });

  it('keeps overflow tiles inside the room (no door, balcony, seat or chair), nearest the entrance first', () => {
    const o = spots.overflowTiles;
    expect(o.slice(0, 6)).toEqual([
      at(10, 21, 'up'),
      at(11, 21, 'up'),
      at(10, 20, 'up'),
      at(9, 21, 'up'),
      at(11, 20, 'up'),
      at(12, 21, 'up'),
    ]);
    expect(new Set(o.map(key)).size).toBe(o.length);
    for (const s of o) {
      expect(world.isWalkable(s.x, s.y)).toBe(true);
      expect(s.y >= 4 && s.y <= 21, key(s)).toBe(true);
      expect(seatKeys.has(key(s))).toBe(false);
      expect(spots.meetingSeats.some((m) => m.x === s.x && m.y === s.y)).toBe(false);
    }
  });
});

describe('allocateSpots', () => {
  const everyoneAtDesks = DESK_IDS.map((id, i) =>
    req(`u${String(i).padStart(2, '0')}`, id, { kind: 'desk' }),
  );

  it('seats desk owners on their own seat, facing their desk', () => {
    const r = allocateSpots(world, spots, everyoneAtDesks);
    for (const q of everyoneAtDesks) {
      const d = world.deskById(q.deskId!)!;
      expect(r.get(q.userId)).toEqual({ x: d.seatX, y: d.seatY, facing: d.facing, fallback: false });
    }
  });

  it('is deterministic and order-independent', () => {
    const mixed: SpotRequest[] = [
      ...DESK_IDS.slice(0, 5).map((id, i) => req(`m${i}`, id, { kind: 'meeting' })),
      req('v1', 'L2a', { kind: 'visit', hostDeskId: 'L1b' }),
      req('v2', null, { kind: 'visit', hostDeskId: 'L1b' }),
      ...DESK_IDS.slice(6, 9).map((id, i) => req(`b${i}`, id, { kind: 'break' })),
      req('g1', null, { kind: 'guest' }),
      req('g2', null, { kind: 'break' }),
      req('d1', 'R1', { kind: 'desk' }),
    ];
    const a = allocateSpots(world, spots, mixed);
    for (const seed of [1, 7, 42]) {
      const b = allocateSpots(world, spots, shuffled(mixed, seed));
      expect(Object.fromEntries(b)).toEqual(Object.fromEntries(a));
    }
    expectDistinct(a);
    expect(a.get('m0')).toEqual({ ...spots.meetingSeats[0]!, fallback: false });
    expect(a.get('v1')).toEqual({ ...spots.visitorTiles('L1b')[0]!, fallback: false });
    expect(a.get('v2')).toEqual({ ...spots.visitorTiles('L1b')[1]!, fallback: false });
  });

  it('keeps current holders on their spot', () => {
    const before = allocateSpots(world, spots, [
      req('a', 'L1a', { kind: 'meeting' }),
      req('b', 'L1b', { kind: 'meeting' }),
      req('c', 'L2a', { kind: 'meeting' }),
    ]);
    // a newcomer sorting first does not push anyone off their chair
    const after = allocateSpots(world, spots, [
      req('0', 'L2b', { kind: 'meeting' }),
      ...(['a', 'b', 'c'] as const).map((id) => ({
        ...req(id, null, { kind: 'meeting' }),
        current: before.get(id)!,
      })),
    ]);
    for (const id of ['a', 'b', 'c']) expect(after.get(id)).toEqual(before.get(id));
    expect(after.get('0')).toEqual({ ...spots.meetingSeats[3]!, fallback: false });
    expectDistinct(after);

    // a current spot that no longer matches the intent is not kept
    const moved = allocateSpots(world, spots, [
      { ...req('a', 'L1a', { kind: 'desk' }), current: before.get('a')! },
    ]);
    expect(moved.get('a')).toMatchObject({ x: 3, y: 5, fallback: false });
  });

  it('places 13 people in a meeting: 12 chairs, the last one back at their own desk', () => {
    const people = [
      ...DESK_IDS.slice(0, 12).map((id, i) => req(`p${String(i).padStart(2, '0')}`, id, { kind: 'meeting' })),
      req('p99', 'R3b', { kind: 'meeting' }),
    ];
    const r = allocateSpots(world, spots, people);
    expect(r.size).toBe(13);
    expectDistinct(r);
    expect([...r.values()].filter((s) => !s.fallback)).toHaveLength(12);
    expect(r.get('p99')).toEqual({ x: 18, y: 11, facing: 'down', fallback: true });
  });

  it('places 20 people on a break: 19 pantry spots, overflow at the own desk or by BFS', () => {
    const withDesk = DESK_IDS.map((id, i) => req(`b${String(i).padStart(2, '0')}`, id, { kind: 'break' }));
    const deskless = Array.from({ length: 6 }, (_, i) => req(`n${i}`, null, { kind: 'break' }));
    const r = allocateSpots(world, spots, [...withDesk, ...deskless]);
    expect(r.size).toBe(20);
    expectDistinct(r);
    expect([...r.values()].filter((s) => !s.fallback)).toHaveLength(19);
    // userIds sort b.. < n..: the last desk-less person overflows, by BFS from the guest spots
    expect(r.get('n5')).toEqual({ ...spots.overflowTiles[0]!, fallback: true });

    // with desks sorting last, the overflow goes back to the own desk
    const late = allocateSpots(world, spots, [
      ...deskless,
      ...withDesk.map((q) => ({ ...q, userId: `z${q.userId}` })),
    ]);
    expect(late.get('zb13')).toEqual({ x: 18, y: 11, facing: 'down', fallback: true });
  });

  it('places 6 desk-less guests: 2 at the entrance, 4 on the nearest free tiles', () => {
    const guests = Array.from({ length: 6 }, (_, i) => req(`g${i}`, null, { kind: 'guest' }));
    const r = allocateSpots(world, spots, [...everyoneAtDesks, ...guests]);
    expect(r.size).toBe(20);
    expectDistinct(r);
    expect(guests.map((g) => r.get(g.userId))).toEqual([
      { ...at(10, 21, 'up'), fallback: false },
      { ...at(11, 21, 'up'), fallback: false },
      { ...at(10, 20, 'up'), fallback: true },
      { ...at(9, 21, 'up'), fallback: true },
      { ...at(11, 20, 'up'), fallback: true },
      { ...at(12, 21, 'up'), fallback: true },
    ]);
    // an overflow guest keeps their tile when someone ahead of them leaves
    const again = allocateSpots(world, spots, [
      ...guests.slice(1).map((g) => ({ ...g, current: r.get(g.userId)! })),
    ]);
    expect(again.get('g1')).toEqual({ ...at(11, 21, 'up'), fallback: false });
    expect(again.get('g5')).toEqual({ ...at(12, 21, 'up'), fallback: true });
    expect(again.get('g2')).toEqual({ ...at(10, 21, 'up'), fallback: false });
  });

  it('sends visit overflow back to the own desk, and handles unknown desks and duplicate ids', () => {
    const r = allocateSpots(world, spots, [
      req('a', 'L1a', { kind: 'visit', hostDeskId: 'R1' }),
      req('b', 'L1b', { kind: 'visit', hostDeskId: 'R1' }),
      req('c', 'L2a', { kind: 'visit', hostDeskId: 'R1' }),
      req('d', 'X9', { kind: 'desk' }),
      req('d', 'L5a', { kind: 'desk' }),
    ]);
    expect(r.get('a')).toEqual({ ...at(18, 6, 'left'), fallback: false });
    // R1 has a single visitor tile, so the second visitor stays at their own desk
    expect(r.get('b')).toEqual({ x: 6, y: 5, facing: 'down', fallback: true });
    expect(r.get('c')).toEqual({ x: 3, y: 8, facing: 'up', fallback: true });
    expect(r.size).toBe(4);
    expectDistinct(r);
  });
});

describe('validateOfficeMap: spots', () => {
  const check = (mutate: (m: ReturnType<typeof freshMap>) => void): string[] => {
    const m = freshMap();
    mutate(m);
    return validateOfficeMap(m, buildWorld(m)).errors;
  };

  it('reports a map without meeting seats or break spots', () => {
    const errors = check((m) => {
      const zones = findObjectLayer(m, 'zones')!;
      zones.objects = zones.objects.filter((o) => o.name !== 'pantry' && o.name !== 'meeting');
    });
    expect(errors).toContain(
      "no meeting seats ('meeting_chair' tiles next to a 'meeting_table' in the 'meeting' zone)",
    );
    expect(errors).toContain("no break spots (walkable tiles in the 'pantry' zone)");
  });

  it('reports a meeting seat that cannot be walked to', () => {
    expect(check((m) => setTile(m, 'walls', 2, 19, 'wall'))).toEqual(['meeting seat (2,19) is not walkable']);
  });

  it('reports a desk without a visitor tile', () => {
    // plants beside L1a's seat and a cabinet behind it: no visitor tile (and the seat is cut off)
    const errors = check((m) => {
      setTile(m, 'furniture', 2, 5, 'plant');
      setTile(m, 'furniture', 4, 5, 'plant');
      setTile(m, 'furniture', 3, 4, 'cabinet');
    });
    expect(errors).toContain(
      'L1a: no visitor tile next to seat (3,5) (a walkable tile left, right, above or below it that is not a seat or chair)',
    );
  });
});
