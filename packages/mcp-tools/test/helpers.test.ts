import { LIMITS, NUDGE_POLICY, getMyContextOutput, type GetMyContextOutput } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  ToolError,
  contextSummaryKo,
  errorResult,
  firstVisibleTime,
  formatLocalIso,
  isRealCalendarDate,
  okResult,
  prepareTodoItems,
  resolveSince,
  workLogViewUrl,
} from '../src/index';

const TZ = 'Asia/Seoul';

describe('formatLocalIso', () => {
  it('renders the owner-local wall clock with offset', () => {
    expect(formatLocalIso(new Date('2026-10-29T05:05:09Z'), TZ)).toBe('2026-10-29T14:05:09+09:00');
    expect(formatLocalIso(new Date('2026-10-29T05:05:09Z'), 'UTC')).toBe('2026-10-29T05:05:09+00:00');
    expect(formatLocalIso(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(
      '2026-01-15T07:00:00-05:00',
    );
  });
});

describe('resolveSince', () => {
  const now = new Date('2026-10-29T05:00:00Z');
  it('defaults to 24h and clamps to 7 days / now', () => {
    expect(resolveSince(now, undefined).toISOString()).toBe('2026-10-28T05:00:00.000Z');
    expect(resolveSince(now, '2026-10-01T00:00:00Z').toISOString()).toBe('2026-10-22T05:00:00.000Z');
    expect(resolveSince(now, '2026-10-29T04:00:00+09:00').toISOString()).toBe('2026-10-28T19:00:00.000Z');
    expect(resolveSince(now, '2026-11-01T00:00:00Z').toISOString()).toBe(now.toISOString());
  });
});

describe('prepareTodoItems', () => {
  it('normalizes text and reports item-level problems without editing', () => {
    const { items, problems } = prepareTodoItems([
      { external_ref: 'jira:ENU-1', title: '  견적서\n검토 ', priority: 2, status: 'open' },
      { external_ref: 'jira:ENU-2', title: '고객 010-1234-5678 연락', priority: 2, status: 'open' },
      { external_ref: 'jira:ENU-1', title: '중복', priority: 2, status: 'open' },
      { external_ref: 'gcal:x', title: '회의', due_date: '2026-02-30', priority: 1, status: 'open' },
      { external_ref: 'gcal:y', title: 'https://evil.example 열기', priority: 3, status: 'done' },
    ]);
    expect(items[0]?.title).toBe('견적서 검토');
    expect(problems).toEqual([
      { index: 1, field: 'title', reason: 'pii', detail: 'contains phone' },
      { index: 2, field: 'external_ref', reason: 'duplicate', detail: 'same external_ref as items[0]' },
      { index: 3, field: 'due_date', reason: 'invalid_time', detail: 'not a real calendar date' },
      { index: 4, field: 'title', reason: 'url' },
    ]);
  });

  it('knows real calendar dates', () => {
    expect(isRealCalendarDate('2026-02-28')).toBe(true);
    expect(isRealCalendarDate('2028-02-29')).toBe(true);
    expect(isRealCalendarDate('2026-02-29')).toBe(false);
    expect(isRealCalendarDate('2026-13-01')).toBe(false);
  });
});

describe('firstVisibleTime', () => {
  const prefs = {
    nudgesEnabled: true,
    minIntervalMin: 25,
    maxPerDay: NUDGE_POLICY.maxPerDay,
    quietStart: '19:30',
    quietEnd: '08:30',
    timeZone: TZ,
    holidays: new Set<string>(),
  };
  it('skips quiet hours and weekends', () => {
    // Thu 2026-10-29 21:00 KST -> Fri 08:30 KST
    expect(
      firstVisibleTime(
        new Date('2026-10-29T12:00:00Z'),
        new Date('2026-10-30T10:00:00Z'),
        prefs,
      )?.toISOString(),
    ).toBe('2026-10-29T23:30:00.000Z');
    // Fri 21:00 KST with 24h lifetime never reaches Monday.
    expect(
      firstVisibleTime(new Date('2026-10-30T12:00:00Z'), new Date('2026-10-31T12:00:00Z'), prefs),
    ).toBeNull();
  });
});

describe('results', () => {
  it('error results are text-only with a JSON line', () => {
    const r = errorResult(
      new ToolError('validation_failed', 'rejected', { problems: [{ field: 'summary', reason: 'pii' }] }),
    );
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
    const text = (r.content[0] as { text: string }).text;
    expect(text.split('\n')[0]).toBe('rejected');
    expect(JSON.parse(text.split('\n')[1]!)).toEqual({
      error: 'validation_failed',
      message: 'rejected',
      problems: [{ field: 'summary', reason: 'pii' }],
    });
  });

  it('keeps get_my_context under the tool result limit by dropping the least important items', () => {
    const big: GetMyContextOutput = {
      skip: false,
      instructions_version: 'x',
      now_local: '2026-10-29T14:00:00+09:00',
      today: '2026-10-29',
      link: { state: 'linked', last_work_log_at: null },
      open_todos: Array.from({ length: 50 }, (_, i) => ({
        external_ref: `jira:ENU-${i}`.padEnd(150, 'x'),
        title: '가'.repeat(120),
        due_at: null,
        due_date: null,
        priority: 2,
        status: 'open' as const,
        status_source: 'claude' as const,
      })),
      town_messages: {
        shared: true,
        unread_count: 20,
        items: Array.from({ length: 20 }, (_, i) => ({
          message_id: String(i),
          from_display_name: '동료',
          sent_at: '2026-10-29T01:00:00.000Z',
          untrusted_text: '나'.repeat(300),
        })),
      },
    };
    const res = okResult(contextSummaryKo, big, (o) => {
      if (o.town_messages?.items.length) return o.town_messages.items.shift() !== undefined;
      return o.open_todos?.pop() !== undefined;
    });
    const total = res.content.reduce((n, c) => n + ((c as { text?: string }).text?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(LIMITS.toolResultMaxChars);
    expect((res.content[0] as { text: string }).text).toContain('생략');
    expect(getMyContextOutput.safeParse(res.structuredContent).success).toBe(true);
    expect((res.content[1] as { text: string }).text).toBe(JSON.stringify(res.structuredContent));
  });

  it('builds view urls without double slashes', () => {
    expect(workLogViewUrl('https://den.example/', 'abc')).toBe('https://den.example/me?log=abc');
  });
});
