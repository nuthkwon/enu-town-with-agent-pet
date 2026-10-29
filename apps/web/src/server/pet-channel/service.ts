import { createHash, randomInt } from 'node:crypto';
import {
  hashPetChannelToken,
  newPetChannelToken,
  petChannelClientId,
  refreshLinkState,
  revokeClaudeLinks,
  type PetChannelCaller,
} from '@enu/auth';
import {
  audit,
  claudeLinks,
  lockOwnerScope,
  newId,
  petChannelTokens,
  petMessages,
  pets,
  profiles,
  user,
  verification,
  type Db,
  type DbOrTx,
} from '@enu/db';
import { claimUntil, isChannelDeliverable, petDefaultVisibility, type PetQuestionState } from '@enu/domain';
import { formatLocalIso } from '@enu/mcp-tools';
import {
  PAIR_CODE_ALPHABET,
  PET_ANSWER_STATES,
  PET_CHANNEL,
  PET_REPLY_ROUTES,
  normalizePairCode,
  prepareHumanText,
  type PetAnswerState,
  type PetChannelPairInput,
  type PetChannelPairOutput,
  type PetChannelPairingCodeDto,
  type PetChannelPet,
  type PetChannelPlatform,
  type PetChannelPollOutput,
  type PetChannelStatusDto,
  type PetReplyRoute,
} from '@enu/shared';
import { and, asc, eq, gt, gte, inArray, isNull, like } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { HttpError } from '../http';
import { hasAcceptedNotice } from '../queries/me';
import type { Viewer } from '../session';
import { forgetToken, liveTokens, markLive } from './liveness';
import { waitForOwner } from './wake';

/**
 * The Claude Code pet channel (ADR 0006, messenger-spec §4): one-time pairing codes, machine tokens, the long-poll
 * that hands owner messages to a listening Claude Code session, and the owner's status. Replies go through
 * `postPetReplies` (@enu/mcp-tools), the core the connector shares. Polls and replies are never audited.
 */

const DAY_MS = 86_400_000;
const PAIR_PREFIX = 'pet-channel-pair:';
const PAIR_CODE_RE = new RegExp(`^[${PAIR_CODE_ALPHABET}]{8}$`);
/** A parked poll re-checks the database this often (a message written by another web instance). */
const RECHECK_MS = 5_000;
/** At most this many waiting messages are looked at per poll. */
const POLL_SCAN = 50;

const pairIdentifier = (code: string) =>
  `${PAIR_PREFIX}${createHash('sha256').update(code, 'utf8').digest('hex')}`;

function newPairCode(): string {
  return Array.from({ length: 8 }, () => PAIR_CODE_ALPHABET[randomInt(PAIR_CODE_ALPHABET.length)]).join('');
}

/** A new single-use code for `enu-pet pair` (10 minutes). Any earlier code of the owner stops working. */
export async function createPairingCode(
  db: Db,
  viewer: Viewer,
  now = new Date(),
): Promise<PetChannelPairingCodeDto> {
  const code = newPairCode();
  const expiresAt = new Date(now.getTime() + PET_CHANNEL.pairCodeTtlMin * 60_000);
  await db.transaction(async (tx) => {
    await tx
      .delete(verification)
      .where(and(like(verification.identifier, `${PAIR_PREFIX}%`), eq(verification.value, viewer.userId)));
    await tx.insert(verification).values({
      id: newId(),
      identifier: pairIdentifier(code),
      value: viewer.userId,
      expiresAt,
    });
  });
  const shown = `${code.slice(0, 4)}-${code.slice(4)}`;
  return { code: shown, expiresAt: expiresAt.toISOString(), command: `enu-pet pair ${shown}` };
}

const DEFAULT_LABEL: Record<PetChannelPlatform, string> = {
  darwin: 'Claude Code (macOS)',
  linux: 'Claude Code (Linux)',
  win32: 'Claude Code (Windows)',
  other: 'Claude Code',
};

function machineLabel(input: PetChannelPairInput): string {
  if (input.label === undefined) return DEFAULT_LABEL[input.platform];
  const r = prepareHumanText(input.label, { multiline: false, max: 40 });
  return r.ok ? r.text : DEFAULT_LABEL[input.platform];
}

const invalidCode = () => new HttpError(400, 'invalid_code', ko.errors.invalidPairCode);

