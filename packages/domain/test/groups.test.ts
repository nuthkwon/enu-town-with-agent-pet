import { DESK_IDS } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { groupPeople, type GroupMember } from '../src/groups';

const opts = { periodKey: '2026-11-02', deskOrder: DESK_IDS, meetingSeats: 12 };
const H1 = '1'.repeat(32);
const H2 = '2'.repeat(32);

const meeting = (userId: string, deskId: string | null, hash = H1): GroupMember => ({
  userId,
  deskId,
  activity: 'meeting',
  shown: true,
  key: { family: 'meeting', hash },
});
const working = (
  userId: string,
  deskId: string | null,
  activity: GroupMember['activity'] = 'work',
  shown = true,
): GroupMember => ({
  userId,
  deskId,
  activity,
  shown,
  key: { family: 'work', hash: H1 },
});

describe('groupPeople', () => {
  it('a meeting needs three people; two give no group', () => {
    expect(groupPeople([meeting('a', 'L1a'), meeting('b', 'L1b')], opts)).toEqual([]);
    const [g] = groupPeople([meeting('a', 'L1a'), meeting('b', 'L1b'), meeting('c', 'L2a')], opts);
    expect(g).toMatchObject({ family: 'meeting', members: ['a', 'b', 'c'], hostId: null, gather: true });
    expect(g?.id).toMatch(/^g[0-9a-z]+$/);
  });

  it('groups only people whose own reports carry the same ref', () => {
    const people = [
      meeting('a', 'L1a'),
      meeting('b', 'L1b'),
      meeting('c', 'L2a', H2),
      meeting('d', 'L2b', H2),
    ];
    expect(groupPeople(people, opts)).toEqual([]);
  });

  it('a member with a null (unshared) key never joins', () => {
    const unshared: GroupMember = { ...meeting('c', 'L2a'), key: null };
    expect(groupPeople([meeting('a', 'L1a'), meeting('b', 'L1b'), unshared], opts)).toEqual([]);
    expect(groupPeople([working('a', 'L1a'), { ...working('b', 'L1b'), key: null }], opts)).toEqual([]);
  });

  it('different families with the same hash do not merge', () => {
    // Merged, these four would make a meeting; apart, the two meeting members are too few.
    const groups = groupPeople(
      [meeting('a', 'L1a'), meeting('b', 'L1b'), working('c', 'L2a'), working('d', 'L2b')],
      opts,
    );
    expect(groups).toMatchObject([{ family: 'work', members: ['c', 'd'] }]);
    const both = groupPeople(
      [
        meeting('a', 'L1a'),
        meeting('b', 'L1b'),
        meeting('e', 'L3a'),
        working('c', 'L2a'),
        working('d', 'L2b'),
      ],
      opts,
    );
    expect(both.map((g) => [g.family, g.members]).sort()).toEqual([
      ['meeting', ['a', 'b', 'e']],
      ['work', ['c', 'd']],
    ]);
  });

  it('only the largest meeting gathers at the one table', () => {
    const big = ['a', 'b', 'c', 'd'].map((u, i) => meeting(u, DESK_IDS[i] ?? null, H1));
    const small = ['e', 'f', 'g'].map((u, i) => meeting(u, DESK_IDS[i + 4] ?? null, H2));
    const groups = groupPeople([...small, ...big], opts);
    expect(groups.find((g) => g.members.includes('a'))?.gather).toBe(true);
    expect(groups.find((g) => g.members.includes('e'))?.gather).toBe(false);
  });

  it('breaks a tie between equal meetings by the smallest id', () => {
    const one = ['a', 'b', 'c'].map((u, i) => meeting(u, DESK_IDS[i] ?? null, H1));
    const two = ['d', 'e', 'f'].map((u, i) => meeting(u, DESK_IDS[i + 3] ?? null, H2));
    const groups = groupPeople([...one, ...two], opts);
    expect(groups.map((g) => g.id)).toEqual([...groups.map((g) => g.id)].sort());
    expect(groups.map((g) => g.gather)).toEqual([true, false]);
  });

  it('a meeting larger than the table does not gather', () => {
    const people = ['a', 'b', 'c', 'd'].map((u) => meeting(u, null));
    expect(groupPeople(people, { ...opts, meetingSeats: 3 })).toMatchObject([{ gather: false }]);
    expect(groupPeople(people, { ...opts, meetingSeats: 4 })).toMatchObject([{ gather: true }]);
  });

  it('reviewers visit the author', () => {
    const [g] = groupPeople([working('rev', 'L1a', 'review'), working('author', 'R2a', 'work')], opts);
    expect(g).toMatchObject({ family: 'work', members: ['rev', 'author'], hostId: 'author', gather: true });
  });

  it('without a single author, the first member with a desk hosts', () => {
    const [two] = groupPeople([working('x', 'L2a', 'docs'), working('y', 'L1b', 'work')], opts);
    expect(two).toMatchObject({ members: ['y', 'x'], hostId: 'y', gather: true });
    const [reviewers] = groupPeople([working('x', 'L2a', 'review'), working('y', 'L1b', 'review')], opts);
    expect(reviewers).toMatchObject({ hostId: 'y', gather: true });
    const [deskless] = groupPeople([working('x', null, 'work'), working('y', 'L3a', 'review')], opts);
    expect(deskless).toMatchObject({ members: ['y', 'x'], hostId: 'y', gather: true });
  });

  it('links but does not gather larger, partly hidden or deskless work groups', () => {
    const four = ['a', 'b', 'c', 'd'].map((u, i) => working(u, DESK_IDS[i] ?? null));
    expect(groupPeople(four, opts)).toMatchObject([{ family: 'work', gather: false }]);
    const hidden = [working('a', 'L1a', 'work'), working('b', 'L1b', 'review', false)];
    expect(groupPeople(hidden, opts)).toMatchObject([{ members: ['a', 'b'], gather: false }]);
    const nobodyHasADesk = [working('a', null), working('b', null)];
    expect(groupPeople(nobodyHasADesk, opts)).toMatchObject([{ hostId: null, gather: false }]);
  });

  it('sorts members by desk order, people without a known desk last, then by id', () => {
    const [g] = groupPeople(
      [meeting('z', null), meeting('m', 'R3b'), meeting('b', 'L1a'), meeting('a', null), meeting('c', 'X9')],
      opts,
    );
    expect(g?.members).toEqual(['b', 'm', 'a', 'c', 'z']);
  });

  it('ids are stable within a day and differ across days', () => {
    const people = [meeting('a', 'L1a'), meeting('b', 'L1b'), meeting('c', 'L2a')];
    const today = groupPeople(people, opts)[0]?.id;
    expect(groupPeople(people, opts)[0]?.id).toBe(today);
    expect(groupPeople(people, { ...opts, periodKey: '2026-11-03' })[0]?.id).not.toBe(today);
    // The id is derived from the day and the members, never from the ref hash.
    expect(
      groupPeople(
        people.map((p) => ({ ...p, key: { family: 'meeting' as const, hash: H2 } })),
        opts,
      )[0]?.id,
    ).toBe(today);
  });

  it('a shuffled input gives the same output', () => {
    const people = [
      meeting('a', 'L1a'),
      meeting('b', 'L1b'),
      meeting('c', 'L2a'),
      working('d', 'L3a', 'review'),
      working('e', 'L3b'),
      { ...working('f', 'L4a'), key: { family: 'work' as const, hash: H2 } },
      { ...working('g', 'L4b', 'collab'), key: { family: 'work' as const, hash: H2 } },
      { ...working('h', 'L5a'), key: null },
    ];
    const expected = groupPeople(people, opts);
    expect(expected).toHaveLength(3);
    let seed = 7;
    for (let round = 0; round < 20; round++) {
      const shuffled = [...people];
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        const j = seed % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(groupPeople(shuffled, opts)).toEqual(expected);
    }
  });
});
