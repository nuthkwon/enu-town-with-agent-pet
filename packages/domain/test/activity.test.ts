import { MANUAL_STATUSES, type ManualStatus } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  currentBlock,
  hasWorkTask,
  isOfficeOpen,
  manualStatusUntil,
  officeDayBounds,
  resolveActivity,
  type ActivityInputs,
  type NowIn,
  type ResolvedActivity,
  type ScheduleBlockIn,
} from '../src/activity';
import { ANY_COLLEAGUE, canViewLog } from '../src/visibility';

const TZ = 'Asia/Seoul';
/** Wall-clock time in Seoul; 2026-11-02 is a Monday. */
const kst = (hm: string, day = '2026-11-02') => new Date(`${day}T${hm}:00+09:00`);
const now = kst('10:00');

const block = (kind: ScheduleBlockIn['kind'], from: string, to: string, refHash: string | null = null): ScheduleBlockIn => ({
  start: kst(from),
  end: kst(to),
  kind,
  refHash,
});
const report = (over: { now?: NowIn | null; schedule?: ScheduleBlockIn[] } = {}) => ({
  now: over.now ?? null,
  schedule: over.schedule ?? [],
});
const base: ActivityInputs = { now, live: false, manual: null, share: true, report: null, todayLog: null };
const resolve = (over: Partial<ActivityInputs>) => resolveActivity({ ...base, ...over });

const manualUntil = kst('11:00');
const meetingRef = 'a'.repeat(32);
const workRef = 'b'.repeat(32);
const fresh: NowIn = { kind: 'review', refHash: workRef, until: kst('11:30') };
const workedLog = { colleagueVisible: true, hasWorkTask: true };

describe('resolveActivity: precedence rows 2-10', () => {
  const rows: [string, Partial<ActivityInputs>, ResolvedActivity][] = [
    [
      '2 manual away hides with a plate note',
      { manual: { status: 'away', until: manualUntil }, live: true },
      { shown: false, note: 'away', activity: 'none', source: 'manual', until: manualUntil, groupKey: null, dnd: false },
    ],
    [
      '3 manual status draws',
      { manual: { status: 'break', until: manualUntil } },
      { shown: true, note: 'none', activity: 'break', source: 'manual', until: manualUntil, groupKey: null, dnd: false },
    ],
    [
      '3 manual meeting joins the current meeting block',
      {
        manual: { status: 'meeting', until: manualUntil },
        report: report({ schedule: [block('focus', '09:00', '12:00'), block('meeting', '09:30', '10:30', meetingRef)] }),
      },
      {
        shown: true,
        note: 'none',
        activity: 'meeting',
        source: 'manual',
        until: manualUntil,
        groupKey: { family: 'meeting', hash: meetingRef },
        dnd: true,
      },
    ],
    [
      '4 calendar away hides as absent, even while live',
      { live: true, report: report({ schedule: [block('away', '00:00', '18:00'), block('meeting', '09:30', '10:30', meetingRef)] }) },
      { shown: false, note: 'absent', activity: 'none', source: 'calendar', until: kst('18:00'), groupKey: null, dnd: false },
    ],
    [
      '5 calendar meeting draws with its meeting key',
      { report: report({ schedule: [block('meeting', '09:30', '10:30', meetingRef)] }) },
      {
        shown: true,
        note: 'none',
        activity: 'meeting',
        source: 'calendar',
        until: kst('10:30'),
        groupKey: { family: 'meeting', hash: meetingRef },
        dnd: true,
      },
    ],
    [
      '5 a meeting without a ref has no key',
      { report: report({ schedule: [block('meeting', '09:30', '10:30')] }) },
      { shown: true, note: 'none', activity: 'meeting', source: 'calendar', until: kst('10:30'), groupKey: null, dnd: true },
    ],
    [
      '6 calendar focus draws',
      { report: report({ schedule: [block('focus', '10:00', '12:00')] }) },
      { shown: true, note: 'none', activity: 'focus', source: 'calendar', until: kst('12:00'), groupKey: null, dnd: true },
    ],
    [
      '7 a fresh now report labels a live avatar',
      { live: true, report: report({ now: fresh }) },
      {
        shown: true,
        note: 'none',
        activity: 'review',
        source: 'claude',
        until: fresh.until,
        groupKey: { family: 'work', hash: workRef },
        dnd: false,
      },
    ],
    [
      '8 a colleague-visible log with work labels a live avatar',
      { live: true, todayLog: workedLog },
      { shown: true, note: 'none', activity: 'today', source: 'work_log', until: null, groupKey: null, dnd: false },
    ],
    [
      '9 live draws with the town as source',
      { live: true },
      { shown: true, note: 'none', activity: 'none', source: 'town', until: null, groupKey: null, dnd: false },
    ],
    [
      '10 otherwise hidden with nothing',
      {},
      { shown: false, note: 'none', activity: 'none', source: 'none', until: null, groupKey: null, dnd: false },
    ],
  ];
  it.each(rows)('%s', (_name, over, expected) => {
    expect(resolve(over)).toEqual(expected);
  });

  it('gives every manual status its own activity; focus and meeting are DND', () => {
    for (const status of MANUAL_STATUSES.filter((s) => s !== 'away')) {
      const r = resolve({ manual: { status, until: manualUntil } });
      expect(r).toMatchObject({ shown: true, activity: status, source: 'manual', groupKey: null });
      expect(r.dnd).toBe(status === 'focus' || status === 'meeting');
    }
  });
});

