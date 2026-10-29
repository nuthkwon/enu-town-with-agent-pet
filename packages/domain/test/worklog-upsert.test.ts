import { describe, expect, it } from 'vitest';
import { decideWorkLogUpsert, type ExistingWorkLog } from '../src/worklog-upsert';

const defaults = { logVisibility: 'company' as const, chatSummaryVisibility: null };
const incoming = { summary: '견적서 검토', tasks: [], blockers: [], claudeChatSummary: null };
const existing = (over: Partial<ExistingWorkLog> = {}): ExistingWorkLog => ({
  ...incoming,
  visibility: 'company',
  visibilitySetBy: 'claude',
  chatSummaryVisibility: 'private',
  chatSummaryVisibilitySetBy: 'claude',
  editedByUser: false,
  deletedAt: null,
  ...over,
});

describe('decideWorkLogUpsert', () => {
  it('creates with owner defaults (chat summary private until opted in)', () => {
    expect(decideWorkLogUpsert(null, incoming, defaults)).toMatchObject({
      result: 'created',
      visibility: 'company',
      chatSummaryVisibility: 'private',
    });
  });

  it('never resurrects or overwrites owner decisions', () => {
    expect(decideWorkLogUpsert(existing({ deletedAt: new Date() }), incoming, defaults).result).toBe('skipped_user_deleted');
    expect(decideWorkLogUpsert(existing({ editedByUser: true }), incoming, defaults).result).toBe('skipped_user_edited');
  });

  it('keeps visibility chosen by the owner', () => {
    const d = decideWorkLogUpsert(
      existing({ visibility: 'private', visibilitySetBy: 'user' }),
      { ...incoming, summary: '새 내용' },
      defaults,
    );
    expect(d).toMatchObject({ result: 'updated', visibility: 'private' });
  });

  it('reports unchanged content', () => {
    expect(decideWorkLogUpsert(existing(), incoming, defaults).result).toBe('unchanged');
  });

  it('lets Claude lower visibility', () => {
    expect(decideWorkLogUpsert(existing(), { ...incoming, visibility: 'private' }, defaults)).toMatchObject({
      result: 'updated',
      visibility: 'private',
    });
  });
});
