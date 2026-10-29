import {
  audit,
  newOpaqueId,
  notifyTown,
  petMessages,
  pets,
  profiles,
  workLogs,
  type Db,
  type DbOrTx,
} from '@enu/db';
import {
  ANY_COLLEAGUE,
  COLLEAGUE_VISIBLE_PET_MESSAGE_VISIBILITY,
  canViewPet,
  canViewPetMessage,
  petDefaultVisibility,
  petMessageVisibility,
  prepareOwnerPetText,
} from '@enu/domain';
import {
  LIMITS,
  localDateKey,
  type ColleaguePetMessageDto,
  type OwnerPetMessageDto,
  type PetMessageSend,
  type PetThreadPageDto,
  type Visibility,
  type WorkLogDto,
} from '@enu/shared';
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ko } from '@/i18n/ko';
import {
  asVisibility,
  toColleaguePetMessageDto,
  toOwnerPetMessageDto,
  toWorkLogDto,
  type LogAuthor,
  type PetMessageRow,
  type PetMessageStats,
} from '../dto';
import { HttpError, notFound, paginate, type Cursor } from '../http';
import { wakeOwner } from '../pet-channel/wake';
import type { Viewer } from '../session';
import { findAuthor, requireVisibleAuthor } from './logs';
import { requireMyPet } from './pets';
import { beforeMicros, epochMicros } from './sql';

/**
 * Pet rooms (ADR 0005, docs/design/messenger-spec.md §4). The owner writes; replies come only from the owner's
 * Claude (services/pet-replies in @enu/mcp-tools). Colleagues read company messages with the date only, decided by
 * `canViewPetMessage`; nothing here pushes anything to them.
 */

/** At most this many work-log day cards ride along with one page. */
const MAX_LOG_CARDS = 100;

async function ownerSettings(
  db: DbOrTx,
  userId: string,
): Promise<{ timezone: string; petDefault: Visibility }> {
  const [p] = await db
    .select({ timezone: profiles.timezone, petDefault: profiles.petChatDefaultVisibility })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return {
    timezone: p?.timezone ?? 'Asia/Seoul',
    petDefault: asVisibility(p?.petDefault ?? null) ?? 'company',
  };
}

function threadChanged(tx: DbOrTx, userId: string, petId: string) {
  return notifyTown(tx, { v: 1, type: 'pet_thread_changed', user_id: userId, pet_id: petId });
}

/**
 * The owner writes to their pet. A repeated `client_msg_id` returns the stored message (`created: false`). A
 * company-visible message with personal data is refused (422 pii_public) so it can be sent as 나만 보기 instead.
 */
export async function sendPetMessage(
  db: Db,
  viewer: Viewer,
  petId: string,
  body: PetMessageSend,
  now = new Date(),
): Promise<{ created: boolean; message: OwnerPetMessageDto }> {
  const pet = await requireMyPet(db, viewer, petId);
  const prepared = prepareOwnerPetText(body.text);
  if (!prepared.ok) {
    throw new HttpError(400, 'invalid_body', ko.errors.invalidBody, [
      { field: 'text', reason: prepared.reason },
    ]);
  }
  const settings = await ownerSettings(db, viewer.userId);
  const visibility = petMessageVisibility(
    body.visibility,
    petDefaultVisibility(asVisibility(pet.defaultVisibility), settings.petDefault),
  );
  if (visibility === 'company' && prepared.pii.length > 0) {
    throw new HttpError(422, 'pii_public', ko.errors.piiPublic, [{ field: 'text', reason: 'pii' }]);
  }

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(petMessages)
      .values({
        id: newOpaqueId(),
        petId: pet.id,
        userId: viewer.userId,
        author: 'owner',
        body: prepared.text,
        dayKey: localDateKey(now, settings.timezone),
        visibility,
        visibilitySetBy: 'owner',
        clientMsgId: body.client_msg_id,
        answerState: 'pending',
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [petMessages.userId, petMessages.clientMsgId],
        where: sql`${petMessages.clientMsgId} is not null`,
      })
      .returning();
    if (row) {
      await threadChanged(tx, viewer.userId, pet.id);
      return { created: true, row };
    }
    const [existing] = await tx
      .select()
      .from(petMessages)
      .where(and(eq(petMessages.userId, viewer.userId), eq(petMessages.clientMsgId, body.client_msg_id)))
      .limit(1);
    if (!existing || existing.petId !== pet.id) {
      throw new HttpError(409, 'client_msg_id_reused', ko.errors.invalidBody, [
        { field: 'client_msg_id', reason: 'taken' },
      ]);
    }
    return { created: false, row: existing };
  });
  if (result.created) wakeOwner(viewer.userId);
  return { created: result.created, message: toOwnerPetMessageDto(result.row) };
}

