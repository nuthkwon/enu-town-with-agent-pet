import { describe, expect, it } from 'vitest';
import { ELLIPSIS, clampLines, graphemes, layoutText, wrapText, type Measure } from './textLayout';

/** Fake monospace font: every grapheme is 10px wide (spaces too). */
const mono: Measure = (t) => graphemes(t).length * 10;

describe('graphemes', () => {
  it('keeps Hangul syllables and emoji sequences whole', () => {
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(graphemes(`가나${family}다`)).toEqual(['가', '나', family, '다']);
  });
});

describe('wrapText', () => {
  it('breaks at spaces and never exceeds the width', () => {
    const lines = wrapText('오늘 PR 리뷰 하나만 먼저 끝내 볼까요?', 80, mono);
    expect(lines).toEqual(['오늘 PR 리뷰', '하나만 먼저', '끝내 볼까요?']);
    for (const l of lines) expect(mono(l)).toBeLessThanOrEqual(80);
  });

  it('breaks long words between graphemes', () => {
    expect(wrapText('가나다라마바사아자차', 40, mono)).toEqual(['가나다라', '마바사아', '자차']);
  });

  it('keeps explicit newlines', () => {
    expect(wrapText('첫 줄\n둘째 줄', 200, mono)).toEqual(['첫 줄', '둘째 줄']);
  });

  it('does not lose or reorder text (only spaces at breaks)', () => {
    const text = '14시 회의 전에 자료 한 번 더 확인해 볼까요? 발표 순서도 같이 정리해요.';
    const lines = wrapText(text, 70, mono);
    expect(lines.join(' ')).toBe(text);
  });
});

describe('clampLines / layoutText', () => {
  it('returns everything when it fits', () => {
    const r = layoutText('짧은 말', { maxWidth: 100, maxLines: 4, measure: mono });
    expect(r).toEqual({ lines: ['짧은 말'], truncated: false, width: 40 });
  });

  it('cuts to maxLines and ends the last line with an ellipsis that still fits', () => {
    const lines = ['가나다라', '마바사아', '자차카타', '파하가나', '다라'];
    const r = clampLines(lines, 4, 40, mono);
    expect(r.truncated).toBe(true);
    expect(r.lines).toHaveLength(4);
    expect(r.lines[3]).toBe(`파하가${ELLIPSIS}`);
    expect(mono(r.lines[3] ?? '')).toBeLessThanOrEqual(40);
    expect(r.lines.slice(0, 3)).toEqual(lines.slice(0, 3));
  });

  it('never splits an emoji when truncating', () => {
    const heart = String.fromCodePoint(0x2764, 0xfe0f);
    const r = layoutText(`aaa ${heart}${heart}${heart}${heart} bbb ccc ddd eee`, {
      maxWidth: 40,
      maxLines: 2,
      measure: mono,
    });
    expect(r.truncated).toBe(true);
    const last = r.lines.at(-1) ?? '';
    expect(last.endsWith(ELLIPSIS)).toBe(true);
    // every grapheme of the result is one of the original graphemes (or the ellipsis)
    for (const g of graphemes(last)) expect([heart, ELLIPSIS, 'a', 'b', 'c', 'd', 'e', ' ']).toContain(g);
  });

  it('is a pure prefix of the original text when truncated', () => {
    const text = '점심 전에 견적서 회신 보내 두면 좋겠어요! 그리고 오후에는 배포 체크리스트를 같이 봐요.';
    const r = layoutText(text, { maxWidth: 60, maxLines: 4, measure: mono });
    expect(r.truncated).toBe(true);
    const shown = r.lines.join(' ').replace(ELLIPSIS, '');
    expect(text.startsWith(shown.trimEnd())).toBe(true);
  });
});
