import {
  audit,
  lockOwnerScope,
  lockPetSpecies,
  newOpaqueId,
  notifyTown,
  pets,
  profiles,
  takenPetSpecies,
  type Db,
  type DbOrTx,
} from '@enu/db';
import {
  canCreatePet,
  canViewPet,
  petLookProblems,
  preparePetName,
  preparePetRoleInstructions,
  type PetLookProblem,
} from '@enu/domain';
import type { OwnerPetDto, PetCreate, PetInfoDto, PetPatch, PetTint, Visibility } from '@enu/shared';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { NO_PET_MESSAGES, asVisibility, toOwnerPetDto, toPetInfoDto, type PetRow } from '../dto';
import { HttpError, notFound, type FieldIssue } from '../http';
import type { Viewer } from '../session';
import { requireVisibleAuthor } from './logs';
import { petMessageStats } from './pet-messages';

/**
 * Pets (ADR 0005): the owner creates up to five, edits and deletes them; the default pet is created at provisioning
 * and cannot be deleted. Colleagues see only names and looks. Look and count rules come from @enu/domain.
 */

const ORDER = [desc(pets.isDefault), asc(pets.sortOrder), asc(pets.createdAt)] as const;

async function profileDefault(db: DbOrTx, userId: string): Promise<Visibility> {
  const [p] = await db
    .select({ v: profiles.petChatDefaultVisibility })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return asVisibility(p?.v ?? null) ?? 'company';
}

/** My pets, default first. */
export async function listMyPets(db: DbOrTx, viewer: Viewer): Promise<OwnerPetDto[]> {
  const [rows, def, stats] = await Promise.all([
    db
      .select()
      .from(pets)
      .where(eq(pets.userId, viewer.userId))
      .orderBy(...ORDER),
    profileDefault(db, viewer.userId),
    petMessageStats(db, viewer.userId),
  ]);
  return rows.map((r) => toOwnerPetDto(r, def, stats.get(r.id) ?? NO_PET_MESSAGES));
}

/** One of my pets, or 404 (another person's pet is "not found" for this route). */
export async function requireMyPet(db: DbOrTx, viewer: Viewer, petId: string): Promise<PetRow> {
  const [row] = await db
    .select()
    .from(pets)
    .where(and(eq(pets.id, petId), eq(pets.userId, viewer.userId)))
    .limit(1);
  if (!row) throw notFound(ko.errors.petNotFound);
  return row;
}

async function myPetDto(db: DbOrTx, viewer: Viewer, row: PetRow): Promise<OwnerPetDto> {
  const [def, stats] = await Promise.all([
    profileDefault(db, viewer.userId),
    petMessageStats(db, viewer.userId),
  ]);
  return toOwnerPetDto(row, def, stats.get(row.id) ?? NO_PET_MESSAGES);
}

function nameOrThrow(raw: string): string {
  const r = preparePetName(raw);
  if (!r.ok)
    throw new HttpError(400, 'invalid_body', ko.errors.invalidBody, [{ field: 'name', reason: r.reason }]);
  return r.name;
}

function roleOrThrow(raw: string | null): string | null {
  const r = preparePetRoleInstructions(raw);
  if (!r.ok) {
    throw new HttpError(400, 'invalid_body', ko.errors.invalidBody, [
      { field: 'role_instructions', reason: r.reason },
    ]);
  }
  return r.text;
}

function lookError(problems: readonly PetLookProblem[]): HttpError | null {
  const field = (p: PetLookProblem): FieldIssue =>
    p === 'pet_taken' ? { field: 'species', reason: 'taken' } : { field: 'tint', reason: p };
  if (problems.includes('pet_taken'))
    return new HttpError(409, 'pet_taken', ko.errors.petTaken, [field('pet_taken')]);
  if (problems.includes('look_taken'))
    return new HttpError(409, 'look_taken', ko.errors.lookTaken, [field('look_taken')]);
  if (problems.length) return new HttpError(400, 'invalid_look', ko.errors.baseReserved, problems.map(field));
  return null;
}

async function ownOtherLooks(tx: DbOrTx, userId: string, exceptPetId: string | null) {
  const rows = await tx
    .select({ species: pets.species, tint: pets.tint })
    .from(pets)
    .where(and(eq(pets.userId, userId), exceptPetId ? ne(pets.id, exceptPetId) : undefined));
  return rows.map((r) => ({ species: r.species, tint: r.tint as PetTint }));
}

