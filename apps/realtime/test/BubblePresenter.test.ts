import { BubbleKind, Indicator } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import {
  BubblePresenter,
  type BubblePet,
  type DeliveryRecord,
  type DeliveryStore,
} from '../src/pet/BubblePresenter';
import { nudgeRowToCandidate, todoRowToCandidate } from '../src/pet/CandidateLoader';
import { ManualClock, kst } from './helpers/unit';

function emptyPet(): BubblePet {
  return { bubbleId: '', bubbleKind: 0, bubbleText: '', bubbleDueAt: 0, bubbleUntil: 0, indicator: 0 };
}

class MemoryStore implements DeliveryStore {
  records: DeliveryRecord[] = [];
  result = true;
  async recordShown(r: DeliveryRecord): Promise<boolean> {
    this.records.push(r);
    return this.result;
  }
}

const now = kst(2026, 10, 28, 10, 0);
const nudge = (text: string, dueAt: Date | null = null) =>
  nudgeRowToCandidate({
    id: '0190aaaa-0000-7000-8000-000000000001',
    text,
    priority: 2,
    showAfter: new Date(now.getTime() - 60_000),
    snoozedUntil: null,
    expiresAt: new Date(now.getTime() + 3_600_000),
    showCount: 0,
    maxShows: 2,
    createdAt: new Date(now.getTime() - 120_000),
    dueAt,
  });

// Texts that a careless presenter might "improve": spacing, punctuation, emoji, time-like content, newlines.
const TRICKY = [
  '오늘 14시 회의 자료 챙기셨나요?',
  '  앞뒤 공백도 그대로  ',
  '마감이 곧이에요 ⏰',
  'Line one\nline two',
  '🐱‍👤 ZWJ 이모지와 "따옴표" <b>태그처럼 보이는 글</b>',
  'a',
  '가'.repeat(120),
];

describe('BubblePresenter', () => {
  it('shows Claude text verbatim and never adds anything (due time only in bubbleDueAt)', async () => {
    const store = new MemoryStore();
    const presenter = new BubblePresenter({ store, clock: new ManualClock(now.getTime()) });
    const due = kst(2026, 10, 28, 14, 0);
    for (const text of TRICKY) {
      const pet = emptyPet();
      const candidate = nudge(text, due);
      await presenter.show(pet, { userId: 'u1', candidate, trigger: 'join' });
      expect(pet.bubbleText).toBe(text);
      expect(pet.bubbleText.length).toBe(text.length);
      expect(pet.bubbleText).not.toContain('14:00');
      expect(pet.bubbleDueAt).toBe(due.getTime());
      expect(pet.indicator).toBe(Indicator.None);
      expect(pet.bubbleKind).toBe(BubbleKind.Nudge);
      expect(pet.bubbleId).toBe(candidate.refId);
      expect(pet.bubbleUntil).toBeGreaterThanOrEqual(now.getTime() + 6000);
      expect(pet.bubbleUntil).toBeLessThanOrEqual(now.getTime() + 15000);
    }
    expect(store.records).toHaveLength(TRICKY.length);
    expect(store.records[0]).toMatchObject({ userId: 'u1', trigger: 'join', dueKey: null, shownAt: now });
  });

  it('to-do due bubbles show the to-do title verbatim with the due time outside the text', async () => {
    const store = new MemoryStore();
    const presenter = new BubblePresenter({ store, clock: new ManualClock(now.getTime()) });
    const dueAt = new Date(now.getTime() + 5 * 60_000);
    const candidate = todoRowToCandidate(
      { id: 't1', title: '주간 보고서 제출', priority: 1, dueAt, createdAt: now },
      { dueWindowsMin: [30, 5] },
    );
    const pet = emptyPet();
    await presenter.show(pet, { userId: 'u1', candidate, trigger: 'due', dueKey: 't1:5' });
    expect(pet.bubbleText).toBe('주간 보고서 제출');
    expect(pet.bubbleKind).toBe(BubbleKind.TodoDue);
    expect(pet.bubbleDueAt).toBe(dueAt.getTime());
    expect(store.records[0]).toMatchObject({ trigger: 'due', dueKey: 't1:5' });
  });

  it('bubbleDueAt is 0 without a due time; hide() clears everything', async () => {
    const presenter = new BubblePresenter({
      store: new MemoryStore(),
      clock: new ManualClock(now.getTime()),
    });
    const pet = emptyPet();
    await presenter.show(pet, {
      userId: 'u1',
      candidate: nudge('물 한 잔 드세요'),
      trigger: 'glance',
    });
    expect(pet.bubbleDueAt).toBe(0);
    presenter.hide(pet);
    expect(pet).toEqual({
      bubbleId: '',
      bubbleKind: 0,
      bubbleText: '',
      bubbleDueAt: 0,
      bubbleUntil: 0,
      indicator: Indicator.None,
    });
  });

  it('takes the bubble down when the store says the nudge is gone', async () => {
    const store = new MemoryStore();
    store.result = false;
    const presenter = new BubblePresenter({ store, clock: new ManualClock(now.getTime()) });
    const pet = emptyPet();
    const ok = await presenter.show(pet, {
      userId: 'u1',
      candidate: nudge('곧 사라질 넛지'),
      trigger: 'join',
    });
    expect(ok).toBe(false);
    expect(pet.bubbleText).toBe('');
    expect(pet.indicator).toBe(Indicator.None);
  });

  it('never sets the shared indicator: a bubble onset would tell colleagues the tab is visible', async () => {
    const store = new MemoryStore();
    const presenter = new BubblePresenter({ store, clock: new ManualClock(now.getTime()) });
    const pet = emptyPet();
    const candidate = nudge('주인에게만 보여요');
    await presenter.show(pet, { userId: 'u1', candidate, trigger: 'eligible' });
    expect(pet.bubbleText).toBe('주인에게만 보여요');
    expect(pet.bubbleId).toBe(candidate.refId);
    expect(pet.indicator).toBe(Indicator.None);
    expect(store.records[0]).toMatchObject({ trigger: 'eligible' });
  });
});
