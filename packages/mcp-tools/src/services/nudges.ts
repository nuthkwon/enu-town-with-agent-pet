import { audit, newId, notifyTown, petNudges, pets, todos, type Db } from '@enu/db';
import { isQuietTime, prepareNudgeText, resolveNudgeTimes, type NudgePrefs } from '@enu/domain';
import {
  LIMITS,
  NUDGE_POLICY,
  addLocalDays,
  startOfLocalDay,
  type NudgeKind,
  type PostPetNudgesInput,
  type PostPetNudgesOutput,
} from '@enu/shared';
import { and, eq, gte, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { formatKoDateTime } from '../format';
import { lockOwnerScope, recordLinkWrite, type CallerInfo } from '../links';
import { loadOwnerContext, type OwnerContext } from '../owner';

type Rejection = PostPetNudgesOutput['rejected'][number];

interface Candidate {
  index: number;
  text: string;
  kind: NudgeKind;
  priority: number;
  showAfter: Date;
  expiresAt: Date;
  todoRef: string | undefined;
  dedupeKey: string | undefined;
  /** One of the owner's pets; undefined = the default pet. */
  petId: string | undefined;
}

interface Action {
  type: 'insert' | 'update';
  id: string;
  cand: Candidate;
  todoId: string | null;
}

const VISIBILITY_STEP_MS = 5 * 60 * 1000;

/** First moment in [showAfter, expiresAt) outside quiet hours/weekends/holidays, or null. */
export function firstVisibleTime(showAfter: Date, expiresAt: Date, prefs: NudgePrefs): Date | null {
  for (let t = showAfter.getTime(); t < expiresAt.getTime(); t += VISIBILITY_STEP_MS) {
    const d = new Date(t);
    if (!isQuietTime(d, prefs)) return d;
  }
  return null;
}

function nudgePrefs(owner: OwnerContext): NudgePrefs {
  return {
    nudgesEnabled: owner.nudgesEnabled,
    minIntervalMin: owner.nudgeMinIntervalMin,
    maxPerDay: NUDGE_POLICY.maxPerDay,
    quietStart: owner.quietStart,
    quietEnd: owner.quietEnd,
    timeZone: owner.timezone,
    holidays: owner.holidays,
  };
}

/**
 * Queues pet bubble texts written by the owner's Claude. Text is stored exactly as normalized
 * by prepareNudgeText; problems reject single nudges with a reason. ENU Den only decides
 * WHEN the owner sees them (realtime scheduler + nudge policy).
 */
export async function postPetNudges(
  db: Db,
  caller: CallerInfo,
  input: PostPetNudgesInput,
  now: Date,
  ownerIn?: OwnerContext,
): Promise<PostPetNudgesOutput> {
  const owner = ownerIn ?? (await loadOwnerContext(db, caller.userId));
  const tz = owner.timezone;
  const rejected: Rejection[] = [];
  const candidates: Candidate[] = [];

  input.nudges.forEach((n, index) => {
    const prepared = prepareNudgeText(n.text);
    if ('problem' in prepared) {
      rejected.push({
        index,
        reason: prepared.problem.reason,
        ...(prepared.problem.detail ? { detail: prepared.problem.detail } : {}),
      });
      return;
    }
    const times = resolveNudgeTimes(
      now,
      n.show_after ? new Date(n.show_after) : undefined,
      n.expires_at ? new Date(n.expires_at) : undefined,
      tz,
      owner.holidays,
    );
    if (!times.ok) {
      rejected.push({ index, reason: 'invalid_time', detail: times.detail });
      return;
    }
    candidates.push({
      index,
      text: prepared.text,
      kind: n.kind ?? 'reminder',
      priority: n.priority ?? 2,
      showAfter: times.showAfter,
      expiresAt: times.expiresAt,
      todoRef: n.todo_external_ref,
      dedupeKey: n.dedupe_key,
      petId: n.pet_id?.toLowerCase(),
    });
  });

  const result = await db.transaction(async (tx) => {
    await lockOwnerScope(tx, 'nudges', caller.userId);

    const todoRefs = [...new Set(candidates.flatMap((c) => (c.todoRef ? [c.todoRef] : [])))];
    const todoRows = todoRefs.length
      ? await tx
          .select({ id: todos.id, externalRef: todos.externalRef })
          .from(todos)
          .where(and(eq(todos.userId, caller.userId), inArray(todos.externalRef, todoRefs)))
      : [];
    const todoIdByRef = new Map(todoRows.map((r) => [r.externalRef, r.id]));
    const myPets = candidates.some((c) => c.petId)
      ? new Set(
          (await tx.select({ id: pets.id }).from(pets).where(eq(pets.userId, caller.userId))).map(
            (p) => p.id,
          ),
        )
      : new Set<string>();

    const dedupeKeys = [...new Set(candidates.flatMap((c) => (c.dedupeKey ? [c.dedupeKey] : [])))];
    const dedupeRows = dedupeKeys.length
      ? await tx
          .select({ id: petNudges.id, dedupeKey: petNudges.dedupeKey, status: petNudges.status })
          .from(petNudges)
          .where(and(eq(petNudges.userId, caller.userId), inArray(petNudges.dedupeKey, dedupeKeys)))
          .for('update')
      : [];
    const byDedupe = new Map(dedupeRows.map((r) => [r.dedupeKey as string, { id: r.id, status: r.status }]));

    const dayStart = startOfLocalDay(now, tz);
    const dayEnd = addLocalDays(dayStart, tz, 1);
    const [countRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(petNudges)
      .where(
        and(
          eq(petNudges.userId, caller.userId),
          gte(petNudges.createdAt, dayStart),
          lt(petNudges.createdAt, dayEnd),
        ),
      );
    let createdToday = Number(countRow?.n ?? 0);

    const actions: Action[] = [];
    const blockedByOwner: number[] = [];
    for (const cand of candidates) {
      if (cand.petId && !myPets.has(cand.petId)) {
        rejected.push({
          index: cand.index,
          reason: 'unknown_pet',
          detail: "not one of the owner's pets; use pet_inbox.pets[].pet_id or omit pet_id",
        });
        continue;
      }
      let todoId: string | null = null;
      if (cand.todoRef) {
        todoId = todoIdByRef.get(cand.todoRef) ?? null;
        if (!todoId) {
          rejected.push({
            index: cand.index,
            reason: 'unknown_todo',
            detail: 'no to-do with this todo_external_ref; call upsert_todos first',
          });
          continue;
        }
      }
      const existing = cand.dedupeKey ? byDedupe.get(cand.dedupeKey) : undefined;
      if (existing) {
        // The owner already handled this one: never bring it back.
        if (existing.status === 'acked' || existing.status === 'dismissed') {
          blockedByOwner.push(cand.index);
          continue;
        }
        actions.push({ type: 'update', id: existing.id, cand, todoId });
        continue;
      }
      if (createdToday >= LIMITS.nudgesPerDayMax) {
        rejected.push({
          index: cand.index,
          reason: 'daily_limit',
          detail: `at most ${LIMITS.nudgesPerDayMax} nudges per local day`,
        });
        continue;
      }
      createdToday += 1;
      const id = newId();
      actions.push({ type: 'insert', id, cand, todoId });
      if (cand.dedupeKey) byDedupe.set(cand.dedupeKey, { id, status: 'pending' });
    }

    let superseded = 0;
    if (input.replace_pending !== false && actions.length > 0) {
      const keep = [...new Set(actions.filter((a) => a.type === 'update').map((a) => a.id))];
      const rows = await tx
        .update(petNudges)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(petNudges.userId, caller.userId),
            inArray(petNudges.status, ['pending', 'snoozed']),
            keep.length ? notInArray(petNudges.id, keep) : undefined,
          ),
        )
        .returning({ id: petNudges.id });
      superseded = rows.length;
    }

    for (const a of actions) {
      const fields = {
        text: a.cand.text,
        kind: a.cand.kind,
        todoId: a.todoId,
        priority: a.cand.priority,
        showAfter: a.cand.showAfter,
        expiresAt: a.cand.expiresAt,
        status: 'pending',
        showCount: 0,
        snoozedUntil: null,
        oauthClientId: caller.clientId,
        petId: a.cand.petId ?? null,
      };
      if (a.type === 'insert') {
        await tx.insert(petNudges).values({
          id: a.id,
          userId: caller.userId,
          dedupeKey: a.cand.dedupeKey ?? null,
          maxShows: NUDGE_POLICY.maxShows,
          createdAt: now,
          ...fields,
        });
      } else {
        await tx.update(petNudges).set(fields).where(eq(petNudges.id, a.id));
      }
    }

    if (actions.length > 0 || superseded > 0) {
      await notifyTown(tx, { v: 1, type: 'nudges_changed', user_id: caller.userId });
      await recordLinkWrite(tx, caller, now);
    }

    const rejectedByReason: Record<string, number> = {};
    for (const r of rejected) rejectedByReason[r.reason] = (rejectedByReason[r.reason] ?? 0) + 1;
    await audit(tx, {
      actorType: 'claude',
      actorUserId: caller.userId,
      oauthClientId: caller.clientId,
      action: 'pet_nudges.post',
      targetType: 'pet_nudge',
      metadata: {
        submitted: input.nudges.length,
        accepted: actions.length,
        inserted: actions.filter((a) => a.type === 'insert').length,
        updated_in_place: actions.filter((a) => a.type === 'update').length,
        superseded,
        blocked_by_owner: blockedByOwner.length,
        rejected: rejectedByReason,
        text_lengths: actions.map((a) => a.cand.text.length),
      },
    });

    return { actions, superseded, blockedByOwner };
  });

  rejected.sort((a, b) => a.index - b.index);
  return {
    accepted: result.actions.length,
    superseded: result.superseded,
    rejected,
    delivery_note: deliveryNote(
      owner,
      now,
      result.actions,
      result.superseded,
      result.blockedByOwner,
      rejected.length,
    ),
  };
}