export async function createPet(db: Db, viewer: Viewer, body: PetCreate): Promise<OwnerPetDto> {
  const name = nameOrThrow(body.name);
  const role = roleOrThrow(body.role_instructions);
  const row = await db.transaction(async (tx) => {
    await lockOwnerScope(tx, 'pets', viewer.userId);
    const mine = await tx
      .select({ sortOrder: pets.sortOrder })
      .from(pets)
      .where(eq(pets.userId, viewer.userId));
    if (!canCreatePet(mine.length)) throw new HttpError(409, 'pet_limit', ko.errors.petLimit);
    const err = lookError(
      petLookProblems(
        { species: body.species, tint: body.tint, isDefault: false },
        { ownOtherLooks: await ownOtherLooks(tx, viewer.userId, null), othersDefaultSpecies: new Set() },
      ),
    );
    if (err) throw err;
    const sortOrder = Math.min(99, Math.max(0, ...mine.map((m) => m.sortOrder)) + 1);
    const [created] = await tx
      .insert(pets)
      .values({
        id: newOpaqueId(),
        userId: viewer.userId,
        name,
        species: body.species,
        tint: body.tint,
        roleInstructions: role,
        replyRoute: body.reply_route,
        defaultVisibility: body.default_visibility,
        isDefault: false,
        sortOrder,
      })
      .returning();
    await audit(tx, {
      actorType: 'user',
      actorUserId: viewer.userId,
      action: 'pet.create',
      targetType: 'pet',
      targetId: created!.id,
      metadata: {
        species: body.species,
        tint: body.tint,
        replyRoute: body.reply_route,
        defaultVisibility: body.default_visibility,
        hasRole: role !== null,
      },
    });
    await notifyTown(tx, { v: 1, type: 'pets_changed', user_id: viewer.userId });
    return created!;
  });
  return myPetDto(db, viewer, row);
}

export async function patchPet(db: Db, viewer: Viewer, petId: string, patch: PetPatch): Promise<OwnerPetDto> {
  const set: Partial<typeof pets.$inferInsert> = {};
  if (patch.name !== undefined) set.name = nameOrThrow(patch.name);
  if (patch.role_instructions !== undefined) set.roleInstructions = roleOrThrow(patch.role_instructions);
  if (patch.reply_route !== undefined) set.replyRoute = patch.reply_route;
  if (patch.default_visibility !== undefined) set.defaultVisibility = patch.default_visibility;
  if (patch.sort_order !== undefined) set.sortOrder = patch.sort_order;

  const row = await db.transaction(async (tx) => {
    const current = await requireMyPet(tx, viewer, petId);
    const species = patch.species ?? current.species;
    const tint = patch.tint ?? (current.tint as PetTint);
    const lookChanged = species !== current.species || tint !== current.tint;
    if (lookChanged) {
      // The default pet's species is unique among active members: same lock as onboarding and profile edits.
      if (current.isDefault) await lockPetSpecies(tx);
      else await lockOwnerScope(tx, 'pets', viewer.userId);
      const err = lookError(
        petLookProblems(
          { species, tint, isDefault: current.isDefault },
          {
            ownOtherLooks: await ownOtherLooks(tx, viewer.userId, current.id),
            othersDefaultSpecies:
              current.isDefault && species !== current.species
                ? new Set(await takenPetSpecies(tx, viewer.userId))
                : new Set(),
          },
        ),
      );
      if (err) throw err;
      set.species = species;
      set.tint = tint;
    }
    if (Object.keys(set).length === 0) return current;
    const [updated] = await tx.update(pets).set(set).where(eq(pets.id, current.id)).returning();
    await audit(tx, {
      actorType: 'user',
      actorUserId: viewer.userId,
      action: 'pet.update',
      targetType: 'pet',
      targetId: current.id,
      // Field names only: never the name, role text or other content.
      metadata: { fields: Object.keys(set).sort() },
    });
    await notifyTown(tx, { v: 1, type: 'pets_changed', user_id: viewer.userId });
    return updated!;
  });
  return myPetDto(db, viewer, row);
}

/** Deletes a pet and, by cascade, its conversation. The default pet cannot be deleted. */
export async function deletePet(db: Db, viewer: Viewer, petId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await requireMyPet(tx, viewer, petId);
    if (current.isDefault) throw new HttpError(409, 'default_pet', ko.errors.defaultPet);
    await tx.delete(pets).where(eq(pets.id, current.id));
    await audit(tx, {
      actorType: 'user',
      actorUserId: viewer.userId,
      action: 'pet.delete',
      targetType: 'pet',
      targetId: current.id,
    });
    await notifyTown(tx, { v: 1, type: 'pets_changed', user_id: viewer.userId });
  });
}

/** A person's pets as a colleague sees them (names and looks; 404 for unknown or deactivated people). */
export async function listPetsOf(db: DbOrTx, viewer: Viewer, ownerId: string): Promise<PetInfoDto[]> {
  const author = await requireVisibleAuthor(db, viewer, ownerId);
  const rows = await db
    .select()
    .from(pets)
    .where(eq(pets.userId, ownerId))
    .orderBy(...ORDER);
  return rows.filter((r) => canViewPet(viewer, { ownerId: r.userId }, author)).map(toPetInfoDto);
}
