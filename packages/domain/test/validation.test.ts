import { WORK_REF_PATTERN, postActivityInput } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { normalizeWorkRef, prepareActivity, prepareNudgeText, prepareWorkLog } from '../src/validation';

describe('validation (reject, never rewrite)', () => {
  it('accepts friendly nudges exactly as written (only invisible chars removed)', () => {
    expect(prepareNudgeText('14시 회의 전에 견적 검토 마무리해 볼까요?​')).toEqual({
      text: '14시 회의 전에 견적 검토 마무리해 볼까요?',
    });
  });

  it('rejects links, personal data and overlong nudges', () => {
    expect(prepareNudgeText('여기 보세요 https://x.y')).toMatchObject({ problem: { reason: 'url' } });
    expect(prepareNudgeText('010-1234-5678로 전화')).toMatchObject({ problem: { reason: 'pii' } });
    expect(prepareNudgeText('가'.repeat(121))).toMatchObject({ problem: { reason: 'too_long' } });
    expect(prepareNudgeText('   ')).toMatchObject({ problem: { reason: 'empty' } });
  });

  it('reports work-log problems per field', () => {
    const r = prepareWorkLog({
      summary: '고객 연락처 010-9999-8888 확인',
      tasks: [{ title: '배포', status: 'done', ref: 'javascript:alert(1)' }],
      blockers: [],
    });
    expect(r.problems.map((p) => p.field)).toEqual(['summary', 'tasks[0].ref']);
    const ok = prepareWorkLog({
      summary: 'ENU-12 처리',
      tasks: [{ title: 'PR 리뷰', status: 'done', ref: 'ENU-12' }],
      blockers: [],
    });
    expect(ok.problems).toEqual([]);
  });
});

describe('prepareActivity (Asia/Seoul office day)', () => {
  const TZ = 'Asia/Seoul';
  const now = new Date('2026-11-02T10:00:00+09:00');
  const iso = (hm: string, day = '2026-11-02') => `${day}T${hm}:00+09:00`;
  const at = (hm: string, day = '2026-11-02') => new Date(iso(hm, day));
  type Kind = 'meeting' | 'focus' | 'away';
  const block = (kind: Kind, from: string, to: string, ref?: string, toDay = '2026-11-02') => ({
    start_at: iso(from),
    end_at: iso(to, toDay),
    kind,
    ...(ref ? { ref } : {}),
  });
  const prepare = (input: Parameters<typeof prepareActivity>[0], when = now) =>
    prepareActivity(input, when, TZ);

  it('defaults now.until to 90 minutes and clamps it to 120', () => {
    expect(prepare({ now: { kind: 'work' } }).prepared.now).toEqual({
      kind: 'work',
      ref: null,
      until: at('11:30'),
    });
    expect(prepare({ now: { kind: 'docs', until: iso('13:00') } }).prepared.now?.until).toEqual(at('12:00'));
    expect(prepare({ now: { kind: 'docs', until: iso('10:45') } }).prepared.now?.until).toEqual(at('10:45'));
    expect(prepare({ now: null }).prepared.now).toBeNull();
  });

  it('rejects a now report that already ended', () => {
    for (const until of [iso('10:00'), iso('09:00')]) {
      expect(prepare({ now: { kind: 'review', until } }).problems).toEqual([
        { field: 'now.until', reason: 'invalid_time', detail: 'until must be in the future' },
      ]);
    }
  });

  it('keeps the stored list when schedule is omitted and clears it with []', () => {
    expect(prepare({ now: null }).prepared.schedule).toBeNull();
    expect(prepare({ now: null, schedule: [] }).prepared.schedule).toEqual([]);
    expect(prepare({ now: null }).prepared.periodKey).toBe('2026-11-02');
  });

  it('rejects blocks that end before they start', () => {
    const schedule = [block('meeting', '11:00', '11:00'), block('focus', '12:00', '11:00')];
    const { problems } = prepare({ now: null, schedule });
    expect(problems).toEqual([
      { field: 'schedule[0].end_at', reason: 'invalid_time', detail: 'end_at must be after start_at' },
      { field: 'schedule[1].end_at', reason: 'invalid_time', detail: 'end_at must be after start_at' },
    ]);
  });

  it('accepts only blocks inside today, ending at the next midnight at the latest', () => {
    const outside = {
      reason: 'invalid_time',
      detail: 'blocks must lie within 2026-11-02 (Asia/Seoul); cut blocks at midnight',
    };
    const wholeDay = block('away', '00:00', '00:00', undefined, '2026-11-03');
    const lateMeeting = block('meeting', '18:00', '00:00', undefined, '2026-11-03');
    expect(prepare({ now: null, schedule: [wholeDay, lateMeeting] }).problems).toEqual([]);
    const early = { start_at: '2026-11-01T23:30:00+09:00', end_at: iso('09:00'), kind: 'away' as const };
    const late = block('meeting', '23:00', '00:30', undefined, '2026-11-03');
    expect(prepare({ now: null, schedule: [early, late] }).problems).toEqual([
      { field: 'schedule[0]', ...outside },
      { field: 'schedule[1]', ...outside },
    ]);
  });

  it('uses the office day of now in Asia/Seoul, not UTC', () => {
    // 00:30 KST on Nov 3 is still Nov 2 in UTC.
    const afterMidnight = new Date('2026-11-03T00:30:00+09:00');
    const r = prepare({ now: null, schedule: [block('focus', '23:00', '23:30')] }, afterMidnight);
    expect(r.prepared.periodKey).toBe('2026-11-03');
    expect(r.problems).toMatchObject([
      {
        field: 'schedule[0]',
        detail: 'blocks must lie within 2026-11-03 (Asia/Seoul); cut blocks at midnight',
      },
    ]);
    const lastMinute = new Date('2026-11-02T23:59:00+09:00');
    expect(prepare({ now: null, schedule: [block('focus', '23:00', '23:30')] }, lastMinute).problems).toEqual(
      [],
    );
  });

  it('limits meeting and focus blocks to 10 hours; away may span the day', () => {
    const tooLong = { reason: 'invalid_time', detail: 'meeting/focus blocks may last at most 10 hours' };
    expect(prepare({ now: null, schedule: [block('focus', '08:00', '18:00')] }).problems).toEqual([]);
    const schedule = [block('focus', '08:00', '18:01'), block('meeting', '08:00', '19:00')];
    expect(prepare({ now: null, schedule }).problems).toEqual([
      { field: 'schedule[0]', ...tooLong },
      { field: 'schedule[1]', ...tooLong },
    ]);
    expect(prepare({ now: null, schedule: [block('away', '06:00', '23:00')] }).problems).toEqual([]);
  });

  it('allows a ref only on meeting blocks', () => {
    const { problems } = prepare({
      now: null,
      schedule: [
        block('focus', '09:00', '10:00', 'gcal:abc'),
        block('away', '13:00', '18:00', 'gcal:def'),
        block('meeting', '11:00', '12:00', 'gcal:ok'),
      ],
    });
    expect(problems).toEqual([
      { field: 'schedule[0].ref', reason: 'unsupported', detail: 'ref is only for meeting blocks' },
      { field: 'schedule[1].ref', reason: 'unsupported', detail: 'ref is only for meeting blocks' },
    ]);
  });

  it('sorts blocks, drops exact duplicates and lower-cases ref schemes', () => {
    const { prepared, problems } = prepare({
      now: { kind: 'review', ref: 'JIRA:ENU-301' },
      schedule: [
        block('meeting', '14:00', '15:00', 'GCAL:Abc+1@google.com'),
        block('focus', '09:00', '11:00'),
        block('meeting', '14:00', '15:00', 'gcal:Abc+1@google.com'),
        block('meeting', '09:00', '10:00'),
        block('focus', '09:00', '10:00'),
      ],
    });
    expect(problems).toEqual([]);
    expect(prepared.now?.ref).toBe('jira:ENU-301');
    expect(prepared.schedule).toEqual([
      { start: at('09:00'), end: at('10:00'), kind: 'meeting', ref: null },
      { start: at('09:00'), end: at('10:00'), kind: 'focus', ref: null },
      { start: at('09:00'), end: at('11:00'), kind: 'focus', ref: null },
      { start: at('14:00'), end: at('15:00'), kind: 'meeting', ref: 'gcal:Abc+1@google.com' },
    ]);
  });

  it('keeps the id part of a ref verbatim', () => {
    expect(normalizeWorkRef('GitHub:Enu/HMI#42')).toBe('github:Enu/HMI#42');
  });
});

