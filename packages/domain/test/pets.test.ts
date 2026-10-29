import { LIMITS, PET_CHANNEL, PET_REPLY_SOURCES, VISIBILITIES } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  canCreatePet,
  decideReplyAdmission,
  isChannelDeliverable,
  isClaimLive,
  isClosedByLaterAnswer,
  isConnectorListable,
  laneOf,
  petLookProblems,
  routeAllows,
  type PetQuestionState,
  type ReplyAttempt,
} from '../src/pets';
import {
  ANY_COLLEAGUE,
  canChatWithPet,
  canViewPet,
  canViewPetMessage,
  canViewPetPrivateFields,
  petDefaultVisibility,
  petMessageVisibility,
  petReplyVisibility,
} from '../src/visibility';
import {
  prepareOwnerPetText,
  preparePetName,
  preparePetReplyText,
  preparePetRoleInstructions,
} from '../src/validation';

const NOW = new Date('2026-11-02T10:00:00+09:00');
const MIN = 60_000;
const active = { active: true };
const inactive = { active: false };
const owner = { userId: 'owner' };
const colleague = { userId: 'bob' };

describe('pets: how many and which looks', () => {
  it('allows up to the per-person limit, the default pet included', () => {
    expect(canCreatePet(LIMITS.petsPerOwnerMax - 1)).toBe(true);
    expect(canCreatePet(LIMITS.petsPerOwnerMax)).toBe(false);
  });

  it('keeps the base look for default pets with a species unique among active members', () => {
    const ctx = { ownOtherLooks: [], othersDefaultSpecies: new Set(['fox']) };
    expect(petLookProblems({ species: 'cat', tint: 'base', isDefault: true }, ctx)).toEqual([]);
    expect(petLookProblems({ species: 'fox', tint: 'base', isDefault: true }, ctx)).toEqual(['pet_taken']);
    expect(petLookProblems({ species: 'cat', tint: 'mint', isDefault: true }, ctx)).toEqual([
      'default_must_be_base',
    ]);
  });

  it('lets extra pets reuse any species with a tint, never twice the same look per owner', () => {
    const ctx = {
      ownOtherLooks: [{ species: 'fox', tint: 'mint' as const }],
      othersDefaultSpecies: new Set(['fox']),
    };
    expect(petLookProblems({ species: 'fox', tint: 'rose', isDefault: false }, ctx)).toEqual([]);
    expect(petLookProblems({ species: 'fox', tint: 'mint', isDefault: false }, ctx)).toEqual(['look_taken']);
    expect(petLookProblems({ species: 'cat', tint: 'base', isDefault: false }, ctx)).toEqual([
      'base_reserved',
    ]);
  });
});

describe('pets: visibility (the only rules colleagues meet)', () => {
  const m = (over: Partial<Parameters<typeof canViewPetMessage>[1]> = {}) => ({
    ownerId: 'owner',
    author: 'owner' as const,
    visibility: 'company' as const,
    ...over,
  });

  it('shows pet names and looks to everyone while the owner is active', () => {
    expect(canViewPet(colleague, { ownerId: 'owner' }, active)).toBe(true);
    expect(canViewPet(colleague, { ownerId: 'owner' }, inactive)).toBe(false);
    expect(canViewPet(owner, { ownerId: 'owner' }, inactive)).toBe(true);
  });

  it('lets only the owner chat with a pet', () => {
    expect(canChatWithPet(owner, { ownerId: 'owner' }, active)).toBe(true);
    expect(canChatWithPet(colleague, { ownerId: 'owner' }, active)).toBe(false);
    expect(canChatWithPet(owner, { ownerId: 'owner' }, inactive)).toBe(false);
  });

  it('keeps role instructions, routes, times and the channel state owner-only (admins included)', () => {
    expect(canViewPetPrivateFields(owner, 'owner')).toBe(true);
    expect(canViewPetPrivateFields(colleague, 'owner')).toBe(false);
    expect(canViewPetPrivateFields(ANY_COLLEAGUE, 'owner')).toBe(false);
  });

  // owner/colleague × visibility × author × parent × account state
  for (const visibility of VISIBILITIES) {
    for (const parent of [null, 'company', 'private'] as const) {
      for (const state of [active, inactive]) {
        const author = parent === null ? 'owner' : 'pet';
        const msg = m({ visibility, author });
        const p = parent === null ? null : { visibility: parent };
        it(`${author} message, ${visibility}, question ${parent ?? '-'}, author ${state.active ? 'active' : 'inactive'}`, () => {
          expect(canViewPetMessage(owner, msg, p, state)).toBe(true);
          const expected =
            state.active && visibility === 'company' && (parent === null || parent === 'company');
          expect(canViewPetMessage(colleague, msg, p, state)).toBe(expected);
          expect(canViewPetMessage(ANY_COLLEAGUE, msg, p, state)).toBe(expected);
        });
      }
    }
  }

  it('hides a reply whose question is hidden or missing', () => {
    expect(canViewPetMessage(colleague, m({ author: 'pet' }), { visibility: 'private' }, active)).toBe(false);
    expect(canViewPetMessage(colleague, m({ author: 'pet' }), null, active)).toBe(false);
  });

  it('defaults to the pet, then the profile; the owner chooses freely per message', () => {
    expect(petDefaultVisibility(null, 'company')).toBe('company');
    expect(petDefaultVisibility('private', 'company')).toBe('private');
    expect(petMessageVisibility(undefined, 'private')).toBe('private');
    expect(petMessageVisibility('company', 'private')).toBe('company');
  });

  it('lets Claude only lower a reply below the pet default and its question', () => {
    expect(petReplyVisibility(undefined, 'company', 'company')).toBe('company');
    expect(petReplyVisibility('private', 'company', 'company')).toBe('private');
    expect(petReplyVisibility('company', 'private', 'company')).toBe('private');
    expect(petReplyVisibility('company', 'company', 'private')).toBe('private');
  });
});

