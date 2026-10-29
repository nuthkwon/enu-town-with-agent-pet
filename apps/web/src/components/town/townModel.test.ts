import { ActivityCode, PlateNote, SourceCode } from '@enu/protocol';
import type { PersonDto } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import type { PlayerSnap } from '@/realtime/types';
import {
  activeManual,
  currentChoice,
  menuState,
  onlineCount,
  ownHiddenLine,
  profileStatus,
  railGroups,
  statusChipLabel,
  statusPayload,
  statusUpdate,
} from './townModel';

const TZ = 'Asia/Seoul';
const AT_11 = Date.UTC(2026, 10, 2, 2, 0);

const player = (over: Partial<PlayerSnap> = {}): PlayerSnap => ({
  id: 'u1',
  name: 'A',
  avatar: 'av',
  deskId: 'L1a',
  x: 3,
  y: 5,
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

const person = (
  userId: string,
  team: PersonDto['team'],
  deskId: string | null,
  displayName: string,
): PersonDto => ({
  userId,
  displayName,
  avatar: { body: 'm', hair: 'short', hairColor: 'black', outfit: 'sky', skin: 'warm', wings: false },
  avatarKey: 'av-m-short-black-sky-warm',
  pet: { species: 'cat', name: '냥' },
  deskId,
  team,
  teamLabel: '',
  title: null,
  roleNote: null,
  linkState: 'linked',
});

describe('접속 N명', () => {
  it('counts Players with online=true only (every roster member is always in the state)', () => {
    const roster = [
      player({ id: 'a', online: true, shown: true }),
      player({ id: 'b', shown: true }),
      player({ id: 'c' }),
      player({ id: 'd', note: PlateNote.Away }),
    ];
    expect(onlineCount(roster)).toBe(1);
    expect(onlineCount([])).toBe(0);
  });
});

describe('team rail', () => {
  it('groups in TEAMS order, then desk order (no desk last), then name; reads online/shown from the Player', () => {
    const people = [
      person('q1', 'qa', 'L5a', '가'),
      person('d2', 'dev', null, '나'),
      person('d1', 'dev', 'L3b', '다'),
      person('d3', 'dev', 'L2a', '라'),
      person('m1', 'mgmt', 'R1', '마'),
      person('x1', null, null, '바'),
    ];
    const players = new Map<string, PlayerSnap>([
      [
        'd1',
        player({
          id: 'd1',
          shown: true,
          online: true,
          activity: ActivityCode.Review,
          source: SourceCode.Claude,
          until: AT_11,
        }),
      ],
      ['d3', player({ id: 'd3', note: PlateNote.Absent })],
      ['m1', player({ id: 'm1', shown: true, source: SourceCode.Town })],
    ]);
    const groups = railGroups(people, players, 'd3', TZ);
    expect(groups.map((g) => [g.teamId, g.rows.map((r) => r.person.userId)])).toEqual([
      ['mgmt', ['m1']],
      ['dev', ['d3', 'd1', 'd2']],
      ['qa', ['q1']],
      [null, ['x1']],
    ]);
    const dev = groups[1]!.rows;
    expect(dev[0]).toMatchObject({ isMe: true, online: false, shown: false, form: '부재', icon: null });
    expect(dev[1]).toMatchObject({
      online: true,
      shown: true,
      form: '검토 중 · Claude 보고 · ~11:00',
      icon: 'magnifier',
    });
    // A roster member without a Player snapshot (not connected yet / not onboarded) has no dot and no label.
    expect(dev[2]).toMatchObject({ online: false, shown: false, form: '' });
    // Shown but not connected (e.g. calendar meeting): drawn, but no online dot.
    expect(groups[0]!.rows[0]).toMatchObject({ online: false, shown: true, form: '타운 접속' });
  });
});

describe('avatar / desk menu', () => {
  const me = player({ id: 'me', shown: true, online: true });

  it('a roster member who is not online gets a disabled 부르기 and the new offlineAction text', () => {
    const s = menuState(player({ id: 't' }), me, true, TZ);
    expect(s).toMatchObject({ online: false, canPing: false, canWave: false, canView: false });
    expect(s.hint).toBe('지금 화면에 없어서 할 수 없어요');
  });

  it('shown but not connected: wave and view, but no ping', () => {
    const s = menuState(
      player({ id: 't', shown: true, activity: ActivityCode.Meeting, source: SourceCode.Calendar }),
      me,
      true,
      TZ,
    );
    expect(s).toMatchObject({ canWave: true, canView: true, canPing: false, form: '회의 중 · 캘린더 일정' });
    expect(s.hint).toBe('부르기는 지금 접속 중인 사람에게만 할 수 있어요');
  });

  it('online: everything enabled; waving needs me shown and the office open', () => {
    const target = player({ id: 't', shown: true, online: true, source: SourceCode.Town });
    expect(menuState(target, me, true, TZ)).toMatchObject({
      canWave: true,
      canPing: true,
      canView: true,
      hint: null,
    });
    expect(menuState(target, player({ id: 'me' }), true, TZ).canWave).toBe(false);
    expect(menuState(target, me, false, TZ).canWave).toBe(false);
    expect(menuState(target, me, null, TZ).canWave).toBe(false);
  });

  it('부재 shows alone in the header', () => {
    expect(menuState(player({ note: PlateNote.Absent }), me, true, TZ).form).toBe('부재');
  });
});

describe('StatusMenu', () => {
  it('builds the status:set payload (auto has no duration; the text is sent only when it changed)', () => {
    expect(statusPayload('focus', '30m', '집중해요', '')).toEqual({
      status: 'focus',
      duration: '30m',
      text: '집중해요',
    });
    expect(statusPayload('away', 'today', ' 외근 ', '외근')).toEqual({ status: 'away', duration: 'today' });
    expect(statusPayload('auto', '2h', '외근', '외근')).toEqual({ status: 'auto' });
    expect(statusPayload('auto', '1h', '', '외근')).toEqual({ status: 'auto', text: '' });
  });

  it('a 상태 문구-only edit never re-sends the status (its end stays), unless I pick a status or a duration', () => {
    const base = { choice: 'away', currentChoice: 'away', durationTouched: false, duration: '1h' } as const;
    // 문구 지우기 while 자리 비움 · 오늘 근무 끝까지: only the text goes out, the status end is not recomputed.
    expect(statusUpdate({ ...base, text: '', previousText: '오후 반차' })).toEqual({
      kind: 'text',
      text: '',
    });
    expect(statusUpdate({ ...base, text: ' 외근 ', previousText: '오후 반차' })).toEqual({
      kind: 'text',
      text: '외근',
    });
    expect(statusUpdate({ ...base, text: '오후 반차', previousText: '오후 반차' })).toEqual({ kind: 'none' });
    expect(
      statusUpdate({ ...base, choice: 'auto', currentChoice: 'auto', text: '', previousText: '외근' }),
    ).toEqual({
      kind: 'text',
      text: '',
    });
    // Picking another status, or a duration chip, restarts it (with the text when it changed).
    expect(statusUpdate({ ...base, choice: 'focus', text: '', previousText: '오후 반차' })).toEqual({
      kind: 'status',
      msg: { status: 'focus', duration: '1h', text: '' },
    });
    expect(
      statusUpdate({
        ...base,
        durationTouched: true,
        duration: '2h',
        text: '오후 반차',
        previousText: '오후 반차',
      }),
    ).toEqual({
      kind: 'status',
      msg: { status: 'away', duration: '2h' },
    });
  });

  it('reads my current choice from the projection while open, otherwise from my last manual status', () => {
    const manual = { status: 'break' as const, until: new Date(AT_11).toISOString() };
    expect(
      currentChoice(
        player({ shown: true, activity: ActivityCode.Focus, source: SourceCode.Manual, until: AT_11 }),
        true,
        null,
      ),
    ).toEqual({
      choice: 'focus',
      until: AT_11,
    });
    expect(
      currentChoice(player({ note: PlateNote.Away, source: SourceCode.Manual, until: AT_11 }), true, null)
        .choice,
    ).toBe('away');
    expect(
      currentChoice(
        player({ shown: true, activity: ActivityCode.Meeting, source: SourceCode.Calendar }),
        true,
        manual,
      ).choice,
    ).toBe('auto');
    expect(currentChoice(player(), false, manual)).toEqual({ choice: 'break', until: AT_11 });
    expect(currentChoice(undefined, null, null).choice).toBe('auto');
  });

  it('ignores an expired manual status', () => {
    const manual = { status: 'focus' as const, until: new Date(AT_11).toISOString() };
    expect(activeManual(manual, new Date(AT_11 - 1))).toEqual(manual);
    expect(activeManual(manual, new Date(AT_11))).toBeNull();
    expect(activeManual(null, new Date(AT_11))).toBeNull();
  });

  it('labels the top-bar chip `내 상태: 집중 ~11:00`', () => {
    expect(statusChipLabel('focus', AT_11, () => '11:00')).toBe('집중 ~11:00');
    expect(statusChipLabel('auto', 0, () => '')).toBe('자동');
  });

  it('explains how colleagues see me while I am hidden (office hours only)', () => {
    expect(ownHiddenLine(player({ note: PlateNote.Away, until: AT_11 }), true, TZ)).toBe(
      "지금 동료에게 '자리 비움'으로 보여요. 상태를 바꾸면 자리에 표시돼요.",
    );
    expect(ownHiddenLine(player({ note: PlateNote.Absent }), true, TZ)).toBe(
      "지금 동료에게 '부재'로 보여요. 상태를 바꾸면 자리에 표시돼요.",
    );
    expect(
      ownHiddenLine(
        player({ activity: ActivityCode.Review, source: SourceCode.Claude, until: AT_11 }),
        true,
        TZ,
      ),
    ).toBe("지금 동료에게는 자리 표시판에 '검토 중 · Claude 보고 · ~11:00'로만 보여요.");
    expect(ownHiddenLine(player(), true, TZ)).toBe(
      '지금 동료에게는 이름만 보여요. 상태를 정하면 자리에 표시돼요.',
    );
    expect(ownHiddenLine(player({ shown: true }), true, TZ)).toBeNull();
    expect(ownHiddenLine(player(), false, TZ)).toBeNull();
  });
});

describe('ProfileCard status line', () => {
  it('uses online for the dot and the projected fields for the text', () => {
    expect(
      profileStatus(
        player({ shown: true, online: true, source: SourceCode.Town, statusText: '오후 외근' }),
        true,
        TZ,
      ),
    ).toEqual({
      online: true,
      text: '타운 접속 · 오후 외근',
    });
    expect(
      profileStatus(
        player({ shown: true, activity: ActivityCode.Meeting, source: SourceCode.Calendar }),
        true,
        TZ,
      ),
    ).toEqual({
      online: false,
      text: '회의 중 · 캘린더 일정',
    });
    expect(profileStatus(undefined, true, TZ)).toEqual({ online: false, text: '지금 알려진 활동이 없어요' });
    expect(profileStatus(player({ online: true }), false, TZ)).toEqual({
      online: false,
      text: '근무 시간이 아니에요',
    });
  });
});