describe('WORK_REF_PATTERN', () => {
  it('accepts iCalUIDs with + = { } and other printable ASCII', () => {
    expect(WORK_REF_PATTERN.test('gcal:040000008200E00074C5B7101A82E0080000000+abc==@google.com')).toBe(true);
    expect(WORK_REF_PATTERN.test('gcal:{3A1B-77}=x')).toBe(true);
    expect(WORK_REF_PATTERN.test('github:enu/hmi#42')).toBe(true);
    expect(WORK_REF_PATTERN.test(`drive:${'x'.repeat(180)}`)).toBe(true);
  });

  it('rejects spaces, missing schemes and ids over 180 characters', () => {
    expect(WORK_REF_PATTERN.test('jira:ENU 301')).toBe(false);
    expect(WORK_REF_PATTERN.test('ENU-301')).toBe(false);
    expect(WORK_REF_PATTERN.test('1x:ENU-301')).toBe(false);
    expect(WORK_REF_PATTERN.test(`drive:${'x'.repeat(181)}`)).toBe(false);
    expect(WORK_REF_PATTERN.test('jira:회의')).toBe(false);
  });

  it('is enforced by the post_activity input schema together with the block limit', () => {
    expect(postActivityInput.safeParse({ now: { kind: 'work', ref: 'jira:ENU 1' } }).success).toBe(false);
    const block = {
      start_at: '2026-11-02T09:00:00+09:00',
      end_at: '2026-11-02T10:00:00+09:00',
      kind: 'focus',
    };
    expect(postActivityInput.safeParse({ now: null, schedule: Array(16).fill(block) }).success).toBe(true);
    expect(postActivityInput.safeParse({ now: null, schedule: Array(17).fill(block) }).success).toBe(false);
    expect(postActivityInput.parse({ now: null })).toEqual({ now: null, source_hint: 'scheduled_task' });
  });
});
