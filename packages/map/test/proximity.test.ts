import { describe, expect, it } from 'vitest';
import { computeProximityGroups, nearbyRecipients, type ProximityPlayer } from '../src/index';
import { world } from './fixtures';

/** Player at a tile, zone taken from the real map. */
const at = (id: string, x: number, y: number): ProximityPlayer => ({
  id,
  x,
  y,
  zoneId: world.zoneAt(x, y)?.zoneId,
});

describe('nearbyRecipients', () => {
  const inMeetingA = at('m1', 2, 18);
  const inMeetingB = at('m2', 7, 21); // > 5 tiles from m1, same meeting zone
  const outsideNearMeeting = at('o1', 10, 20); // 3 tiles from m2 but outside the zone
  const aisle = at('o2', 10, 16);
  const far = at('o3', 10, 5);
  const players = [inMeetingA, inMeetingB, outsideNearMeeting, aisle, far];

  it('inside the meeting zone: only the meeting zone hears, regardless of distance', () => {
    expect(inMeetingA.zoneId).toBe('meeting');
    expect(nearbyRecipients(inMeetingA, players)).toEqual(['m2']);
    expect(nearbyRecipients(inMeetingB, players)).toEqual(['m1']);
  });

  it('outside: everyone within the radius except people in the meeting zone', () => {
    expect(outsideNearMeeting.zoneId).toBeUndefined();
    expect(nearbyRecipients(outsideNearMeeting, players)).toEqual(['o2']);
    expect(nearbyRecipients(far, players)).toEqual([]);
  });

  it('uses a Euclidean radius (default 5) and excludes the sender', () => {
    const s = { id: 's', x: 0, y: 0 };
    const ps = [
      s,
      { id: 'a', x: 3, y: 4 },
      { id: 'b', x: 3.6, y: 3.6 },
      { id: 'c', x: 0, y: -5 },
      { id: 'a', x: 50, y: 50 },
    ];
    expect(nearbyRecipients(s, ps)).toEqual(['a', 'c']);
    expect(nearbyRecipients(s, ps, 6)).toEqual(['a', 'b', 'c']);
  });

  it('accepts custom isolated zones', () => {
    const s = { id: 's', x: 0, y: 0, zoneId: 'pantry' };
    const ps = [
      { id: 'a', x: 1, y: 0, zoneId: null },
      { id: 'b', x: 30, y: 0, zoneId: 'pantry' },
    ];
    expect(nearbyRecipients(s, ps)).toEqual(['a']); // pantry is not isolated by default
    expect(nearbyRecipients(s, ps, 5, ['pantry'])).toEqual(['b']);
  });
});

describe('computeProximityGroups', () => {
  it('chains players within the radius and isolates the meeting zone', () => {
    const groups = computeProximityGroups([
      at('c', 10, 9),
      at('a', 10, 1),
      at('b', 10, 5), // a-b 4, b-c 4, a-c 8: one chained group
      at('z', 20, 9),
      at('m2', 8, 21),
      at('m1', 1, 18),
      at('x', 10, 20), // 2 tiles from m2, but outside the zone
      at('y', 12, 18),
    ]);
    expect(groups).toEqual([['a', 'b', 'c'], ['m1', 'm2'], ['x', 'y'], ['z']]);
  });

  it('respects the radius option and custom isolated zones', () => {
    const ps: ProximityPlayer[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 6, y: 0 },
      { id: 'c', x: 7, y: 0, zoneId: 'pantry' },
    ];
    expect(computeProximityGroups(ps)).toEqual([['a'], ['b', 'c']]);
    expect(computeProximityGroups(ps, { radius: 6 })).toEqual([['a', 'b', 'c']]);
    expect(computeProximityGroups(ps, { radius: 6, zones: ['pantry'] })).toEqual([['a', 'b'], ['c']]);
  });

  it('ignores duplicate ids and handles empty input', () => {
    expect(computeProximityGroups([])).toEqual([]);
    expect(
      computeProximityGroups([
        { id: 'a', x: 0, y: 0 },
        { id: 'a', x: 1, y: 0 },
      ]),
    ).toEqual([['a']]);
  });
});