describe('pets: text (rejected, never rewritten)', () => {
  it('accepts a reply as written and keeps its line breaks', () => {
    expect(preparePetReplyText('네, 오늘 할 일 세 가지예요.\n1. 리뷰\n2. 배포')).toEqual({
      text: '네, 오늘 할 일 세 가지예요.\n1. 리뷰\n2. 배포',
    });
  });

  it('rejects links and personal data in replies whatever the visibility', () => {
    expect(preparePetReplyText('여기 https://x.y 보세요')).toMatchObject({ problem: { reason: 'url' } });
    expect(preparePetReplyText('010-1234-5678로 연락')).toMatchObject({ problem: { reason: 'pii' } });
    expect(preparePetReplyText('가'.repeat(LIMITS.petReplyMax + 1))).toMatchObject({
      problem: { reason: 'too_long' },
    });
    expect(preparePetReplyText('  ')).toMatchObject({ problem: { reason: 'empty' } });
  });

  it('lets the owner paste links and flags personal data for the 나만 보기 choice', () => {
    expect(prepareOwnerPetText('이 문서 봐줘 https://x.y')).toEqual({
      ok: true,
      text: '이 문서 봐줘 https://x.y',
      pii: [],
    });
    expect(prepareOwnerPetText('010-1234-5678 확인')).toMatchObject({ ok: true, pii: ['phone'] });
    expect(prepareOwnerPetText('가'.repeat(LIMITS.petMessageMax + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('checks names and role instructions without editing them', () => {
    expect(preparePetName(' 코코 ')).toEqual({ ok: true, name: '코코' });
    expect(preparePetName('가'.repeat(LIMITS.petNameMax + 1))).toEqual({ ok: false, reason: 'too_long' });
    expect(preparePetRoleInstructions('   ')).toEqual({ ok: true, text: null });
    expect(preparePetRoleInstructions(null)).toEqual({ ok: true, text: null });
    expect(preparePetRoleInstructions('코드 리뷰를 도와줘.')).toEqual({
      ok: true,
      text: '코드 리뷰를 도와줘.',
    });
  });
});

describe('pets: who answers an owner message', () => {
  const q = (over: Partial<PetQuestionState> = {}): PetQuestionState => ({
    answerState: 'pending',
    answeredLane: null,
    replyCount: 0,
    claimedBy: null,
    claimUntil: null,
    createdAt: new Date(NOW.getTime() - 5 * MIN),
    ...over,
  });
  const channel = (over: Partial<ReplyAttempt> = {}): ReplyAttempt => ({
    lane: 'channel',
    tokenId: 't1',
    part: 1,
    inOfficeHours: false,
    ...over,
  });
  const connector = (over: Partial<ReplyAttempt> = {}): ReplyAttempt => ({
    lane: 'connector',
    tokenId: null,
    part: 1,
    inOfficeHours: true,
    ...over,
  });
  const held = (by: string) =>
    q({ answerState: 'claimed', claimedBy: by, claimUntil: new Date(NOW.getTime() + MIN) });

  it('maps reply sources to lanes and routes to lanes', () => {
    expect(PET_REPLY_SOURCES.map(laneOf)).toEqual(['channel', 'connector', 'connector', 'connector']);
    expect(routeAllows('both', 'channel') && routeAllows('both', 'connector')).toBe(true);
    expect(routeAllows('channel', 'connector')).toBe(false);
    expect(routeAllows('checkin', 'channel')).toBe(false);
  });

  it('answers through the channel at any hour, through the connector only in office hours', () => {
    expect(decideReplyAdmission(q(), 'both', channel(), NOW)).toEqual({
      ok: true,
      kind: 'create',
      firstAnswer: true,
    });
    expect(decideReplyAdmission(q(), 'both', connector({ inOfficeHours: false }), NOW)).toMatchObject({
      ok: false,
      reason: 'outside_office_hours',
    });
  });

  it('respects the pet reply route', () => {
    expect(decideReplyAdmission(q(), 'channel', connector(), NOW)).toMatchObject({
      reason: 'route_not_allowed',
    });
    expect(decideReplyAdmission(q(), 'checkin', channel(), NOW)).toMatchObject({
      reason: 'route_not_allowed',
    });
  });

  it('never lets the connector answer a message a live channel holds', () => {
    expect(decideReplyAdmission(held('t1'), 'both', connector(), NOW)).toMatchObject({
      reason: 'already_answered',
    });
    expect(decideReplyAdmission(held('t2'), 'both', channel(), NOW)).toMatchObject({
      reason: 'already_answered',
    });
    expect(decideReplyAdmission(held('t1'), 'both', channel(), NOW)).toMatchObject({
      ok: true,
      kind: 'create',
    });
  });

  it('frees an expired hold', () => {
    const expired = q({ answerState: 'claimed', claimedBy: 't2', claimUntil: new Date(NOW.getTime() - 1) });
    expect(isClaimLive(expired, NOW)).toBe(false);
    expect(decideReplyAdmission(expired, 'both', connector(), NOW)).toMatchObject({
      ok: true,
      kind: 'create',
    });
  });

  it('keeps the first answer: same lane may add parts in order, the other lane is refused', () => {
    const answered = q({ answerState: 'answered', answeredLane: 'channel', replyCount: 1 });
    expect(decideReplyAdmission(answered, 'both', channel({ part: 2 }), NOW)).toEqual({
      ok: true,
      kind: 'create',
      firstAnswer: false,
    });
    expect(decideReplyAdmission(answered, 'both', connector({ part: 2 }), NOW)).toMatchObject({
      reason: 'already_answered',
    });
    expect(decideReplyAdmission(answered, 'both', channel({ part: 3 }), NOW)).toMatchObject({
      reason: 'unknown_message',
    });
  });

  it('treats a repeated part as a duplicate (Claude text is never overwritten)', () => {
    const answered = q({ answerState: 'answered', answeredLane: 'connector', replyCount: 1 });
    expect(decideReplyAdmission(answered, 'both', connector(), NOW)).toEqual({ ok: true, kind: 'duplicate' });
    expect(decideReplyAdmission(null, 'both', connector(), NOW)).toMatchObject({ reason: 'unknown_message' });
  });

  it('delivers to a channel only what nobody else holds, while it is recent', () => {
    expect(isChannelDeliverable(q(), 'both', 't1', NOW)).toBe(true);
    expect(isChannelDeliverable(held('t1'), 'both', 't1', NOW)).toBe(true);
    expect(isChannelDeliverable(held('t2'), 'both', 't1', NOW)).toBe(false);
    expect(isChannelDeliverable(q(), 'checkin', 't1', NOW)).toBe(false);
    const old = q({ createdAt: new Date(NOW.getTime() - (PET_CHANNEL.deliverMaxAgeHours * 60 + 1) * MIN) });
    expect(isChannelDeliverable(old, 'both', 't1', NOW)).toBe(false);
  });

  it('lists for the connector what is unanswered and not held live', () => {
    expect(isConnectorListable(q(), 'both', NOW)).toBe(true);
    expect(isConnectorListable(held('t1'), 'both', NOW)).toBe(false);
    expect(isConnectorListable(q(), 'channel', NOW)).toBe(false);
    expect(isConnectorListable(q({ answerState: 'answered', answeredLane: 'channel' }), 'both', NOW)).toBe(
      false,
    );
  });

  it('closes earlier messages of the pet on a first answer unless another machine holds them', () => {
    expect(isClosedByLaterAnswer(q(), null, NOW)).toBe(true);
    expect(isClosedByLaterAnswer(held('t1'), 't1', NOW)).toBe(true);
    expect(isClosedByLaterAnswer(held('t2'), 't1', NOW)).toBe(false);
    expect(isClosedByLaterAnswer(held('t2'), null, NOW)).toBe(false);
  });
});