/** Work-log day cards of `ownerId` between two owner-local dates (inclusive; null = open), oldest first. */
async function logCards(
  db: DbOrTx,
  ownerId: string,
  author: LogAuthor,
  viewer: { userId: string },
  from: string | null,
  to: string | null,
): Promise<WorkLogDto[]> {
  const rows = await db
    .select()
    .from(workLogs)
    .where(
      and(
        eq(workLogs.userId, ownerId),
        sql`${workLogs.deletedAt} is null`,
        viewer.userId === ownerId ? undefined : eq(workLogs.visibility, 'company'),
        from ? gte(workLogs.periodKey, from) : undefined,
        to ? lte(workLogs.periodKey, to) : undefined,
      ),
    )
    .orderBy(desc(workLogs.periodKey))
    .limit(MAX_LOG_CARDS);
  return rows
    .reverse()
    .map((r) => toWorkLogDto(r, author, viewer))
    .filter((d): d is WorkLogDto => d !== null);
}

/**
 * The day range a page covers: from its oldest message (or open when no older page exists) to its newest (today on
 * the first page, so today's log shows even before anyone wrote).
 */
function pageDays(
  items: readonly { dayKey: string }[],
  firstPage: boolean,
  hasOlder: boolean,
  today: string,
): { from: string | null; to: string | null } | null {
  if (items.length === 0 && !firstPage) return null;
  const days = items.map((i) => i.dayKey).sort();
  return {
    from: hasOlder ? (days[0] ?? null) : null,
    to: firstPage ? today : (days[days.length - 1] ?? null),
  };
}

/** My pet room, newest page first, each page oldest message first. */
export async function ownerPetThread(
  db: DbOrTx,
  viewer: Viewer,
  petId: string,
  cursor: Cursor | null,
  limit: number,
  now = new Date(),
): Promise<PetThreadPageDto<OwnerPetMessageDto>> {
  const pet = await requireMyPet(db, viewer, petId);
  const rows = await db
    .select({ m: petMessages, micros: epochMicros(petMessages.createdAt) })
    .from(petMessages)
    .where(and(eq(petMessages.petId, pet.id), beforeMicros(petMessages.createdAt, petMessages.id, cursor)))
    .orderBy(desc(petMessages.createdAt), desc(petMessages.id))
    .limit(limit + 1);
  const page = paginate(rows, limit, (r) => ({ k: r.micros, id: r.m.id }));
  const items = page.items.map((r) => toOwnerPetMessageDto(r.m)).reverse();
  let cards: WorkLogDto[] = [];
  if (pet.isDefault) {
    const { timezone } = await ownerSettings(db, viewer.userId);
    const range = pageDays(items, cursor === null, page.nextCursor !== null, localDateKey(now, timezone));
    const author = await findAuthor(db, viewer.userId);
    if (range && author) cards = await logCards(db, viewer.userId, author, viewer, range.from, range.to);
  }
  return { items, workLogs: cards, nextCursor: page.nextCursor };
}

const parent = alias(petMessages, 'parent_message');

/** Rows of `petId` a colleague may see: company, and for a reply its question is company too (§3). */
function colleaguePredicate(petId: string): SQL | undefined {
  return and(
    eq(petMessages.petId, petId),
    eq(petMessages.visibility, COLLEAGUE_VISIBLE_PET_MESSAGE_VISIBILITY),
    or(eq(petMessages.author, 'owner'), eq(parent.visibility, COLLEAGUE_VISIBLE_PET_MESSAGE_VISIBILITY)),
  );
}