function deliveryNote(
  owner: OwnerContext,
  now: Date,
  actions: Action[],
  superseded: number,
  blockedByOwner: number[],
  rejectedCount: number,
): string {
  const parts: string[] = [];
  const prefs = nudgePrefs(owner);
  if (actions.length > 0) {
    parts.push(
      `펫 메시지 ${actions.length}개를 받았어요. 주인이 ENU Den에 접속해 있을 때만, 주인 본인에게만 펫 말풍선으로 보여요(동료에게는 보이지 않아요).`,
    );
    parts.push(
      `조용한 시간(${owner.quietStart}–${owner.quietEnd})과 주말·공휴일에는 보여 주지 않고, 여러 개는 최소 ${owner.nudgeMinIntervalMin}분 간격을 두고 하나씩 보여 줘요. 각 메시지는 만료 시각 전까지 최대 ${NUDGE_POLICY.maxShows}번까지 보여요.`,
    );
    const visible = actions.map((a) => ({
      a,
      at: firstVisibleTime(a.cand.showAfter, a.cand.expiresAt, prefs),
    }));
    const never = visible.filter((v) => v.at === null).map((v) => `nudges[${v.a.cand.index}]`);
    const earliest = visible
      .flatMap((v) => (v.at ? [v.at] : []))
      .sort((x, y) => x.getTime() - y.getTime())[0];
    if (earliest && earliest.getTime() - now.getTime() > VISIBILITY_STEP_MS) {
      parts.push(`가장 빠른 표시 가능 시각은 ${formatKoDateTime(earliest, owner.timezone)}이에요.`);
    }
    if (never.length) {
      parts.push(
        `${never.join(', ')}은(는) 만료 전에 근무 시간이 없어 보이지 않을 거예요. show_after/expires_at을 근무 시간 안으로 조정해 다시 보내 주세요.`,
      );
    }
    if (!owner.nudgesEnabled) parts.push('단, 주인이 펫 알림을 꺼 두어서 다시 켜기 전까지는 보이지 않아요.');
  } else {
    parts.push('새로 등록된 펫 메시지가 없어요.');
  }
  if (superseded > 0)
    parts.push(`아직 보여 주지 않은 이전 메시지 ${superseded}개는 이번 메시지로 대체했어요.`);
  if (blockedByOwner.length) {
    parts.push(
      `${blockedByOwner.map((i) => `nudges[${i}]`).join(', ')}은(는) 주인이 이미 확인했거나 닫은 알림(같은 dedupe_key)이라 다시 보여 주지 않아요.`,
    );
  }
  if (rejectedCount > 0) {
    parts.push(
      `거절된 메시지 ${rejectedCount}개는 rejected의 reason을 보고 다시 써서 보내 주세요(ENU Den은 문구를 고치지 않아요).`,
    );
  }
  return parts.join(' ');
}
