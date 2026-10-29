import { lockOwnerScope, newOpaqueId, notifyTown, petMessages, pets, type Db, type DbOrTx } from '@enu/db';
import {
  checkinSkipReason,
  decideReplyAdmission,
  isClosedByLaterAnswer,
  laneOf,
  petDefaultVisibility,
  petReplyVisibility,
  preparePetReplyText,
  type PetLane,
  type PetQuestionState,
} from '@enu/domain';
import {
  LIMITS,
  PET_ANSWER_STATES,
  PET_REPLY_ROUTES,
  SOURCE_HINT_TO_SOURCE,
  localDateKey,
  petReplyRejectionReason,
  type PetAnswerState,
  type PostPetReplyInput,
  type PostPetReplyOutput,
  type PetReplyRejectionReason,
  type PetReplyRoute,
  type PetReplySource,
  type Visibility,
} from '@enu/shared';
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { recordLinkWrite, type CallerInfo } from '../links';
import { loadOwnerContext, type OwnerContext } from '../owner';

/**
 * The one reply core of both lanes (ADR 0005/0006, messenger-spec §3, §5): the connector's `post_pet_reply` and the
 * Claude Code channel's `/api/v1/pet-channel/replies`. Claude's text is stored verbatim or rejected; who may answer
 * is `decideReplyAdmission`. Replies are not audited (content and timing stay out of the audit log).
 */

export interface PetReplyAuthor {
  userId: string;
  /** The answering `claude_links` client: the connector's OAuth client, or the pet channel's link. */
  clientId: string;
  source: PetReplySource;
  /** The pet channel token answering (channel lane only). */
  tokenId: string | null;
}

export interface PetReplyRequest {
  inReplyTo: string;
  text: string;
  part: number;
  visibility?: Visibility;
}

export type PetReplyOutcome =
  | {
      ok: true;
      /** duplicate: this part was stored before; nothing changed and Claude's text was not overwritten. */
      result: 'created' | 'duplicate';
      messageId: string;
      inReplyTo: string;
      petId: string;
      visibility: Visibility;
    }
  | { ok: false; reason: PetReplyRejectionReason; detail?: string };

type MessageRow = typeof petMessages.$inferSelect;

const oneOf = <T extends string>(values: readonly T[], v: string | null, fallback: T): T =>
  v !== null && (values as readonly string[]).includes(v) ? (v as T) : fallback;

const lane = (v: string | null): PetLane | null => (v === 'channel' || v === 'connector' ? v : null);

function questionState(q: MessageRow): PetQuestionState {
  return {
    answerState: oneOf<PetAnswerState>(PET_ANSWER_STATES, q.answerState, 'pending'),
    answeredLane: lane(q.answeredLane),
    replyCount: q.replyCount,
    claimedBy: q.claimedBy,
    claimUntil: q.claimUntil,
    createdAt: q.createdAt,
  };
}

const answered = (by: PetLane) =>
  ({ answerState: 'answered', answeredLane: by, claimedBy: null, claimUntil: null }) as const;

/**
 * The first answer to a message also answers the owner's earlier waiting messages to the same pet (they were
 * written in a row), except those another Claude Code machine is holding right now.
 */
async function closeEarlier(tx: DbOrTx, q: MessageRow, by: PetLane, tokenId: string | null, now: Date) {
  const earlier = await tx
    .select()
    .from(petMessages)
    .where(
      and(
        eq(petMessages.petId, q.petId),
        eq(petMessages.author, 'owner'),
        ne(petMessages.answerState, 'answered'),
        lt(petMessages.createdAt, q.createdAt),
      ),
    )
    .for('update');
  for (const m of earlier) {
    if (!isClosedByLaterAnswer(questionState(m), tokenId, now)) continue;
    await tx.update(petMessages).set(answered(by)).where(eq(petMessages.id, m.id));
  }
}

function textProblem(text: string): { text: string } | { reason: PetReplyRejectionReason; detail?: string } {
  const r = preparePetReplyText(text);
  if (!('problem' in r)) return r;
  const parsed = petReplyRejectionReason.safeParse(r.problem.reason);
  return {
    reason: parsed.success ? parsed.data : 'empty',
    ...(r.problem.detail ? { detail: r.problem.detail } : {}),
  };
}

