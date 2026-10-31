import type { PersonDto } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { TownDirectory } from './directory';

const person = (userId: string, over: Partial<PersonDto> = {}): PersonDto => ({
  userId,
  displayName: userId.toUpperCase(),
  avatar: {
    body: 'm',
    hair: 'short',
    hairColor: 'black',
    outfit: 'sky',
    skin: 'warm',
    wings: false,
    hat: true,
  },
  avatarKey: 'av-m-short-black-sky-warm',
  pet: { species: 'cat', name: '냥' },
  deskId: null,
  team: 'dev',
  teamLabel: '',
  title: null,
  roleNote: null,
  linkState: 'linked',
  acceptsSpells: true,
  ...over,
});

function loaded(...people: PersonDto[]) {
  const directory = new TownDirectory();
  directory.setPeople(people);
  let changes = 0;
  directory.on('change', () => changes++);
  return { directory, changes: () => changes };
}

describe('TownDirectory.updatePerson (a spellbook reads the target fresh)', () => {
  it('replaces the cached person in place and tells subscribers once', () => {
    const { directory, changes } = loaded(person('a'), person('b'), person('c'));
    const version = directory.getSnapshot().version;
    expect(directory.updatePerson(person('b', { acceptsSpells: false }))).toBe(true);
    expect(directory.person('b')?.acceptsSpells).toBe(false);
    expect(directory.people.map((p) => [p.userId, p.acceptsSpells])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
    expect(directory.getSnapshot().version).toBe(version + 1);
    expect(changes()).toBe(1);
    // ...and back on again (B turned spells back on): the next open shows it.
    expect(directory.updatePerson(person('b'))).toBe(true);
    expect(directory.person('b')?.acceptsSpells).toBe(true);
    expect(changes()).toBe(2);
  });

  it('changes nothing for an identical copy', () => {
    const { directory, changes } = loaded(person('a'), person('b'));
    const snapshot = directory.getSnapshot();
    expect(directory.updatePerson(person('b'))).toBe(false);
    expect(directory.getSnapshot()).toBe(snapshot);
    expect(changes()).toBe(0);
  });

  it('ignores someone not in the list (the list is only ever loaded whole)', () => {
    const empty = loaded();
    expect(empty.directory.updatePerson(person('a', { acceptsSpells: false }))).toBe(false);
    expect(empty.directory.person('a')).toBeUndefined();
    expect(empty.directory.people).toEqual([]);
    expect(empty.changes()).toBe(0);

    const { directory, changes } = loaded(person('a'));
    expect(directory.updatePerson(person('z'))).toBe(false);
    expect(directory.people.map((p) => p.userId)).toEqual(['a']);
    expect(changes()).toBe(0);
  });
});
