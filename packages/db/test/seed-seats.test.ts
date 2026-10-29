import { DEFAULT_AVATAR, DESK_IDS, PET_SPECIES, type Roster } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { assertDistinctPetSpecies, duplicatePetSpecies } from '../src/seed-seats';

type Seat = Roster['seats'][number];
const seat = (deskId: Seat['deskId'], species: Seat['pet']['species']): Seat => ({
  deskId,
  name: `직원-${deskId}`,
  avatar: DEFAULT_AVATAR,
  pet: { species, name: '펫' },
});

describe('pet species guard', () => {
  it('accepts a roster in which every seat has its own species', () => {
    const roster: Roster = { seats: [seat('L1a', 'cat'), seat('L1b', 'fox'), seat('R1', 'unicorn')] };
    expect(duplicatePetSpecies(roster)).toEqual([]);
    expect(() => assertDistinctPetSpecies(roster)).not.toThrow();
  });

  it('names the desks that share a species (roster order) and the species still free', () => {
    const roster: Roster = {
      seats: [
        seat('L1a', 'cat'),
        seat('L1b', 'fox'),
        seat('R2b', 'cat'),
        seat('L3b', 'fox'),
        seat('L5a', 'cat'),
      ],
    };
    expect(duplicatePetSpecies(roster)).toEqual([
      { species: 'cat', deskIds: ['L1a', 'R2b', 'L5a'] },
      { species: 'fox', deskIds: ['L1b', 'L3b'] },
    ]);
    expect(() => assertDistinctPetSpecies(roster)).toThrow(
      /'cat' is shared by desks L1a, R2b, L5a; 'fox' is shared by desks L1b, L3b\. Unused species: bunny, /,
    );
  });

  it('never mentions seat names', () => {
    const roster: Roster = { seats: [seat('L1a', 'owl'), seat('L1b', 'owl')] };
    let message = '';
    try {
      assertDistinctPetSpecies(roster);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('L1a, L1b');
    expect(message).not.toContain('직원');
  });

  it('there are enough species for every desk to differ', () => {
    expect(new Set(PET_SPECIES).size).toBeGreaterThanOrEqual(DESK_IDS.length);
  });
});
