import { describe, expect, it } from 'vitest';
import {
  clampFeedDay,
  feedDayNav,
  lastUpdateTime,
  projectWorkLogFeed,
  type FeedRow,
} from '../src/worklog-feed';

const TZ = 'Asia/Seoul';
const TODAY = '2026-10-30';
const at = (hm: string, day = TODAY) => new Date(`${day}T${hm}:00+09:00`);
const sharing = { active: true, shareActivity: true };

let n = 0;
const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  entryId: `e${++n}`,
  logId: 'log-a',
  userId: 'a',
  authorName: '직원07',
  team: 'dev',
  deskId: 'R2b',
  dayKey: TODAY,
  seq: n,
  writtenAt: at('10:00'),
  inOfficeHours: true,
  changes: [{ type: 'summary', text: `요약 ${n}` }],
  author: sharing,
  ...over,
});

describe('projectWorkLogFeed', () => {
  it("lists today's office-hours writes of sharers one by one, newest first, with HH:MM", () => {
    const items = projectWorkLogFeed(
      [row({ writtenAt: at('09:10') }), row({ writtenAt: at('11:42'), logId: 'log-b', userId: 'b' })],
      { todayKey: TODAY, timeZone: TZ },
    );
    expect(items.map((i) => [i.form, i.time, i.userId])).toEqual([
      ['entry', '11:42', 'b'],
      ['entry', '09:10', 'a'],
    ]);
  });

  it('merges everything else into one digest per person per day, ordered by team, desk and name', () => {
    const items = projectWorkLogFeed(
      [
        // today but outside office hours, and a person who does not share activity
        row({ inOfficeHours: false, writtenAt: at('07:50') }),
        row({
          logId: 'log-q',
          userId: 'q',
          authorName: '직원04',
          team: 'qa',
          deskId: 'L2a',
          author: { active: true, shareActivity: false },
        }),
        row({
          logId: 'log-q',
          userId: 'q',
          authorName: '직원04',
          team: 'qa',
          deskId: 'L2a',
          author: { active: true, shareActivity: false },
        }),
        // past days (already merged by the nightly purge)
        row({ dayKey: '2026-10-29', writtenAt: null, logId: 'old-a' }),
        row({
          dayKey: '2026-10-29',
          writtenAt: null,
          logId: 'old-m',
          userId: 'm',
          authorName: '직원03',
          team: 'mgmt',
          deskId: 'R1',
        }),
      ],
      { todayKey: TODAY, timeZone: TZ },
    );
    expect(items.map((i) => [i.form, i.dayKey, i.userId, i.time])).toEqual([
      ['digest', TODAY, 'a', null],
      ['digest', TODAY, 'q', null],
      ['digest', '2026-10-29', 'm', null],
      ['digest', '2026-10-29', 'a', null],
    ]);
    expect(items[1]!.changes).toHaveLength(1);
    // Nothing that carries time or counts leaves the projection.
    for (const item of items)
      expect(Object.keys(item).sort()).toEqual([
        'authorName',
        'changes',
        'dayKey',
        'form',
        'id',
        'logId',
        'team',
        'time',
        'userId',
      ]);
  });

  it('drops a digest whose changes cancelled out', () => {
    const items = projectWorkLogFeed(
      [
        row({
          inOfficeHours: false,
          changes: [{ type: 'task_status', title: 'A', from: 'planned', to: 'done' }],
        }),
        row({
          inOfficeHours: false,
          changes: [{ type: 'task_status', title: 'A', from: 'done', to: 'planned' }],
        }),
      ],
      { todayKey: TODAY, timeZone: TZ },
    );
    expect(items).toEqual([]);
  });
});

describe('lastUpdateTime', () => {
  it("gives the latest write's time only when that write may show one", () => {
    const opts = { todayKey: TODAY, timeZone: TZ };
    expect(
      lastUpdateTime(
        [row({ seq: 1, writtenAt: at('09:00') }), row({ seq: 2, writtenAt: at('15:20') })],
        opts,
      ),
    ).toBe('15:20');
    expect(
      lastUpdateTime(
        [
          row({ seq: 1, writtenAt: at('09:00') }),
          row({ seq: 2, writtenAt: at('19:40'), inOfficeHours: false }),
        ],
        opts,
      ),
    ).toBeNull();
    expect(lastUpdateTime([row({ author: { active: true, shareActivity: null } })], opts)).toBeNull();
  });
});

describe('feed days', () => {
  it('moves by calendar days inside the retention window', () => {
    expect(feedDayNav(TODAY, TODAY, 90)).toEqual({ prevDay: '2026-10-29', nextDay: null });
    expect(feedDayNav('2026-08-01', TODAY, 90)).toEqual({ prevDay: null, nextDay: '2026-08-02' });
  });

  it('clamps a requested day', () => {
    expect(clampFeedDay(null, TODAY, 90)).toBe(TODAY);
    expect(clampFeedDay('junk', TODAY, 90)).toBe(TODAY);
    expect(clampFeedDay('2027-01-01', TODAY, 90)).toBe(TODAY);
    expect(clampFeedDay('2020-01-01', TODAY, 90)).toBe('2026-08-01');
    expect(clampFeedDay('2026-10-20', TODAY, 90)).toBe('2026-10-20');
  });
});
