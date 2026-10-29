import { ActivityCode, PlateNote, SourceCode } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import type { PlayerSnap } from '../../realtime/types';
import {
  activityIcon,
  activityLabel,
  displayForm,
  groupChipText,
  groupsOf,
  hiddenPlate,
  noteLabel,
  sourceLabel,
  untilLabel,
} from './presence';

const TZ = 'Asia/Seoul';
/** 2026-11-02 11:00 in Asia/Seoul. */
const AT_11 = Date.UTC(2026, 10, 2, 2, 0);
const AT_1530 = Date.UTC(2026, 10, 2, 6, 30);

const p = (over: Partial<PlayerSnap> = {}): PlayerSnap => ({
  id: 'u1',
  name: 'A',
  avatar: 'av',
  deskId: 'L1a',
  x: 0,
  y: 0,
  dir: 0,
  anim: 0,
  statusText: '',
  shown: false,
  online: false,
  activity: ActivityCode.None,
  source: SourceCode.None,
  until: 0,
  note: PlateNote.None,
  groupId: '',
  logPulse: 0,
  ...over,
});

describe('§5.3 label table', () => {
  it('labels every activity code', () => {
    expect(
      [
        ActivityCode.None,
        ActivityCode.Available,
        ActivityCode.Focus,
        ActivityCode.Meeting,
        ActivityCode.Break,
        ActivityCode.Work,
        ActivityCode.Docs,
        ActivityCode.Review,
        ActivityCode.Collab,
        ActivityCode.Today,
      ].map(activityLabel),
    ).toEqual([
      '',
      '대화 가능',
      '집중 모드',
      '회의 중',
      '휴식',
      '개인 업무',
      '문서 작성',
      '검토 중',
      '협업 중',
      '오늘 업무 기록',
    ]);
    expect(activityLabel(99)).toBe('');
  });

  it('labels every source code and plate note', () => {
    expect(
      [
        SourceCode.None,
        SourceCode.Manual,
        SourceCode.Calendar,
        SourceCode.Claude,
        SourceCode.WorkLog,
        SourceCode.Town,
      ].map(sourceLabel),
    ).toEqual(['', '직접 설정', '캘린더 일정', 'Claude 보고', '업무 로그', '타운 접속']);
    expect([PlateNote.None, PlateNote.Away, PlateNote.Absent].map(noteLabel)).toEqual([
      '',
      '자리 비움',
      '부재',
    ]);
  });

  it('formats until as ~HH:MM in the office time zone, nothing for 0', () => {
    expect(untilLabel(AT_11, TZ)).toBe('~11:00');
    expect(untilLabel(0, TZ)).toBe('');
    expect(untilLabel(Number.NaN, TZ)).toBe('');
  });

  it('maps activities to the effect icons of row 3 (Docs reuses note)', () => {
    expect(activityIcon(ActivityCode.Meeting)).toBe('headset');
    expect(activityIcon(ActivityCode.Focus)).toBe('focus');
    expect(activityIcon(ActivityCode.Break)).toBe('cup');
    expect(activityIcon(ActivityCode.Work)).toBe('laptop');
    expect(activityIcon(ActivityCode.Review)).toBe('magnifier');
    expect(activityIcon(ActivityCode.Collab)).toBe('link');
    expect(activityIcon(ActivityCode.Today)).toBe('clipboard');
    expect(activityIcon(ActivityCode.Docs)).toBe('note');
    expect(activityIcon(ActivityCode.None)).toBeNull();
  });
});