/**
 * Someone's pet room as colleagues see it (the owner asking gets the same view). Dates only, no push; the cursor is
 * a message id resolved under the same rule, so an id that is hidden, deleted or unknown gives the same 400.
 */
export async function colleaguePetThread(
  db: DbOrTx,
  viewer: Viewer,
  ownerId: string,
  petId: string,
  cursor: Cursor | null,
  limit: number,
  now = new Date(),
): Promise<PetThreadPageDto<ColleaguePetMessageDto>> {
  const author = await requireVisibleAuthor(db, viewer, ownerId);
  const [pet] = await db
    .select()
    .from(pets)
    .where(and(eq(pets.id, petId), eq(pets.userId, ownerId)))
    .limit(1);
  if (!pet || !canViewPet(viewer, { ownerId }, author)) throw notFound(ko.errors.petNotFound);

  let before: SQL | undefined;
  if (cursor) {
    const [at] = await db
      .select({ createdAt: petMessages.createdAt, id: petMessages.id })
      .from(petMessages)
      .leftJoin(parent, eq(parent.id, petMessages.inReplyTo))
      .where(and(colleaguePredicate(pet.id), eq(petMessages.id, cursor.id)))
      .limit(1);
    if (!at) throw new HttpError(400, 'invalid_cursor', ko.errors.invalidCursor);
    before = sql`(${petMessages.createdAt}, ${petMessages.id}) < (${at.createdAt.toISOString()}::timestamptz, ${at.id}::uuid)`;
  }
  const rows = await db
    .select({ m: petMessages, parentVisibility: parent.visibility })
    .from(petMessages)
    .leftJoin(parent, eq(parent.id, petMessages.inReplyTo))
    .where(and(colleaguePredicate(pet.id), before))
    .orderBy(desc(petMessages.createdAt), desc(petMessages.id))
    .limit(limit + 1);
  const page = paginate(rows, limit, (r) => ({ k: 'r', id: r.m.id }));
  const visible = page.items.filter((r) =>
    canViewPetMessage(
      ANY_COLLEAGUE,
      {
        ownerId,
        author: r.m.author === 'pet' ? 'pet' : 'owner',
        visibility: asVisibility(r.m.visibility) ?? 'private',
      },
      r.m.author === 'pet' ? { visibility: asVisibility(r.parentVisibility) ?? 'private' } : null,
      author,
    ),
  );
  const items = visible.map((r) => toColleaguePetMessageDto(r.m)).reverse();
  let cards: WorkLogDto[] = [];
  if (pet.isDefault) {
    const { timezone } = await ownerSettings(db, ownerId);
    const range = pageDays(items, cursor === null, page.nextCursor !== null, localDateKey(now, timezone));
    if (range) cards = await logCards(db, ownerId, author, ANY_COLLEAGUE, range.from, range.to);
  }
  return { items, workLogs: cards, nextCursor: page.nextCursor };
}

async function requireMyMessage(
  db: DbOrTx,
  viewer: Viewer,
  petId: string,
  messageId: string,
): Promise<PetMessageRow> {
  const [row] = await db
    .select()
    .from(petMessages)
    .where(
      and(eq(petMessages.id, messageId), eq(petMessages.petId, petId), eq(petMessages.userId, viewer.userId)),
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

/**
 * The owner shows or hides one message (and, with the parent rule, its replies). The owner may raise, except
 * that their own text with personal data never becomes company-visible (the same 422 pii_public as sending).
 */
export async function setPetMessageVisibility(
  db: Db,
  viewer: Viewer,
  petId: string,
  messageId: string,
  visibility: Visibility,
): Promise<OwnerPetMessageDto> {
  return db.transaction(async (tx) => {
    const current = await requireMyMessage(tx, viewer, petId, messageId);
    if (visibility === 'company' && current.author === 'owner') {
      const prepared = prepareOwnerPetText(current.body);
      if (prepared.ok && prepared.pii.length > 0) {
        throw new HttpError(422, 'pii_public', ko.errors.piiRaise, [{ field: 'visibility', reason: 'pii' }]);
      }
    }
    const [row] = await tx
      .update(petMessages)
      .set({ visibility, visibilitySetBy: 'owner' })
      .where(eq(petMessages.id, current.id))
      .returning();
    await threadChanged(tx, viewer.userId, petId);
    return toOwnerPetMessageDto(row!);
  });
}

/** Deletes one message at once; deleting my message deletes its replies too. */
export async function deletePetMessage(
  db: Db,
  viewer: Viewer,
  petId: string,
  messageId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await requireMyMessage(tx, viewer, petId, messageId);
    await tx.delete(petMessages).where(eq(petMessages.id, current.id));
    await threadChanged(tx, viewer.userId, petId);
  });
}

