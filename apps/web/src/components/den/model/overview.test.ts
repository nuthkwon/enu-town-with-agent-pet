import { ActivityCode, PlateNote, SourceCode } from '@enu/protocol';
import type { OverviewMemberDto } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import type { PlayerSnap } from '@/realtime/types';
import { blockersByTeam, byTeam, changeLabel, liveTownSummary, teamTotals } from './overview';

const member = (
  userId: string,
  team: OverviewMemberDto['team'],
  over: Partial<OverviewMemberDto> = {},
): OverviewMemberDto => ({
  userId,
  authorName: `직원${userId}`,
  team,
  logId: `log-${userId}`,
  summary: null,
  tasks: [],
  blockers: [],
  provenanceLabel: '',
  lastUpdate: null,
  ...over,
});

const player = (id: string, over: Partial<PlayerSnap> = {}): PlayerSnap => ({
  id,
  name: id,
  avatar: 'av',
  deskId: 'L1a',
  x: 3,
  y: 5,
  dir: 0,
  anim: 0,
  statusText: '',
  shown: true,
  online: false,
  activity: ActivityCode.None,
  source: SourceCode.None,
  until: 0,
  note: PlateNote.None,
  groupId: '',
  logPulse: 0,
  ...over,
});

describe('changeLabel', () => {
  it("frames Claude's text verbatim with Korean status names", () => {
    expect(changeLabel({ type: 'summary', text: '심사 준비' })).toBe('요약: 심사 준비');
    expect(changeLabel({ type: 'task_status', title: 'TARA', from: 'in_progress', to: 'done' })).toBe(
      'TARA: 진행 중 → 완료',
    );
    expect(changeLabel({ type: 'task_added', title: '증적', status: 'planned' })).toBe('새 작업 증적 (예정)');
    expect(changeLabel({ type: 'blocker_added', text: '회신 대기' })).toBe('막힘: 회신 대기');
  });
});

describe('team views', () => {
  const members = [
    member('3', 'qa', { tasks: [{ title: 'a', status: 'blocked' }], blockers: ['장비 대기'] }),
    member('1', 'dev', {
      tasks: [
        { title: 'b', status: 'done' },
        { title: 'c', status: 'in_progress' },
      ],
    }),
    member('9', null, { blockers: ['권한'] }),
    member('2', 'dev', { tasks: [{ title: 'd', status: 'done' }] }),
  ];

  it('groups by the fixed team order, keeping the given order inside a team, no team last', () => {
    expect(byTeam(members).map((g) => [g.team, g.items.map((m) => m.userId)])).toEqual([
      ['dev', ['1', '2']],
      ['qa', ['3']],
      [null, ['9']],
    ]);
  });

  it('totals tasks per status for teams with a visible log only', () => {
    expect(teamTotals(members)).toEqual([
      { team: 'dev', label: '개발팀', counts: { done: 2, in_progress: 1, planned: 0, blocked: 0 } },
      { team: 'qa', label: '품질보증팀', counts: { done: 0, in_progress: 0, planned: 0, blocked: 1 } },
      { team: null, label: '팀 미지정', counts: { done: 0, in_progress: 0, planned: 0, blocked: 0 } },
    ]);
  });

  it('collects blockers by team and leaves out teams without any', () => {
    expect(blockersByTeam(members).map((g) => [g.team, g.items.map((b) => b.text)])).toEqual([
      ['qa', ['장비 대기']],
      [null, ['권한']],
    ]);
  });
});

describe('liveTownSummary', () => {
  it('is null after hours and before the first state', () => {
    expect(liveTownSummary([player('a', { online: true })], false)).toBeNull();
    expect(liveTownSummary([player('a', { online: true })], null)).toBeNull();
  });

  it('counts what the town draws: meetings, focus, away, absent and online', () => {
    const roster = [
      player('a', { activity: ActivityCode.Meeting, groupId: 'g1', online: true }),
      player('b', { activity: ActivityCode.Meeting, groupId: 'g1', online: true }),
      player('c', { activity: ActivityCode.Meeting, groupId: 'g1' }),
      player('d', { activity: ActivityCode.Focus, online: true }),
      player('e', { shown: false, note: PlateNote.Away, activity: ActivityCode.Meeting }),
      player('f', { shown: false, note: PlateNote.Absent }),
      player('g', { activity: ActivityCode.Work, groupId: 'g2' }),
      player('h', { activity: ActivityCode.Work, groupId: 'g2' }),
    ];
    const sum = liveTownSummary(roster, true)!;
    expect(sum).toMatchObject({ meeting: 3, focus: 1, away: 1, absent: 1, online: 3 });
    expect(sum.meetings.map((g) => [g.id, g.members.length])).toEqual([['g1', 3]]);
  });
});
