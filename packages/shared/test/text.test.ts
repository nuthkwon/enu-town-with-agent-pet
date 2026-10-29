import { describe, expect, it } from 'vitest';
import { containsUrl, detectPii, graphemeLength, normalizeLine, normalizeText, truncateGraphemes } from '../src/text/index';

describe('text', () => {
  it('normalizes without changing meaning', () => {
    expect(normalizeText('  안녕​하세요‮ \r\n\n\n\n다음  ')).toBe('안녕하세요 \n\n다음');
    expect(normalizeLine('첫 줄\n둘째\t줄')).toBe('첫 줄 둘째 줄');
  });

  it('counts graphemes', () => {
    expect(graphemeLength('회의 준비👍🏽')).toBe(6);
    expect(truncateGraphemes('가나다라마바사', 4)).toBe('가나다…');
  });

  it('detects urls', () => {
    expect(containsUrl('see https://example.com/x')).toBe(true);
    expect(containsUrl('티켓 ENU-123 확인')).toBe(false);
  });

  it('detects personal data but not dates or ticket keys', () => {
    expect(detectPii('주민번호 900101-1234567')).toContain('rrn');
    expect(detectPii('연락처 010-1234-5678')).toContain('phone');
    expect(detectPii('카드 4111 1111 1111 1111')).toContain('card');
    expect(detectPii('계좌 110-123-456789')).toContain('account');
    expect(detectPii('2026-10-29 회의, ENU-1234 처리, v1.2.3 배포')).toEqual([]);
  });
});