describe('displayForm', () => {
  it('is `<activity> · <source>` plus ~HH:MM when until > 0', () => {
    expect(
      displayForm(p({ activity: ActivityCode.Review, source: SourceCode.Claude, until: AT_11 }), TZ),
    ).toBe('검토 중 · Claude 보고 · ~11:00');
    expect(displayForm(p({ activity: ActivityCode.Focus, source: SourceCode.Manual }), TZ)).toBe(
      '집중 모드 · 직접 설정',
    );
    expect(displayForm(p({ activity: ActivityCode.Today, source: SourceCode.WorkLog }), TZ)).toBe(
      '오늘 업무 기록 · 업무 로그',
    );
  });

  it('shows only the source when there is no activity', () => {
    expect(displayForm(p({ shown: true, source: SourceCode.Town }), TZ)).toBe('타운 접속');
  });

  it('shows 부재 alone (no source, no end time) and 자리 비움 with its end time', () => {
    expect(displayForm(p({ note: PlateNote.Absent, until: AT_11, source: SourceCode.Calendar }), TZ)).toBe(
      '부재',
    );
    expect(displayForm(p({ note: PlateNote.Away, source: SourceCode.Manual, until: AT_1530 }), TZ)).toBe(
      '자리 비움 · ~15:30',
    );
  });

  it('is empty when nothing is known', () => {
    expect(displayForm(p(), TZ)).toBe('');
  });
});

describe('hidden desk plates (§1.3)', () => {
  it('자리 비움: note with end time, plus the owner-typed 상태 문구', () => {
    expect(
      hiddenPlate(p({ note: PlateNote.Away, until: AT_1530, statusText: '병원 다녀올게요' }), TZ),
    ).toEqual({
      label: { icon: null, text: '자리 비움 · ~15:30' },
      detail: '병원 다녀올게요',
      quiet: false,
    });
  });

  it('부재: the word only, never a reason, source or end time', () => {
    expect(hiddenPlate(p({ note: PlateNote.Absent, until: AT_11, statusText: 'x' }), TZ)).toEqual({
      label: { icon: null, text: '부재' },
      detail: null,
      quiet: false,
    });
  });

  it('a label without the avatar: icon + activity, then source (+ ~HH:MM)', () => {
    expect(
      hiddenPlate(p({ activity: ActivityCode.Review, source: SourceCode.Claude, until: AT_11 }), TZ),
    ).toEqual({
      label: { icon: 'magnifier', text: '검토 중' },
      detail: 'Claude 보고 · ~11:00',
      quiet: false,
    });
    expect(hiddenPlate(p({ activity: ActivityCode.Today, source: SourceCode.WorkLog }), TZ)).toEqual({
      label: { icon: 'clipboard', text: '오늘 업무 기록' },
      detail: '업무 로그',
      quiet: false,
    });
  });

  it('no signal: the name only (no "미접속" shaming)', () => {
    expect(hiddenPlate(p(), TZ)).toEqual({ label: null, detail: null, quiet: true });
  });
});

describe('groups', () => {
  it('groups by groupId, infers the family from Meeting and takes the latest until', () => {
    const groups = groupsOf([
      p({ id: 'c', deskId: 'R2a', groupId: 'g1', activity: ActivityCode.Meeting, until: AT_11 }),
      p({ id: 'a', deskId: 'L1a', groupId: 'g1', activity: ActivityCode.Meeting, until: AT_1530 }),
      p({ id: 'b', deskId: '', groupId: 'g1', activity: ActivityCode.Meeting, until: AT_11 }),
      p({ id: 'd', deskId: 'L2a', groupId: 'g0', activity: ActivityCode.Review }),
      p({ id: 'e', deskId: 'L2b', groupId: 'g0', activity: ActivityCode.Work }),
      p({ id: 'f', deskId: 'L3a', groupId: 'lonely' }),
      p({ id: 'g', deskId: 'L3b' }),
    ]);
    expect(groups.map((g) => [g.id, g.family, g.members.map((m) => m.id)])).toEqual([
      ['g0', 'work', ['d', 'e']],
      ['g1', 'meeting', ['a', 'c', 'b']],
    ]);
    expect(groups[1]?.until).toBe(AT_1530);
    expect(groupChipText(groups[1]!, TZ)).toBe('회의 중 · 3명 · ~15:30');
    expect(groupChipText(groups[0]!, TZ)).toBe('같은 작업');
  });
});
