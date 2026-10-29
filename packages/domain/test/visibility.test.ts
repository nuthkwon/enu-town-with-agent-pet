import { describe, expect, it } from 'vitest';
import { canViewChatSummary, canViewLog, effectiveVisibility, minVisibility } from '../src/visibility';

const log = (over: Partial<Parameters<typeof canViewLog>[1]> = {}) => ({
  ownerId: 'owner',
  visibility: 'company' as const,
  chatSummaryVisibility: 'company' as const,
  deletedAt: null,
  ...over,
});
const active = { active: true };

describe('visibility', () => {
  it('owner sees own non-deleted logs regardless of visibility', () => {
    expect(canViewLog({ userId: 'owner' }, log({ visibility: 'private' }), active)).toBe(true);
    expect(canViewLog({ userId: 'owner' }, log({ deletedAt: new Date() }), active)).toBe(false);
  });

  it('colleagues only see company logs of active authors', () => {
    expect(canViewLog({ userId: 'bob' }, log(), active)).toBe(true);
    expect(canViewLog({ userId: 'bob' }, log({ visibility: 'private' }), active)).toBe(false);
    expect(canViewLog({ userId: 'bob' }, log(), { active: false })).toBe(false);
    expect(canViewLog({ userId: 'bob' }, log({ deletedAt: new Date() }), active)).toBe(false);
  });

  it('chat summary is never more visible than its log', () => {
    expect(canViewChatSummary({ userId: 'bob' }, log({ chatSummaryVisibility: 'private' }), active)).toBe(false);
    expect(canViewChatSummary({ userId: 'bob' }, log({ visibility: 'private' }), active)).toBe(false);
    expect(canViewChatSummary({ userId: 'bob' }, log(), active)).toBe(true);
    expect(canViewChatSummary({ userId: 'owner' }, log({ chatSummaryVisibility: 'private' }), active)).toBe(true);
  });

  it('Claude can lower but never raise visibility', () => {
    expect(minVisibility('company', 'private')).toBe('private');
    expect(effectiveVisibility('company', 'private')).toBe('private');
    expect(effectiveVisibility('private', 'company')).toBe('private');
    expect(effectiveVisibility(undefined, 'company')).toBe('company');
    expect(effectiveVisibility('company', null)).toBe('private');
  });
});
