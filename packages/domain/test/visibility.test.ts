import { describe, expect, it } from 'vitest';
import type { ResolvedActivity } from '../src/activity';
import {
  ANY_COLLEAGUE,
  NEUTRAL_PROJECTION,
  canShareActivity,
  canShowLive,
  canViewChatSummary,
  canViewLog,
  canViewLogTimestamps,
  effectiveVisibility,
  minVisibility,
  projectForColleagues,
  type ProjectionCtx,
} from '../src/visibility';

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
    expect(canViewChatSummary({ userId: 'bob' }, log({ chatSummaryVisibility: 'private' }), active)).toBe(
      false,
    );
    expect(canViewChatSummary({ userId: 'bob' }, log({ visibility: 'private' }), active)).toBe(false);
    expect(canViewChatSummary({ userId: 'bob' }, log(), active)).toBe(true);
    expect(canViewChatSummary({ userId: 'owner' }, log({ chatSummaryVisibility: 'private' }), active)).toBe(
      true,
    );
  });

  it('Claude can lower but never raise visibility', () => {
    expect(minVisibility('company', 'private')).toBe('private');
    expect(effectiveVisibility('company', 'private')).toBe('private');
    expect(effectiveVisibility('private', 'company')).toBe('private');
    expect(effectiveVisibility(undefined, 'company')).toBe('company');
    expect(effectiveVisibility('company', null)).toBe('private');
  });
});

describe('activity visibility', () => {
  it('shares Claude-derived activity only on an explicit opt-in of an active author', () => {
    for (const active of [true, false]) {
      expect(canShareActivity({ shareActivity: null }, { active })).toBe(false);
      expect(canShareActivity({ shareActivity: false }, { active })).toBe(false);
      expect(canShareActivity({ shareActivity: true }, { active })).toBe(active);
    }
  });

  it('draws the owner for an open town only with 접속 표시 on', () => {
    expect(canShowLive({ showLive: true })).toBe(true);
    expect(canShowLive({ showLive: false })).toBe(false);
  });

  it('keeps exact log timestamps for the owner', () => {
    expect(canViewLogTimestamps({ userId: 'owner' }, 'owner')).toBe(true);
    expect(canViewLogTimestamps({ userId: 'bob' }, 'owner')).toBe(false);
    expect(canViewLogTimestamps(ANY_COLLEAGUE, 'owner')).toBe(false);
  });

  it('ANY_COLLEAGUE sees exactly what an active colleague may see', () => {
    expect(canViewLog(ANY_COLLEAGUE, log(), active)).toBe(true);
    expect(canViewLog(ANY_COLLEAGUE, log({ visibility: 'private' }), active)).toBe(false);
    expect(canViewLog(ANY_COLLEAGUE, log({ deletedAt: new Date('2026-11-02T00:00:00Z') }), active)).toBe(
      false,
    );
    expect(canViewLog(ANY_COLLEAGUE, log(), { active: false })).toBe(false);
  });
});

describe('projectForColleagues', () => {
  const until = new Date('2026-11-02T02:00:00Z');
  const key = { family: 'meeting' as const, hash: 'f'.repeat(32) };
  const r = (over: Partial<ResolvedActivity> = {}): ResolvedActivity => ({
    shown: true,
    note: 'none',
    activity: 'meeting',
    source: 'calendar',
    until,
    groupKey: key,
    dnd: true,
    ...over,
  });
  const ctx = (over: Partial<ProjectionCtx> = {}): ProjectionCtx => ({
    officeOpen: true,
    connected: true,
    share: true,
    statusText: '외근 후 복귀',
    ...over,
  });

  const resolvedVariants: ResolvedActivity[] = [
    r(),
    r({ shown: false, note: 'away', activity: 'none', source: 'manual', groupKey: null, dnd: false }),
    r({ shown: false, note: 'absent', activity: 'none', source: 'calendar', groupKey: null, dnd: false }),
    r({
      shown: false,
      activity: 'review',
      source: 'claude',
      groupKey: { family: 'work', hash: 'e'.repeat(32) },
    }),
    r({ activity: 'none', source: 'town', until: null, groupKey: null, dnd: false }),
    r({ shown: false, activity: 'none', source: 'none', until: null, groupKey: null, dnd: false }),
  ];

  it('is neutral for everyone while the office is closed, whatever the input', () => {
    for (const resolved of resolvedVariants)
      for (const connected of [true, false])
        for (const share of [true, false])
          for (const statusText of ['', '휴가']) {
            expect(
              projectForColleagues(resolved, ctx({ officeOpen: false, connected, share, statusText })),
            ).toEqual(NEUTRAL_PROJECTION);
          }
    expect(NEUTRAL_PROJECTION).toEqual({
      shown: false,
      online: false,
      note: 'none',
      activity: 'none',
      source: 'none',
      until: null,
      statusText: '',
      groupKey: null,
    });
    expect(Object.isFrozen(NEUTRAL_PROJECTION)).toBe(true);
  });

  it('copies the resolved state during office hours', () => {
    expect(projectForColleagues(r(), ctx())).toEqual({
      shown: true,
      online: true,
      note: 'none',
      activity: 'meeting',
      source: 'calendar',
      until,
      statusText: '외근 후 복귀',
      groupKey: key,
    });
  });

  it('never shows the end or the source of 부재', () => {
    const absent = r({ shown: false, note: 'absent', activity: 'none', source: 'calendar', groupKey: null });
    expect(projectForColleagues(absent, ctx())).toMatchObject({
      note: 'absent',
      until: null,
      source: 'none',
    });
  });

  it('is online only while shown and connected right now', () => {
    // Within the grace or the onDrop hold the director passes connected=false.
    expect(projectForColleagues(r(), ctx({ connected: false })).online).toBe(false);
    expect(projectForColleagues(r({ shown: false }), ctx({ connected: true })).online).toBe(false);
    expect(projectForColleagues(r(), ctx({ connected: true })).online).toBe(true);
  });

  it('shows 상태 문구 only while shown or 자리 비움', () => {
    expect(projectForColleagues(r(), ctx()).statusText).toBe('외근 후 복귀');
    const away = r({ shown: false, note: 'away', activity: 'none', source: 'manual', groupKey: null });
    expect(projectForColleagues(away, ctx()).statusText).toBe('외근 후 복귀');
    const absent = r({ shown: false, note: 'absent', activity: 'none', groupKey: null });
    expect(projectForColleagues(absent, ctx()).statusText).toBe('');
    expect(projectForColleagues(r({ shown: false, note: 'none' }), ctx()).statusText).toBe('');
  });

  it('drops the group key unless the owner shares', () => {
    expect(projectForColleagues(r(), ctx({ share: false })).groupKey).toBeNull();
    expect(projectForColleagues(r(), ctx({ share: true })).groupKey).toEqual(key);
  });
});