describe('resolveActivity: combinations', () => {
  const everything = report({
    now: fresh,
    schedule: [block('meeting', '09:30', '10:30', meetingRef), block('focus', '09:00', '12:00')],
  });

  it('manual beats blocks', () => {
    expect(resolve({ manual: { status: 'available', until: manualUntil }, report: everything })).toMatchObject({
      activity: 'available',
      source: 'manual',
      groupKey: null,
    });
    const absent = report({ schedule: [block('away', '00:00', '24:00')] });
    expect(resolve({ manual: { status: 'focus', until: manualUntil }, report: absent })).toMatchObject({
      shown: true,
      activity: 'focus',
    });
  });

  it('an away block beats live, a now report and the log', () => {
    const r = report({ now: fresh, schedule: [block('away', '08:00', '12:00')] });
    expect(resolve({ live: true, report: r, todayLog: workedLog })).toMatchObject({ shown: false, note: 'absent' });
  });

  it('meeting > focus > now > log > live', () => {
    const at = { live: true, todayLog: workedLog };
    expect(resolve({ ...at, report: everything }).activity).toBe('meeting');
    expect(resolve({ ...at, report: report({ now: fresh, schedule: [block('focus', '09:00', '12:00')] }) }).activity).toBe('focus');
    expect(resolve({ ...at, report: report({ now: fresh }) }).activity).toBe('review');
    expect(resolve({ ...at, report: report() }).activity).toBe('today');
    expect(resolve({ live: true, report: report() }).source).toBe('town');
  });

  it('a now report or a log only labels: shown follows live', () => {
    for (const live of [false, true]) {
      expect(resolve({ live, report: report({ now: fresh }) })).toMatchObject({
        shown: live,
        note: 'none',
        activity: 'review',
        source: 'claude',
      });
      expect(resolve({ live, todayLog: workedLog })).toMatchObject({
        shown: live,
        note: 'none',
        activity: 'today',
        source: 'work_log',
      });
    }
  });

  it('share=false ignores every Claude input, including the log', () => {
    expect(resolve({ share: false, report: everything, todayLog: workedLog })).toMatchObject({
      shown: false,
      activity: 'none',
      source: 'none',
    });
    const absent = report({ schedule: [block('away', '00:00', '24:00')] });
    expect(resolve({ share: false, live: true, report: absent })).toMatchObject({ shown: true, source: 'town' });
    expect(
      resolve({ share: false, manual: { status: 'meeting', until: manualUntil }, report: everything }).groupKey,
    ).toBeNull();
  });

  it('ignores an expired manual status', () => {
    const expired = { status: 'away' as const, until: now };
    expect(resolve({ manual: expired, live: true })).toMatchObject({ shown: true, source: 'town' });
  });

  it('a now report at its until is not fresh', () => {
    expect(resolve({ live: true, report: report({ now: { ...fresh, until: now } }) })).toMatchObject({ source: 'town' });
  });

  it('a planned-only, private or deleted log gives no label', () => {
    const log = (over: Partial<Parameters<typeof canViewLog>[1]> = {}) => ({
      ownerId: 'owner',
      visibility: 'company' as const,
      chatSummaryVisibility: 'private' as const,
      deletedAt: null,
      ...over,
    });
    const todayLog = (l: ReturnType<typeof log>, tasks: { status: string }[]) => ({
      colleagueVisible: canViewLog(ANY_COLLEAGUE, l, { active: true }),
      hasWorkTask: hasWorkTask(tasks),
    });
    const worked = [{ status: 'in_progress' }];
    expect(resolve({ todayLog: todayLog(log(), worked) }).activity).toBe('today');
    expect(resolve({ todayLog: todayLog(log(), [{ status: 'planned' }]) }).activity).toBe('none');
    expect(resolve({ todayLog: todayLog(log({ visibility: 'private' }), worked) }).activity).toBe('none');
    expect(resolve({ todayLog: todayLog(log({ deletedAt: now }), worked) }).activity).toBe('none');
  });

  it('ignores past and future blocks', () => {
    const r = report({ schedule: [block('meeting', '08:00', '10:00', meetingRef), block('focus', '10:01', '11:00')] });
    expect(resolve({ report: r })).toMatchObject({ shown: false, source: 'none' });
  });
});

