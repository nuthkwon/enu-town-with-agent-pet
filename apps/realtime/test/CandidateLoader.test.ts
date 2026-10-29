import { describe, expect, it } from 'vitest';
import { nudgeRowToCandidate, todoRowToCandidate } from '../src/pet/CandidateLoader';

const t = (iso: string) => new Date(iso);

describe('candidate mapping', () => {
  it('keeps nudge text unchanged and uses the later of show_after / snoozed_until', () => {
    const base = {
      id: 'n1',
      text: '  그대로 둡니다 ',
      priority: 2,
      showAfter: t('2026-10-28T01:00:00Z'),
      snoozedUntil: null,
      expiresAt: t('2026-10-28T10:00:00Z'),
      showCount: 1,
      maxShows: 2,
      createdAt: t('2026-10-28T00:00:00Z'),
      dueAt: null,
    };
    const c = nudgeRowToCandidate(base);
    expect(c.text).toBe('  그대로 둡니다 ');
    expect(c.eligibleAt).toEqual(base.showAfter);
    expect(c).toMatchObject({ kind: 'nudge', refId: 'n1', shownCount: 1, maxShows: 2, dueAt: null });
    const snoozed = nudgeRowToCandidate({ ...base, snoozedUntil: t('2026-10-28T03:00:00Z') });
    expect(snoozed.eligibleAt).toEqual(t('2026-10-28T03:00:00Z'));
  });

  it('to-dos become eligible at the widest due window and expire at the due time', () => {
    const dueAt = t('2026-10-28T05:00:00Z');
    const c = todoRowToCandidate(
      { id: 't1', title: '보고서', priority: 1, dueAt, createdAt: dueAt },
      { dueWindowsMin: [30, 5] },
    );
    expect(c.kind).toBe('todo_due');
    expect(c.text).toBe('보고서');
    expect(c.eligibleAt).toEqual(t('2026-10-28T04:30:00Z'));
    expect(c.expiresAt).toEqual(dueAt);
    expect(c.dueAt).toEqual(dueAt);
    expect(c.maxShows).toBe(2);
  });
});
