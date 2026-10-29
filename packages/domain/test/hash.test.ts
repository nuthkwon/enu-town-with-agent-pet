import { describe, expect, it } from 'vitest';
import { fnv1a32 } from '../src/hash';

describe('fnv1a32', () => {
  it('matches the reference FNV-1a vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('is an unsigned 32-bit integer', () => {
    const h = fnv1a32('2026-11-02|meeting|u1|u2|u3');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});