describe('resolveActivity: truthfulness by enumeration', () => {
  const manuals: ActivityInputs['manual'][] = [
    null,
    ...MANUAL_STATUSES.map((status: ManualStatus) => ({ status, until: manualUntil })),
    { status: 'focus', until: kst('09:59') },
  ];
  const nows: (NowIn | null)[] = [
    null,
    fresh,
    { kind: 'docs', refHash: null, until: kst('10:01') },
    { kind: 'work', refHash: workRef, until: now },
  ];
  const schedules: ScheduleBlockIn[][] = [
    [],
    [block('away', '00:00', '24:00')],
    [block('meeting', '09:30', '10:30', meetingRef)],
    [block('meeting', '10:00', '10:30')],
    [block('focus', '09:00', '12:00')],
    [block('meeting', '09:30', '10:30', meetingRef), block('focus', '09:00', '12:00')],
    [block('away', '09:00', '12:00'), block('meeting', '09:30', '10:30', meetingRef)],
    [block('meeting', '08:00', '10:00', meetingRef)],
    [block('focus', '10:01', '11:00')],
  ];
  const reports = [null, ...nows.flatMap((n) => schedules.map((schedule) => report({ now: n, schedule })))];
  const logs = [null, workedLog, { colleagueVisible: true, hasWorkTask: false }, { colleagueVisible: false, hasWorkTask: true }];

  const cases: ActivityInputs[] = [];
  for (const live of [false, true])
    for (const manual of manuals)
      for (const share of [false, true])
        for (const r of reports) for (const todayLog of logs) cases.push({ now, live, manual, share, report: r, todayLog });

  it(`holds for all ${cases.length} input combinations`, () => {
    expect(cases.length).toBeGreaterThan(4000);
    for (const i of cases) {
      const r = resolveActivity(i);
      const manualShows = i.manual !== null && i.manual.until > now && i.manual.status !== 'away';
      const placingBlock =
        i.share && (i.report?.schedule ?? []).some((b) => b.kind !== 'away' && b.start <= now && now < b.end);
      // An avatar appears only through the owner's own act, opening the town, or their accepted calendar.
      if (r.shown) expect(manualShows || placingBlock || i.live).toBe(true);
      if (r.source === 'claude') expect(r.until !== null && now < r.until).toBe(true);
      if (r.groupKey !== null) expect(i.share).toBe(true);
      if (!i.share) expect(['calendar', 'claude', 'work_log']).not.toContain(r.source);
      expect(r.dnd).toBe(r.activity === 'focus' || r.activity === 'meeting');
      if (r.note === 'away') expect(r.source).toBe('manual');
    }
  });
});

