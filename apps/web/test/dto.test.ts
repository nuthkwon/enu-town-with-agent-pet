import { DEFAULT_AVATAR } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  normalizeAvatar,
  provenanceLabel,
  toChatItemDto,
  toClaudeSummaryDto,
  toDeskDto,
  toPersonDto,
  toWorkLogDto,
  type ProfileRow,
  type WorkLogRow,
} from '@/server/dto';

const now = new Date('2026-10-29T05:00:00Z');
const OWNER = 'owner-1';

function log(over: Partial<WorkLogRow> = {}): WorkLogRow {
  return {
    id: '0199b8a4-5c3e-7b2a-9d41-123456789abc',
    userId: OWNER,
    periodKey: '2026-10-29',
    periodStart: now,
    periodEnd: now,
    summary: '요약',
    tasks: [{ title: '작업', status: 'done' }],
    blockers: [],
    claudeChatSummary: '대화 요약',
    visibility: 'company',
    visibilitySetBy: 'claude',
    chatSummaryVisibility: 'private',
    chatSummaryVisibilitySetBy: 'claude',
    source: 'cowork_scheduled',
    oauthClientId: null,
    claudeWrittenAt: now,
    claudeRevision: 1,
    editedByUser: false,
    userEditedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const author = { name: '김요정', active: true };

describe('provenanceLabel', () => {
  it('names the author and marks owner edits', () => {
    expect(provenanceLabel('김요정', false)).toBe('김요정님의 Claude가 작성');
    expect(provenanceLabel('김요정', true)).toBe('김요정님의 Claude가 작성 · 본인 수정');
  });
});

describe('toWorkLogDto', () => {
  it('shows the owner everything', () => {
    const dto = toWorkLogDto(log({ visibility: 'private' }), author, { userId: OWNER })!;
    expect(dto.claudeChatSummary).toBe('대화 요약');
    expect(dto.provenanceLabel).toBe('김요정님의 Claude가 작성');
  });

  it('never maps a private log for someone else', () => {
    expect(toWorkLogDto(log({ visibility: 'private' }), author, { userId: 'other' })).toBeNull();
    expect(toWorkLogDto(log({ deletedAt: now }), author, { userId: OWNER })).toBeNull();
    expect(toWorkLogDto(log(), { ...author, active: false }, { userId: 'other' })).toBeNull();
  });

  it('hides the chat summary unless both visibilities are company', () => {
    expect(toWorkLogDto(log(), author, { userId: 'other' })!.claudeChatSummary).toBeNull();
    expect(
      toWorkLogDto(log({ chatSummaryVisibility: 'company' }), author, { userId: 'other' })!.claudeChatSummary,
    ).toBe('대화 요약');
    expect(toClaudeSummaryDto(log(), author, { userId: 'other' })).toBeNull();
    expect(
      toClaudeSummaryDto(log({ chatSummaryVisibility: 'company' }), author, { userId: 'other' })?.summary,
    ).toBe('대화 요약');
  });

  it('labels owner edits for everyone but keeps the exact times for the owner', () => {
    const row = log({ editedByUser: true, userEditedAt: now });
    const dto = toWorkLogDto(row, author, { userId: 'other' })!;
    expect(dto.provenanceLabel).toBe('김요정님의 Claude가 작성 · 본인 수정');
    expect(dto.editedByUser).toBe(true);
    expect(dto).toMatchObject({ claudeWrittenAt: null, updatedAt: null, userEditedAt: null });
    expect(dto.periodKey).toBe('2026-10-29');
    const own = toWorkLogDto(row, author, { userId: OWNER })!;
    expect(own).toMatchObject({
      claudeWrittenAt: now.toISOString(),
      updatedAt: now.toISOString(),
      userEditedAt: now.toISOString(),
      editedByUser: true,
    });
  });
});

describe('toChatItemDto', () => {
  it('maps room and DM messages without any location', () => {
    const item = toChatItemDto(
      { id: 'm1', kind: 'room', senderId: 'u1', body: '안녕하세요', createdAt: now },
      '김요정',
    );
    expect(item).toEqual({
      id: 'm1',
      kind: 'room',
      senderId: 'u1',
      senderName: '김요정',
      text: '안녕하세요',
      createdAt: now.toISOString(),
    });
  });
});

describe('people and desks', () => {
  const profile = {
    userId: 'u1',
    displayName: '김요정',
    avatar: { body: 'f', hair: 'bob', hairColor: 'pink', outfit: 'rose', skin: 'light', wings: false },
    petSpecies: 'bunny',
    petName: '몽실',
    title: '과장',
    team: 'qa',
    roleNote: 'SQA',
    statusText: '외근 중',
    shareActivity: true,
    showLive: true,
    manualStatus: 'away',
    manualStatusUntil: now,
    timezone: 'Asia/Seoul',
    defaultLogVisibility: 'company',
    defaultChatSummaryVisibility: null,
    shareDmsWithMyClaude: false,
    nudgesEnabled: true,
    nudgeMinIntervalMin: 25,
    maxBubblesPerDay: 8,
    quietStart: '19:30',
    quietEnd: '08:30',
    linkState: 'linked',
    linkStateChangedAt: null,
    lastWorkLogAt: now,
    onboardingCompletedAt: now,
    createdAt: now,
    updatedAt: now,
  } as ProfileRow;

  it('maps avatar key and team label', () => {
    const p = toPersonDto(profile, 'L4a');
    expect(p.avatarKey).toBe('av-f-bob-pink-rose-light');
    expect(p.teamLabel).toBe('품질보증팀');
    expect(p.team).toBe('qa');
    expect(p.deskId).toBe('L4a');
  });

  it('gives colleagues no status text, status or timestamps (realtime state only, office hours)', () => {
    const p = toPersonDto(profile, 'L4a');
    for (const key of [
      'statusText',
      'lastWorkLogAt',
      'manualStatus',
      'manualStatusUntil',
      'shareActivity',
      'showLive',
    ]) {
      expect(p).not.toHaveProperty(key);
    }
    expect(JSON.stringify(p)).not.toContain('외근');
  });

  it('falls back for unknown teams and malformed avatars', () => {
    const p = toPersonDto(
      { ...profile, team: 'nope', avatar: { body: 'x' } as never, linkState: 'weird' },
      null,
    );
    expect(p.team).toBeNull();
    expect(p.teamLabel).toBe('');
    expect(p.avatar).toEqual(DEFAULT_AVATAR);
    expect(p.linkState).toBe('not_linked');
    expect(normalizeAvatar(null)).toEqual(DEFAULT_AVATAR);
  });

  it('shows the occupant, else the roster label of a free desk', () => {
    expect(
      toDeskDto(
        { deskId: 'L1a', userId: 'u1', labelName: '라벨', team: 'dev' },
        { displayName: '실제', team: 'qa' },
      ),
    ).toEqual({
      deskId: 'L1a',
      userId: 'u1',
      displayName: '실제',
      team: 'qa',
    });
    expect(toDeskDto({ deskId: 'L1b', userId: null, labelName: '라벨', team: 'dev' }, null)).toEqual({
      deskId: 'L1b',
      userId: null,
      displayName: '라벨',
      team: 'dev',
    });
  });
});