export async function postPetReplies(
  db: Db,
  author: PetReplyAuthor,
  requests: readonly PetReplyRequest[],
  now: Date,
  ownerIn?: OwnerContext,
): Promise<PetReplyOutcome[]> {
  const owner = ownerIn ?? (await loadOwnerContext(db, author.userId));
  const by = laneOf(author.source);
  const inOfficeHours = checkinSkipReason(now, owner.timezone, owner.holidays) === null;
  const texts = requests.map((r) => textProblem(r.text));

  return db.transaction(async (tx) => {
    // Serializes the owner's replies: the channel and the connector never both win the same message.
    await lockOwnerScope(tx, 'pet_replies', author.userId);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(petMessages)
      .where(
        and(
          eq(petMessages.userId, author.userId),
          eq(petMessages.author, 'pet'),
          eq(petMessages.dayKey, localDateKey(now, owner.timezone)),
        ),
      );
    let storedToday = Number(count?.n ?? 0);
    const outcomes: PetReplyOutcome[] = [];
    const changedPets = new Set<string>();

    for (const [index, req] of requests.entries()) {
      const text = texts[index]!;
      if ('reason' in text) {
        outcomes.push({ ok: false, ...text });
        continue;
      }
      const [row] = await tx
        .select({ q: petMessages, route: pets.replyRoute, petDefault: pets.defaultVisibility })
        .from(petMessages)
        .innerJoin(pets, eq(pets.id, petMessages.petId))
        .where(
          and(
            eq(petMessages.id, req.inReplyTo),
            eq(petMessages.userId, author.userId),
            eq(petMessages.author, 'owner'),
          ),
        )
        .limit(1)
        .for('update', { of: petMessages });
      const decision = decideReplyAdmission(
        row ? questionState(row.q) : null,
        oneOf<PetReplyRoute>(PET_REPLY_ROUTES, row?.route ?? null, 'both'),
        { lane: by, tokenId: author.tokenId, part: req.part, inOfficeHours },
        now,
      );
      if (!decision.ok) {
        const detail =
          decision.detail ??
          (decision.reason === 'unknown_message' ? 'not found; the owner may have deleted it' : undefined);
        outcomes.push({ ok: false, reason: decision.reason, ...(detail ? { detail } : {}) });
        continue;
      }
      const q = row!.q;
      if (decision.kind === 'duplicate') {
        const [prev] = await tx
          .select({ id: petMessages.id, visibility: petMessages.visibility })
          .from(petMessages)
          .where(and(eq(petMessages.inReplyTo, q.id), eq(petMessages.replyPart, req.part)))
          .limit(1);
        outcomes.push(
          prev
            ? {
                ok: true,
                result: 'duplicate',
                messageId: prev.id,
                inReplyTo: q.id,
                petId: q.petId,
                visibility: prev.visibility,
              }
            : { ok: false, reason: 'unknown_message' },
        );
        continue;
      }
      if (storedToday >= LIMITS.petRepliesPerDayMax) {
        outcomes.push({
          ok: false,
          reason: 'daily_limit',
          detail: `at most ${LIMITS.petRepliesPerDayMax} pet replies per day`,
        });
        continue;
      }
      const visibility = petReplyVisibility(
        req.visibility,
        petDefaultVisibility(row!.petDefault, owner.petChatDefaultVisibility),
        q.visibility,
      );
      // Parts of one answer keep their order even when they arrive in the same millisecond.
      const createdAt = new Date(Math.max(now.getTime() + index, q.createdAt.getTime() + req.part));
      const id = newOpaqueId();
      await tx.insert(petMessages).values({
        id,
        petId: q.petId,
        userId: author.userId,
        author: 'pet',
        body: text.text,
        dayKey: localDateKey(createdAt, owner.timezone),
        visibility,
        visibilitySetBy: 'claude',
        source: author.source,
        inReplyTo: q.id,
        replyPart: req.part,
        unread: true,
        oauthClientId: by === 'connector' ? author.clientId : null,
        createdAt,
      });
      storedToday += 1;
      await tx
        .update(petMessages)
        .set({ ...answered(by), replyCount: req.part })
        .where(eq(petMessages.id, q.id));
      if (decision.firstAnswer) await closeEarlier(tx, q, by, author.tokenId, now);
      changedPets.add(q.petId);
      outcomes.push({
        ok: true,
        result: 'created',
        messageId: id,
        inReplyTo: q.id,
        petId: q.petId,
        visibility,
      });
    }

    for (const petId of changedPets) {
      await notifyTown(tx, { v: 1, type: 'pet_thread_changed', user_id: author.userId, pet_id: petId });
    }
    if (changedPets.size > 0) {
      await recordLinkWrite(tx, { userId: author.userId, clientId: author.clientId }, now);
    }
    return outcomes;
  });
}

