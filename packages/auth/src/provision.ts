import { audit, desks, notifyTown, profiles, user, type Db } from '@enu/db';
import { DEFAULT_AVATAR, PET_SPECIES, type AvatarPreset, type PetSpecies } from '@enu/shared';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Creates the ENU Town profile for a new user and, when the Google display name matches an
 * unassigned seat label from the roster, assigns that seat and its avatar/pet presets.
 * Idempotent: an existing profile is left untouched.
 */
export async function provisionProfile(db: Db, u: { id: string; name: string; email: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.userId, u.id));
    if (existing) return;

    const name = u.name.trim();
    const [seat] = name
      ? await tx
          .select()
          .from(desks)
          .where(and(eq(desks.labelName, name), isNull(desks.userId)))
          .limit(1)
      : [];

    const avatar: AvatarPreset = seat?.avatar ?? DEFAULT_AVATAR;
    const species: PetSpecies = (PET_SPECIES as readonly string[]).includes(seat?.petSpecies ?? '')
      ? (seat?.petSpecies as PetSpecies)
      : 'cat';
    await tx.insert(profiles).values({
      userId: u.id,
      displayName: (name || u.email.split('@')[0] || '새 직원').slice(0, 40),
      avatar,
      petSpecies: species,
      petName: (seat?.petName ?? '펫').slice(0, 20),
      team: seat?.team ?? null,
      title: seat?.title ?? null,
      roleNote: seat?.roleNote ?? null,
    });

    if (seat) {
      const assigned = await tx
        .update(desks)
        .set({ userId: u.id })
        .where(and(eq(desks.deskId, seat.deskId), isNull(desks.userId)))
        .returning({ deskId: desks.deskId });
      if (assigned.length > 0) {
        await notifyTown(tx, { v: 1, type: 'desks_changed' });
        await audit(tx, {
          actorType: 'system',
          actorUserId: u.id,
          action: 'desk.auto_assign',
          targetType: 'desk',
          targetId: seat.deskId,
        });
      }
    }
  });
}

/** Stores the Google `sub` once the Google account row exists (stable key, unlike email). */
export async function recordGoogleSub(db: Db, userId: string, sub: string): Promise<void> {
  await db.update(user).set({ googleSub: sub }).where(and(eq(user.id, userId), isNull(user.googleSub)));
}