/** Active (not revoked, not expired) machines of `userId`. */
async function activeMachines(db: DbOrTx, userId: string, now: Date) {
  return db
    .select({
      tokenId: petChannelTokens.id,
      linkId: petChannelTokens.linkId,
      label: petChannelTokens.label,
      platform: petChannelTokens.platform,
      expiresAt: petChannelTokens.expiresAt,
    })
    .from(petChannelTokens)
    .innerJoin(claudeLinks, eq(claudeLinks.id, petChannelTokens.linkId))
    .where(
      and(
        eq(petChannelTokens.userId, userId),
        isNull(claudeLinks.revokedAt),
        gt(petChannelTokens.expiresAt, now),
      ),
    )
    .orderBy(asc(petChannelTokens.createdAt));
}

/**
 * Pairs a machine with a code typed by a person in a terminal. The code is used up by the first attempt, right or
 * wrong for the account state; unknown, used and expired codes all answer the same 400.
 */
export async function pairPetChannel(
  db: Db,
  input: PetChannelPairInput,
  now = new Date(),
): Promise<PetChannelPairOutput> {
  const code = normalizePairCode(input.code);
  if (!PAIR_CODE_RE.test(code)) throw invalidCode();
  const [consumed] = await db
    .delete(verification)
    .where(eq(verification.identifier, pairIdentifier(code)))
    .returning();
  if (!consumed || consumed.expiresAt <= now) throw invalidCode();
  const userId = consumed.value;

  const [owner] = await db
    .select({
      status: user.status,
      displayName: profiles.displayName,
      onboardedAt: profiles.onboardingCompletedAt,
    })
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  if (!owner || owner.status !== 'active') throw invalidCode();
  if (!owner.onboardedAt || !(await hasAcceptedNotice(db, userId))) {
    throw new HttpError(403, 'notice_required', ko.errors.noticeRequired);
  }

  const label = machineLabel(input);
  const token = newPetChannelToken();
  const tokenId = newId();
  const linkId = newId();
  const clientId = petChannelClientId(tokenId);
  const expiresAt = new Date(now.getTime() + PET_CHANNEL.tokenTtlDays * DAY_MS);
  await db.transaction(async (tx) => {
    await lockOwnerScope(tx, 'pet_channel', userId);
    if ((await activeMachines(tx, userId, now)).length >= PET_CHANNEL.maxTokensPerUser) {
      throw new HttpError(409, 'too_many_machines', ko.errors.tooManyMachines);
    }
    await tx.insert(claudeLinks).values({
      id: linkId,
      userId,
      clientId,
      clientName: label,
      clientKind: 'claude_code_channel',
      redirectHost: null,
      consentedAt: now,
    });
    await tx.insert(petChannelTokens).values({
      id: tokenId,
      userId,
      linkId,
      tokenHash: hashPetChannelToken(token),
      label,
      platform: input.platform,
      pluginVersion: input.plugin_version,
      createdAt: now,
      expiresAt,
    });
    await refreshLinkState(tx, userId, now);
    await audit(tx, {
      actorType: 'user',
      actorUserId: userId,
      oauthClientId: clientId,
      action: 'pet_channel.pair',
      targetType: 'claude_link',
      targetId: linkId,
      metadata: { platform: input.platform, pluginVersion: input.plugin_version },
    });
  });
  return {
    token,
    token_id: tokenId,
    link_id: linkId,
    expires_at: expiresAt.toISOString(),
    owner_display_name: owner.displayName ?? '',
  };
}

const asRoute = (v: string): PetReplyRoute =>
  (PET_REPLY_ROUTES as readonly string[]).includes(v) ? (v as PetReplyRoute) : 'both';

function questionState(m: typeof petMessages.$inferSelect): PetQuestionState {
  return {
    answerState: (PET_ANSWER_STATES as readonly string[]).includes(m.answerState ?? '')
      ? (m.answerState as PetAnswerState)
      : 'pending',
    answeredLane: null,
    replyCount: m.replyCount,
    claimedBy: m.claimedBy,
    claimUntil: m.claimUntil,
    createdAt: m.createdAt,
  };
}

/**
 * Takes the owner messages this machine may answer now (oldest first, at most 10) for the claim lease. A poll with
 * nothing to take writes nothing.
 */
