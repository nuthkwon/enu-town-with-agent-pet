import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../src/auth/verifyTicket';
import { prepareChatText, dmPair } from '../src/chat/ChatService';
import { emailInDomain } from '../src/infra/profiles';
import { KeyedLimiter, TokenBucket, perWindow } from '../src/infra/RateLimiter';
import { RingBuffer } from '../src/world/RingBuffer';

describe('RingBuffer', () => {
  it('is FIFO and drops the oldest item when full', () => {
    const r = new RingBuffer<number>(3);
    r.push(1);
    r.push(2);
    expect(r.toArray()).toEqual([1, 2]);
    r.push(3);
    r.push(4);
    expect(r.size).toBe(3);
    expect(r.toArray()).toEqual([2, 3, 4]);
    expect(r.peekOldest()).toBe(2);
    expect(r.peekNewest()).toBe(4);
    expect(r.shift()).toBe(2);
    expect(r.toArray()).toEqual([3, 4]);
    r.clear();
    expect(r.size).toBe(0);
    expect(r.shift()).toBeUndefined();
  });
});

describe('TokenBucket', () => {
  it('allows a burst, then one per refill interval', () => {
    const b = new TokenBucket(3, 100);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(50)).toBe(false);
    expect(b.take(100)).toBe(true);
    expect(b.take(150)).toBe(false);
  });

  it('perWindow(5, 10s) admits 5 messages per 10 seconds', () => {
    const b = perWindow(5, 10_000);
    let ok = 0;
    for (let i = 0; i < 10; i++) if (b.take(i)) ok++;
    expect(ok).toBe(5);
    expect(b.take(2_000)).toBe(true);
  });

  it('KeyedLimiter keeps separate budgets per key', () => {
    const k = new KeyedLimiter(() => new TokenBucket(1, 30_000));
    expect(k.take('a', 0)).toBe(true);
    expect(k.take('a', 10)).toBe(false);
    expect(k.take('b', 10)).toBe(true);
    expect(k.take('a', 30_001)).toBe(true);
  });
});

describe('chat text', () => {
  it('normalises without rewriting and rejects empty or over-long text', () => {
    expect(prepareChatText('  안녕\n하세요  ', { multiline: false })).toEqual({
      ok: true,
      text: '안녕 하세요',
    });
    expect(prepareChatText('첫 줄\n둘째 줄', { multiline: true })).toEqual({
      ok: true,
      text: '첫 줄\n둘째 줄',
    });
    const zw = String.fromCharCode(0x200b);
    expect(prepareChatText(`${zw}  ${zw}`, { multiline: false })).toEqual({ ok: false, error: 'EMPTY' });
    expect(prepareChatText('가'.repeat(500), { multiline: false })).toMatchObject({ ok: true });
    expect(prepareChatText('가'.repeat(501), { multiline: false })).toEqual({ ok: false, error: 'TOO_LONG' });
  });

  it('orders DM participants', () => {
    expect(dmPair('b', 'a')).toEqual({ dmLow: 'a', dmHigh: 'b' });
    expect(dmPair('a', 'b')).toEqual({ dmLow: 'a', dmHigh: 'b' });
  });
});

describe('access checks', () => {
  it('origin allow-list (empty list = allow all)', () => {
    expect(isOriginAllowed('http://localhost:3000', ['http://localhost:3000'])).toBe(true);
    expect(isOriginAllowed('https://evil.example', ['http://localhost:3000'])).toBe(false);
    expect(isOriginAllowed(null, ['http://localhost:3000'])).toBe(false);
    expect(isOriginAllowed(null, [])).toBe(true);
  });

  it('e-mail domain must match exactly', () => {
    expect(emailInDomain('a@enu-tech.co.kr', 'enu-tech.co.kr')).toBe(true);
    expect(emailInDomain('a@ENU-TECH.CO.KR', 'enu-tech.co.kr')).toBe(true);
    expect(emailInDomain('a@evil-enu-tech.co.kr', 'enu-tech.co.kr')).toBe(false);
    expect(emailInDomain('a@enu-tech.co.kr.evil.com', 'enu-tech.co.kr')).toBe(false);
    expect(emailInDomain('no-at-sign', 'enu-tech.co.kr')).toBe(false);
  });
});
