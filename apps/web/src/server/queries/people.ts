import { desks, pets, profiles, user, type DbOrTx } from '@enu/db';
import { DESK_IDS, type DeskDto, type PersonDto } from '@enu/shared';
import { and, asc, eq } from 'drizzle-orm';
import { toDeskDto, toPersonDto, type ProfileRow } from '../dto';

export interface PersonRecord {
  profile: ProfileRow;
  /** The default pet's look (null only while a profile is being provisioned). */
  pet: { species: string; name: string } | null;
  deskId: string | null;
  email: string;
  status: string;
  role: string;
}

/** Joins each profile to its default pet. */
const defaultPetJoin = and(eq(pets.userId, profiles.userId), eq(pets.isDefault, true));

/** Profile + desk + account state of one user (null when unknown or without a profile). */
export async function findPerson(db: DbOrTx, userId: string): Promise<PersonRecord | null> {
  const [row] = await db
    .select({
      profile: profiles,
      pet: { species: pets.species, name: pets.name },
      deskId: desks.deskId,
      email: user.email,
      status: user.status,
      role: user.role,
    })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .leftJoin(desks, eq(desks.userId, profiles.userId))
    .leftJoin(pets, defaultPetJoin)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row ? { ...row, deskId: row.deskId ?? null } : null;
}

/** Everyone active in the town, grouped by team order then name. */
export async function listPeople(db: DbOrTx): Promise<PersonDto[]> {
  const rows = await db
    .select({ profile: profiles, deskId: desks.deskId, pet: { species: pets.species, name: pets.name } })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .leftJoin(desks, eq(desks.userId, profiles.userId))
    .leftJoin(pets, defaultPetJoin)
    .where(eq(user.status, 'active'))
    .orderBy(asc(profiles.displayName));
  return rows.map((r) => toPersonDto(r.profile, r.deskId ?? null, r.pet));
}

/** The 14 seats in floor-plan order, with the occupant (or the roster label for a free seat). */
export async function listDesks(db: DbOrTx): Promise<DeskDto[]> {
  const rows = await db
    .select({
      deskId: desks.deskId,
      userId: desks.userId,
      labelName: desks.labelName,
      team: desks.team,
      occupantName: profiles.displayName,
      occupantTeam: profiles.team,
      occupantStatus: user.status,
    })
    .from(desks)
    .leftJoin(profiles, eq(profiles.userId, desks.userId))
    .leftJoin(user, eq(user.id, desks.userId));
  const order = new Map<string, number>(DESK_IDS.map((d, i) => [d, i]));
  return rows
    .sort((a, b) => (order.get(a.deskId) ?? 99) - (order.get(b.deskId) ?? 99))
    .map((r) =>
      toDeskDto(
        { deskId: r.deskId, userId: r.userId, labelName: r.labelName, team: r.team },
        r.userId && r.occupantName ? { displayName: r.occupantName, team: r.occupantTeam } : null,
      ),
    );
}
