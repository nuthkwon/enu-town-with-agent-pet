import { WORK_REQUEST_KINDS } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { isSendEnter, mergeLine, type ChatLine } from './chatLogic';
import { workRequestDraft, workRequestsFor } from './workRequests';

const ids = (team: string | null) => workRequestsFor(team).map((k) => k.id);

describe('workRequestsFor', () => {
  it('offers SQA review requests only for 품질보증팀, first', () => {
    expect(ids('qa')).toEqual(['review', 'question', 'meeting']);
  });

  it('offers team-specific kinds for design, dev and mgmt', () => {
    expect(ids('design')[0]).toBe('config');
    expect(ids('dev')[0]).toBe('build');
    expect(ids('mgmt')[0]).toBe('report');
    expect(ids('dev')).not.toContain('review');
  });

  it('always offers the generic kinds (teams: null), even without a team', () => {
    const generic = WORK_REQUEST_KINDS.filter((k) => k.teams === null).map((k) => k.id);
    expect(ids(null)).toEqual(generic);
    expect(ids('support')).toEqual(generic);
  });

  it('drafts are the template only (never auto-filled or sent)', () => {
    expect(workRequestDraft('review')).toBe('[검토 요청] 대상 산출물: \n요청 내용: ');
    expect(workRequestDraft('nope')).toBe('');
  });
});

const line = (over: Partial<ChatLine>): ChatLine => ({
  key: 'k',
  id: null,
  clientMsgId: null,
  kind: 'nearby',
  fromUserId: 'me',
  fromName: '나',
  text: '안녕',
  createdAt: '2026-10-29T01:00:00Z',
  state: 'sent',
  ...over,
});

describe('chat helpers', () => {
  it('replaces my pending line with the server echo and ignores duplicates', () => {
    const pending = line({ key: 'c1', clientMsgId: 'c1', state: 'pending' });
    const echo = line({ key: 'm1', id: 'm1' });
    const merged = mergeLine([pending], echo, 'me');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'm1', state: 'sent', key: 'c1' });
    expect(mergeLine(merged, echo, 'me')).toHaveLength(1);
    expect(mergeLine(merged, line({ key: 'm2', id: 'm2', fromUserId: 'you' }), 'me')).toHaveLength(2);
  });

  it('sends on Enter but never while composing Hangul', () => {
    expect(isSendEnter({ key: 'Enter', shiftKey: false, nativeEvent: {} })).toBe(true);
    expect(isSendEnter({ key: 'Enter', shiftKey: true, nativeEvent: {} })).toBe(false);
    expect(isSendEnter({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
    expect(isSendEnter({ key: 'Enter', shiftKey: false, nativeEvent: {}, keyCode: 229 })).toBe(false);
    expect(isSendEnter({ key: 'a', shiftKey: false, nativeEvent: {} })).toBe(false);
  });
});
