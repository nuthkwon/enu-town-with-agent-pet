import { describe, expect, it } from 'vitest';
import { mergeWorkLogChanges, workLogDelta } from '../src/worklog-delta';

const log = (
  summary: string,
  tasks: { title: string; status: string; ref?: string }[] = [],
  blockers: string[] = [],
) => ({ summary, tasks, blockers });

describe('workLogDelta', () => {
  it("lists everything of the day's first write", () => {
    expect(
      workLogDelta(
        null,
        log('TARA 갱신', [{ title: 'TARA 시트', status: 'in_progress' }], ['공급사 회신 대기']),
      ),
    ).toEqual([
      { type: 'summary', text: 'TARA 갱신' },
      { type: 'task_added', title: 'TARA 시트', status: 'in_progress' },
      { type: 'blocker_added', text: '공급사 회신 대기' },
    ]);
  });

  it('shows status moves, new tasks, new blockers and a changed summary, never removals', () => {
    const prev = log(
      '오전',
      [
        { title: 'A', status: 'in_progress' },
        { title: 'B', status: 'planned' },
        { title: 'C', status: 'done' },
      ],
      ['막힘 1'],
    );
    const next = log(
      '오후',
      [
        { title: 'A', status: 'done' },
        { title: 'B', status: 'planned' },
        { title: 'D', status: 'planned' },
      ],
      ['막힘 1', '막힘 2'],
    );
    expect(workLogDelta(prev, next)).toEqual([
      { type: 'summary', text: '오후' },
      { type: 'task_status', title: 'A', from: 'in_progress', to: 'done' },
      { type: 'task_added', title: 'D', status: 'planned' },
      { type: 'blocker_added', text: '막힘 2' },
    ]);
  });

  it('matches tasks by reference before title, and repeated titles one by one', () => {
    const prev = log('s', [
      { title: '리뷰', status: 'planned', ref: 'jira:ENU-1' },
      { title: '같은 일', status: 'planned' },
    ]);
    const next = log('s', [
      { title: '코드 리뷰', status: 'in_progress', ref: 'jira:ENU-1' },
      { title: '같은 일', status: 'done' },
      { title: '같은 일', status: 'planned' },
    ]);
    expect(workLogDelta(prev, next)).toEqual([
      { type: 'task_status', title: '코드 리뷰', from: 'planned', to: 'in_progress' },
      { type: 'task_status', title: '같은 일', from: 'planned', to: 'done' },
      { type: 'task_added', title: '같은 일', status: 'planned' },
    ]);
  });

  it('is empty when nothing the feed shows changed', () => {
    const same = log('s', [{ title: 'A', status: 'done' }], ['b']);
    expect(workLogDelta(same, { ...same })).toEqual([]);
    expect(workLogDelta(same, log('s', [], []))).toEqual([]);
    expect(workLogDelta(log(''), log('  '))).toEqual([]);
  });
});

describe('mergeWorkLogChanges', () => {
  it("merges a day's writes into what changed overall", () => {
    expect(
      mergeWorkLogChanges([
        [
          { type: 'summary', text: '1' },
          { type: 'task_added', title: 'A', status: 'planned' },
          { type: 'blocker_added', text: 'x' },
        ],
        [
          { type: 'task_status', title: 'A', from: 'planned', to: 'done' },
          { type: 'task_status', title: 'B', from: 'planned', to: 'in_progress' },
          { type: 'blocker_added', text: 'x' },
        ],
        [
          { type: 'summary', text: '2' },
          { type: 'task_status', title: 'B', from: 'in_progress', to: 'done' },
          { type: 'task_status', title: 'C', from: 'planned', to: 'done' },
        ],
        [{ type: 'task_status', title: 'C', from: 'done', to: 'planned' }],
      ]),
    ).toEqual([
      { type: 'summary', text: '2' },
      { type: 'task_status', title: 'B', from: 'planned', to: 'done' },
      { type: 'task_added', title: 'A', status: 'done' },
      { type: 'blocker_added', text: 'x' },
    ]);
  });

  it('is empty when every change cancelled out', () => {
    expect(
      mergeWorkLogChanges([
        [{ type: 'task_status', title: 'A', from: 'planned', to: 'done' }],
        [{ type: 'task_status', title: 'A', from: 'done', to: 'planned' }],
      ]),
    ).toEqual([]);
  });
});
