import { describe, expect, it } from 'vitest';
import { computeLinkState } from '../src/link-state';

const base = {
  timeZone: 'Asia/Seoul',
  holidays: new Set<string>(),
  hasActiveLink: true,
  consentedAt: null,
  lastWorkLogAt: null,
};

describe('computeLinkState', () => {
  it('is not_linked without an active grant', () => {
    expect(computeLinkState({ ...base, now: new Date('2026-10-29T03:00:00Z'), hasActiveLink: false })).toBe(
      'not_linked',
    );
  });

  it('is linked when Claude wrote today or on the previous business day', () => {
    const now = new Date('2026-11-02T03:00:00Z'); // Monday 12:00 KST
    expect(computeLinkState({ ...base, now, lastWorkLogAt: new Date('2026-10-30T08:00:00Z') })).toBe(
      'linked',
    ); // Friday
    expect(computeLinkState({ ...base, now, lastWorkLogAt: new Date('2026-10-29T08:00:00Z') })).toBe('stale'); // Thursday
  });

  it('gives a new connection one business day of grace', () => {
    const now = new Date('2026-10-30T03:00:00Z'); // Friday
    expect(computeLinkState({ ...base, now, consentedAt: new Date('2026-10-29T05:00:00Z') })).toBe('linked');
    expect(computeLinkState({ ...base, now, consentedAt: new Date('2026-10-27T05:00:00Z') })).toBe('stale');
  });
});