/** Reasons that depend on the message, not the text: rewriting does not help, so Claude must not retry. */
const FINAL_REASONS: ReadonlySet<PetReplyRejectionReason> = new Set([
  'unknown_message',
  'already_answered',
  'route_not_allowed',
  'outside_office_hours',
  'daily_limit',
]);

function replyDeliveryNote(out: Omit<PostPetReplyOutput, 'delivery_note'>): string {
  const parts: string[] = [];
  const created = out.accepted.filter((a) => a.result === 'created');
  if (created.length > 0) {
    const shared = created.filter((a) => a.visibility === 'company').length;
    parts.push(
      `펫 답장 ${created.length}개를 주인의 ENU Den 펫 대화방에 올렸어요.${shared > 0 ? ` 그중 ${shared}개는 전사 공개라 동료도 날짜와 함께 볼 수 있어요.` : ''}`,
    );
  }
  const duplicates = out.accepted.length - created.length;
  if (duplicates > 0) parts.push(`${duplicates}개는 이미 저장된 답장이라 바꾸지 않았어요.`);
  const rewrite = out.rejected.filter((r) => !FINAL_REASONS.has(r.reason));
  if (rewrite.length > 0) {
    parts.push(
      `${rewrite.map((r) => `replies[${r.index}]`).join(', ')}은(는) reason을 보고 다시 써서 보내 주세요(ENU Den은 문구를 고치지 않아요).`,
    );
  }
  const final = out.rejected.filter((r) => FINAL_REASONS.has(r.reason));
  if (final.length > 0) {
    parts.push(
      `${final.map((r) => `replies[${r.index}]`).join(', ')}은(는) 이미 답했거나 지금 답할 수 없는 메시지예요. 오류가 아니니 다시 보내지 마세요.`,
    );
  }
  if (parts.length === 0) parts.push('저장된 답장이 없어요.');
  return parts.join(' ');
}

/** `post_pet_reply`: the connector lane of `postPetReplies`. */
export async function postPetReply(
  db: Db,
  caller: CallerInfo,
  input: PostPetReplyInput,
  now: Date,
): Promise<PostPetReplyOutput> {
  const outcomes = await postPetReplies(
    db,
    {
      userId: caller.userId,
      clientId: caller.clientId,
      source: SOURCE_HINT_TO_SOURCE[input.source_hint ?? 'scheduled_task'],
      tokenId: null,
    },
    input.replies.map((r) => ({
      inReplyTo: r.in_reply_to.toLowerCase(),
      text: r.text,
      part: r.part ?? 1,
      ...(r.visibility ? { visibility: r.visibility } : {}),
    })),
    now,
  );
  const result: Omit<PostPetReplyOutput, 'delivery_note'> = { accepted: [], rejected: [] };
  for (const [index, o] of outcomes.entries()) {
    if (o.ok) {
      result.accepted.push({
        index,
        message_id: o.messageId,
        in_reply_to: o.inReplyTo,
        result: o.result,
        visibility: o.visibility,
      });
    } else {
      result.rejected.push({ index, reason: o.reason, ...(o.detail ? { detail: o.detail } : {}) });
    }
  }
  return { ...result, delivery_note: replyDeliveryNote(result) };
}