async function claimMessages(
  db: Db,
  caller: PetChannelCaller & { ok: true },
  includeHeld: boolean,
  now: Date,
) {
  return db.transaction(async (tx) => {
    // The same lock as replies: a claim and a connector answer never interleave.
    await lockOwnerScope(tx, 'pet_replies', caller.userId);
    const rows = await tx
      .select({ m: petMessages, route: pets.replyRoute })
      .from(petMessages)
      .innerJoin(pets, eq(pets.id, petMessages.petId))
      .where(
        and(
          eq(petMessages.userId, caller.userId),
          eq(petMessages.author, 'owner'),
          inArray(petMessages.answerState, ['pending', 'claimed']),
          inArray(pets.replyRoute, ['channel', 'both']),
          gte(petMessages.createdAt, new Date(now.getTime() - PET_CHANNEL.deliverMaxAgeHours * 3_600_000)),
        ),
      )
      .orderBy(asc(petMessages.createdAt), asc(petMessages.id))
      .limit(POLL_SCAN);
    const take = rows
      .filter((r) =>
        isChannelDeliverable(questionState(r.m), asRoute(r.route), caller.tokenId, now, { includeHeld }),
      )
      .slice(0, PET_CHANNEL.pollBatchMax)
      .map((r) => r.m);
    if (take.length === 0) return [];
    await tx
      .update(petMessages)
      .set({ answerState: 'claimed', claimedBy: caller.tokenId, claimUntil: claimUntil(now) })
      .where(
        inArray(
          petMessages.id,
          take.map((m) => m.id),
        ),
      );
    return take;
  });
}

async function channelPets(db: DbOrTx, userId: string): Promise<PetChannelPet[]> {
  const [profile] = await db
    .select({ v: profiles.petChatDefaultVisibility })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  const rows = await db
    .select()
    .from(pets)
    .where(eq(pets.userId, userId))
    .orderBy(asc(pets.sortOrder), asc(pets.createdAt));
  return rows.map((p) => ({
    pet_id: p.id,
    name: p.name,
    is_default: p.isDefault,
    reply_route: asRoute(p.replyRoute),
    default_visibility: petDefaultVisibility(p.defaultVisibility, profile?.v ?? 'company'),
    role_instructions: p.roleInstructions,
  }));
}

/**
 * The channel long-poll: returns at once when there is something to take, else parks for up to `waitS` seconds and
 * wakes when the owner writes to a pet (or the client goes away).
 */
export async function pollPetChannel(
  db: Db,
  caller: PetChannelCaller & { ok: true },
  input: { wait_s: number; include_held: boolean },
  signal: AbortSignal | undefined,
  clock: () => Date = () => new Date(),
): Promise<PetChannelPollOutput> {
  const start = clock();
  markLive(caller.userId, caller.tokenId, start.getTime());
  const deadline = start.getTime() + input.wait_s * 1000;
  let taken = await claimMessages(db, caller, input.include_held, start);
  while (taken.length === 0 && !signal?.aborted) {
    const left = deadline - clock().getTime();
    if (left <= 0) break;
    await waitForOwner(caller.userId, Math.min(left, RECHECK_MS), signal);
    if (signal?.aborted) break;
    taken = await claimMessages(db, caller, false, clock());
  }
  markLive(caller.userId, caller.tokenId, clock().getTime());
  return {
    messages: taken.map((m) => ({
      message_id: m.id,
      pet_id: m.petId,
      sent_at: formatLocalIso(m.createdAt, caller.timezone),
      text: m.body,
      visibility: m.visibility,
      replies_so_far: m.replyCount,
    })),
    pets: await channelPets(db, caller.userId),
    token_expires_at: caller.expiresAt.toISOString(),
  };
}

/** The machine unpairs itself (`enu-pet unpair`): its link is revoked and what it held is released. */
export async function unpairPetChannel(db: Db, caller: PetChannelCaller & { ok: true }): Promise<void> {
  await revokeClaudeLinks(db, caller.userId, {
    linkId: caller.linkId,
    reason: 'channel_unpaired',
    actor: 'user',
  });
  forgetToken(caller.userId, caller.tokenId);
}

/** Owner-only: paired machines and whether one of them is listening right now (memory only). */
export async function petChannelStatus(
  db: DbOrTx,
  viewer: Viewer,
  now = new Date(),
): Promise<PetChannelStatusDto> {
  const machines = await activeMachines(db, viewer.userId, now);
  const live = liveTokens(viewer.userId, now.getTime());
  return {
    paired: machines.length > 0,
    live: machines.some((m) => live.has(m.tokenId)),
    machines: machines.map((m) => ({
      linkId: m.linkId,
      label: m.label,
      platform: m.platform,
      expiresAt: m.expiresAt.toISOString(),
    })),
  };
}
