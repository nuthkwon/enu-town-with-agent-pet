import { describe, expect, it } from 'vitest';
import { prepareNudgeText, prepareWorkLog } from '../src/validation';

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
    const ok = prepareWorkLog({ summary: 'ENU-12 처리', tasks: [{ title: 'PR 리뷰', status: 'done', ref: 'ENU-12' }], blockers: [] });
    expect(ok.problems).toEqual([]);
  });
});
