import type { OwnerPetMessageDto, WorkLogDto } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { COMPANION_TIMING, companionState, type CompanionInput } from './companionState';
import { buildTimeline, lastUnreadReply, mergeLogs, prependPage } from './timeline';
import { waitHint } from './waitHint';

const msg = (id: string, dayKey: string, author: 'owner' | 'pet', over: Partial<OwnerPetMessageDto> = {}) =>
  ({
    view: 'owner',
    id,
    petId: 'p',
    author,
    text: id,
    createdAt: `${dayKey}T01:00:00.000Z`,
    dayKey,
    visibility: 'company',
    visibilitySetBy: author === 'pet' ? 'claude' : 'owner',
    source: author === 'pet' ? 'claude_code_channel' : null,
    clientMsgId: author === 'owner' ? id : null,
    inReplyTo: null,
    replyPart: author === 'pet' ? 1 : null,
    answerState: author === 'owner' ? 'answered' : null,
    unread: false,
    ...over,
  }) satisfies OwnerPetMessageDto;

const log = (id: string, periodKey: string) => ({ id, periodKey }) as WorkLogDto;

describe('buildTimeline', () => {
  it('groups by day with the work-log card last and marks runs of one author', () => {
    const t = buildTimeline(
      [
        msg('a', '2026-10-28', 'owner'),
        msg('b', '2026-10-28', 'pet'),
        msg('c', '2026-10-28', 'pet'),
        msg('d', '2026-10-29', 'owner'),
      ],
      [log('l1', '2026-10-28'), log('l2', '2026-10-27')],
    );
    expect(
      t.map((e) => (e.kind === 'message' ? `${e.message.id}${e.firstOfRun ? '*' : ''}` : e.key)),
    ).toEqual([
      'day:2026-10-27',
      'log:l2',
      'day:2026-10-28',
      'a*',
      'b*',
      'c',
      'log:l1',
      'day:2026-10-29',
      'd*',
    ]);
  });

  it('merges older pages without duplicates and finds the newest unread reply', () => {
    const shown = [msg('b', '2026-10-29', 'owner'), msg('c', '2026-10-29', 'pet', { unread: true })];
    expect(
      prependPage(shown, [msg('a', '2026-10-28', 'owner'), msg('b', '2026-10-29', 'owner')]).map((m) => m.id),
    ).toEqual(['a', 'b', 'c']);
    expect(lastUnreadReply(shown)?.id).toBe('c');
    expect(lastUnreadReply([msg('x', '2026-10-29', 'pet')])).toBeNull();
  });
});

describe('mergeLogs', () => {
  it('keeps the cards of older pages and takes the newest page as the truth for its own cards', () => {
    const card = (id: string, periodKey: string, summary = id) => ({ id, periodKey, summary }) as WorkLogDto;
    const shown = [card('a', '2026-10-20'), card('b', '2026-10-28', 'old')];
    const merged = mergeLogs(shown, [card('b', '2026-10-28', 'new'), card('c', '2026-10-29')]);
    expect(merged.map((l) => `${l.id}:${l.summary}`)).toEqual(['a:a', 'b:new', 'c:c']);
  });
});

describe('waitHint', () => {
  const base = {
    route: 'both',
    channelPaired: false,
    channelLive: false,
    linkState: 'linked',
    officeOpen: true,
  } as const;
  it('prefers a listening Claude Code, else the next check-in', () => {
    expect(waitHint({ ...base, channelPaired: true, channelLive: true })).toBe('live');
    expect(waitHint(base)).toBe('checkin');
    expect(waitHint({ ...base, officeOpen: false })).toBe('nextBusinessDay');
    expect(waitHint({ ...base, route: 'checkin', channelLive: true })).toBe('checkin');
  });
  it('explains a channel-only pet and an unconnected owner', () => {
    expect(waitHint({ ...base, route: 'channel' })).toBe('notLinked');
    expect(waitHint({ ...base, route: 'channel', channelPaired: true })).toBe('channelOffline');
    expect(waitHint({ ...base, linkState: 'not_linked' })).toBe('notLinked');
  });
});

describe('companionState', () => {
  const idle: CompanionInput = {
    now: 10_000,
    composer: { focused: false, draftLength: 0, lastKeyAt: null },
    pendingSince: null,
    wait: 'checkin',
    lastReply: null,
    happyUntil: null,
  };
  it('talks for a while after a reply, longer for longer text (capped)', () => {
    const short = companionState({ ...idle, lastReply: { at: 9_000, length: 10 } });
    expect(short).toEqual({ expr: 'talking', nextAt: 9_000 + COMPANION_TIMING.talkBaseMs + 350 });
    const long = companionState({ ...idle, lastReply: { at: 9_000, length: 1000 } });
    expect(long.nextAt).toBe(9_000 + COMPANION_TIMING.talkMaxMs);
    expect(companionState({ ...idle, lastReply: { at: 0, length: 10 } }).expr).toBe('idle');
  });
  it('listens while the owner types, thinks or sleeps while a message waits', () => {
    expect(
      companionState({ ...idle, composer: { focused: true, draftLength: 3, lastKeyAt: 9_900 } }).expr,
    ).toBe('listening');
    expect(
      companionState({ ...idle, composer: { focused: true, draftLength: 0, lastKeyAt: 9_000 } }),
    ).toEqual({
      expr: 'listening',
      nextAt: 9_000 + COMPANION_TIMING.listenAfterKeyMs,
    });
    expect(companionState({ ...idle, pendingSince: 1 }).expr).toBe('thinking');
    expect(companionState({ ...idle, pendingSince: 1, wait: 'nextBusinessDay' }).expr).toBe('sleeping');
    expect(companionState({ ...idle, wait: 'notLinked' }).expr).toBe('sleeping');
    expect(companionState({ ...idle, happyUntil: 12_000 })).toEqual({ expr: 'happy', nextAt: 12_000 });
  });
});

describe('dayLabel', () => {
  it('names calendar dates in Korean, today as 오늘', async () => {
    const { dayLabel } = await import('./dayLabel');
    expect(dayLabel('2026-10-29')).toBe('10월 29일 (목)');
    expect(dayLabel('2026-11-01')).toBe('11월 1일 (일)');
    expect(dayLabel('2026-10-29', '2026-10-29')).toBe('오늘');
    expect(dayLabel('bad')).toBe('bad');
  });
});