/** Hides a pet's whole history from colleagues (future messages follow the pet's default). */
export async function hidePetHistory(db: Db, viewer: Viewer, petId: string): Promise<{ updated: number }> {
  return db.transaction(async (tx) => {
    const pet = await requireMyPet(tx, viewer, petId);
    const rows = await tx
      .update(petMessages)
      .set({ visibility: 'private', visibilitySetBy: 'owner' })
      .where(and(eq(petMessages.petId, pet.id), eq(petMessages.visibility, 'company')))
      .returning({ id: petMessages.id });
    await audit(tx, {
      actorType: 'user',
      actorUserId: viewer.userId,
      action: 'pet_messages.hide_history',
      targetType: 'pet',
      targetId: pet.id,
      metadata: { count: rows.length },
    });
    await threadChanged(tx, viewer.userId, pet.id);
    return { updated: rows.length };
  });
}

/** Marks replies up to `lastMessageId` read (a current value per message; no read time is stored). */
export async function markPetRead(
  db: Db,
  viewer: Viewer,
  petId: string,
  lastMessageId: string,
): Promise<{ unread: number }> {
  return db.transaction(async (tx) => {
    const pet = await requireMyPet(tx, viewer, petId);
    const target = await requireMyMessage(tx, viewer, pet.id, lastMessageId);
    const cleared = await tx
      .update(petMessages)
      .set({ unread: false })
      .where(
        and(
          eq(petMessages.petId, pet.id),
          eq(petMessages.unread, true),
          lte(petMessages.createdAt, target.createdAt),
        ),
      )
      .returning({ id: petMessages.id });
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(petMessages)
      .where(and(eq(petMessages.petId, pet.id), eq(petMessages.unread, true)));
    if (cleared.length > 0) await threadChanged(tx, viewer.userId, pet.id);
    return { unread: left?.n ?? 0 };
  });
}

/** Unread replies, waiting messages and the last line of each of the owner's pets. */
export async function petMessageStats(db: DbOrTx, userId: string): Promise<Map<string, PetMessageStats>> {
  const [unread, pending, last] = await Promise.all([
    db
      .select({ petId: petMessages.petId, n: sql<number>`count(*)::int` })
      .from(petMessages)
      .where(and(eq(petMessages.userId, userId), eq(petMessages.unread, true)))
      .groupBy(petMessages.petId),
    db
      .select({ petId: petMessages.petId, n: sql<number>`count(*)::int` })
      .from(petMessages)
      .where(and(eq(petMessages.userId, userId), inArray(petMessages.answerState, ['pending', 'claimed'])))
      .groupBy(petMessages.petId),
    db
      .selectDistinctOn([petMessages.petId], {
        petId: petMessages.petId,
        author: petMessages.author,
        body: petMessages.body,
        createdAt: petMessages.createdAt,
      })
      .from(petMessages)
      .where(eq(petMessages.userId, userId))
      .orderBy(asc(petMessages.petId), desc(petMessages.createdAt), desc(petMessages.id)),
  ]);
  const out = new Map<string, PetMessageStats>();
  const get = (petId: string) => {
    let s = out.get(petId);
    if (!s) {
      s = { unread: 0, pendingCount: 0, last: null };
      out.set(petId, s);
    }
    return s;
  };
  for (const r of unread) get(r.petId).unread = r.n;
  for (const r of pending) get(r.petId).pendingCount = r.n;
  for (const r of last) {
    get(r.petId).last = {
      author: r.author === 'pet' ? 'pet' : 'owner',
      text: r.body,
      createdAt: r.createdAt.toISOString(),
    };
  }
  return out;
}

export const PET_THREAD_PAGE = { def: 30, max: LIMITS.petThreadPageMax } as const;