describe('currentBlock', () => {
  it('covers start <= now < end', () => {
    expect(currentBlock([block('focus', '10:00', '11:00')], now)).not.toBeNull();
    expect(currentBlock([block('focus', '09:00', '10:00')], now)).toBeNull();
  });

  it('ranks away > meeting > focus, then earliest start, then earliest end', () => {
    const focus = block('focus', '09:00', '11:00');
    const meetingLate = block('meeting', '09:50', '10:30', 'late');
    const meetingEarly = block('meeting', '09:30', '11:00', 'early');
    const meetingShort = block('meeting', '09:30', '10:30', 'short');
    expect(currentBlock([focus, meetingLate], now)).toBe(meetingLate);
    expect(currentBlock([meetingLate, meetingEarly], now)).toBe(meetingEarly);
    expect(currentBlock([meetingEarly, meetingShort], now)).toBe(meetingShort);
    const away = block('away', '10:00', '10:05');
    expect(currentBlock([focus, meetingShort, away], now)).toBe(away);
  });
});

describe('isOfficeOpen (Asia/Seoul)', () => {
  const none = new Set<string>();
  it('opens 08:30-19:30 on business days', () => {
    expect(isOfficeOpen(kst('08:29'), TZ, none)).toBe(false);
    expect(isOfficeOpen(kst('08:30'), TZ, none)).toBe(true);
    expect(isOfficeOpen(kst('19:29'), TZ, none)).toBe(true);
    expect(isOfficeOpen(kst('19:30'), TZ, none)).toBe(false);
  });

  it('stays closed on weekends and holidays unless ignored', () => {
    const saturday = kst('10:00', '2026-10-31');
    expect(isOfficeOpen(saturday, TZ, none)).toBe(false);
    expect(isOfficeOpen(now, TZ, new Set(['2026-11-02']))).toBe(false);
    expect(isOfficeOpen(saturday, TZ, none, true)).toBe(true);
    expect(isOfficeOpen(kst('23:00'), TZ, none, true)).toBe(true);
  });
});

describe('manualStatusUntil (Asia/Seoul)', () => {
  it('adds the duration (default 1h)', () => {
    expect(manualStatusUntil(now, TZ, '30m')).toEqual(kst('10:30'));
    expect(manualStatusUntil(now, TZ, '1h')).toEqual(kst('11:00'));
    expect(manualStatusUntil(now, TZ, '2h')).toEqual(kst('12:00'));
    expect(manualStatusUntil(now, TZ)).toEqual(kst('11:00'));
  });

  it('today means the end of work hours, or one hour after them', () => {
    expect(manualStatusUntil(now, TZ, 'today')).toEqual(kst('19:30'));
    expect(manualStatusUntil(kst('19:30'), TZ, 'today')).toEqual(kst('20:30'));
    expect(manualStatusUntil(kst('20:00'), TZ, 'today')).toEqual(kst('21:00'));
  });

  it('never outlives the office day', () => {
    const midnight = kst('00:00', '2026-11-03');
    expect(manualStatusUntil(kst('23:00'), TZ, '30m')).toEqual(kst('23:30'));
    expect(manualStatusUntil(kst('23:45'), TZ, '30m')).toEqual(midnight);
    expect(manualStatusUntil(kst('23:00'), TZ, '2h')).toEqual(midnight);
    expect(manualStatusUntil(kst('23:30'), TZ, 'today')).toEqual(midnight);
    // 00:30 KST is the next office day even though it is still the previous day in UTC.
    expect(manualStatusUntil(kst('00:30', '2026-11-03'), TZ, '1h')).toEqual(kst('01:30', '2026-11-03'));
  });

  it('bounds the office day in the office time zone', () => {
    expect(officeDayBounds(kst('00:00'), TZ)).toEqual({ start: kst('00:00'), end: kst('00:00', '2026-11-03') });
    expect(officeDayBounds(kst('23:59'), TZ)).toEqual({ start: kst('00:00'), end: kst('00:00', '2026-11-03') });
  });
});

describe('hasWorkTask', () => {
  it('counts done, in-progress and blocked tasks, not planned ones', () => {
    expect(hasWorkTask([])).toBe(false);
    expect(hasWorkTask([{ status: 'planned' }])).toBe(false);
    for (const status of ['done', 'in_progress', 'blocked']) {
      expect(hasWorkTask([{ status: 'planned' }, { status }])).toBe(true);
    }
  });
});
