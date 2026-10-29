import { desks, newId, profiles, user, type DbHandle } from '@enu/db';
import { PET_SPECIES, type PetSpecies } from '@enu/shared';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { choosePetSpecies, provisionProfile } from '../src/provision';

let h: DbHandle;

beforeAll(async () => {
  h = await setupTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await truncateAll(h.db);
});

/** An existing member who already has `species` (status as given). */
async function holder(species: PetSpecies, status: 'active' | 'deactivated' = 'active') {
  const u = await createTestUser(h.db, { status });
  await h.db.update(profiles).set({ petSpecies: species }).where(eq(profiles.userId, u.id));
  return u.id;
}

/** A signed-up user without a profile yet (what the sign-up hook sees). */
async function newcomer(name: string) {
  const id = newId();
  const email = `${id.slice(-8)}@enu-tech.co.kr`;
  await h.db.insert(user).values({ id, name, email, emailVerified: true, hd: 'enu-tech.co.kr' });
  return { id, name, email };
}

async function speciesOf(userId: string) {
  const [p] = await h.db.select({ species: profiles.petSpecies }).from(profiles).where(eq(profiles.userId, userId));
  return p?.species;
}

const [FIRST, SECOND, THIRD] = PET_SPECIES as unknown as [PetSpecies, PetSpecies, PetSpecies];

describe('choosePetSpecies', () => {
  it('keeps a free preset, else takes the first free species, and repeats only when all are taken', () => {
    expect(choosePetSpecies(THIRD, [FIRST])).toBe(THIRD);
    expect(choosePetSpecies(THIRD, [THIRD, FIRST])).toBe(SECOND);
    expect(choosePetSpecies(null, [FIRST])).toBe(SECOND);
    expect(choosePetSpecies(null, [])).toBe(FIRST);
    expect(choosePetSpecies(THIRD, PET_SPECIES)).toBe(THIRD);
    expect(choosePetSpecies(null, PET_SPECIES)).toBe(FIRST);
  });
});

describe('provisionProfile pet species', () => {
  it('gives the seat preset while it is free and assigns the seat', async () => {
    await h.db.insert(desks).values({ deskId: 'L1a', labelName: '자리주인', petSpecies: THIRD, petName: '여울' });
    await holder(FIRST);
    const u = await newcomer('자리주인');
    await provisionProfile(h.db, u);
    expect(await speciesOf(u.id)).toBe(THIRD);
    const [desk] = await h.db.select().from(desks).where(eq(desks.deskId, 'L1a'));
    expect(desk?.userId).toBe(u.id);
  });

  it('falls back to the first free species when the preset is taken or there is no seat', async () => {
    await h.db.insert(desks).values({ deskId: 'L1a', labelName: '자리주인', petSpecies: FIRST, petName: '여울' });
    await holder(FIRST);
    await holder(SECOND);
    const seated = await newcomer('자리주인');
    await provisionProfile(h.db, seated);
    expect(await speciesOf(seated.id)).toBe(THIRD);

    const seatless = await newcomer('새 직원');
    await provisionProfile(h.db, seatless);
    const expected = PET_SPECIES.find((s) => ![FIRST, SECOND, THIRD].includes(s));
    expect(await speciesOf(seatless.id)).toBe(expected ?? FIRST);
  });

  it("frees a deactivated member's species and repeats the preset only when every species is taken", async () => {
    await holder(FIRST, 'deactivated');
    const first = await newcomer('첫째');
    await provisionProfile(h.db, first);
    expect(await speciesOf(first.id)).toBe(FIRST);

    for (const s of PET_SPECIES.filter((x) => x !== FIRST)) await holder(s);
    await h.db.insert(desks).values({ deskId: 'L2a', labelName: '막내', petSpecies: SECOND, petName: '몽실' });
    const last = await newcomer('막내');
    await provisionProfile(h.db, last);
    expect(await speciesOf(last.id)).toBe(SECOND);
  });

  it('never gives two concurrent sign-ups the same species', async () => {
    await holder(FIRST);
    const a = await newcomer('동시1');
    const b = await newcomer('동시2');
    await Promise.all([provisionProfile(h.db, a), provisionProfile(h.db, b)]);
    const got = [await speciesOf(a.id), await speciesOf(b.id)];
    expect(new Set(got).size).toBe(2);
    expect(got).not.toContain(FIRST);
  });
});
