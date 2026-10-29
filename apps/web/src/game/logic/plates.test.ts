import { readFileSync } from 'node:fs';
import { loadOfficeWorld } from '@enu/map';
import { describe, expect, it } from 'vitest';
import { boxesOverlap, cardBox, pillBox, plateLayout, type Box } from './plates';

const world = loadOfficeWorld(
  JSON.parse(
    readFileSync(new URL('../../../public/assets/maps/office-606/office-606.tmj', import.meta.url), 'utf8'),
  ),
);
const layouts = world.desks.map((d) => plateLayout(world, d));

/** Worst cases measured in Galmuri: `오늘 업무 기록` with its icon (+ padding) and a 4-syllable name pill. */
const CARD = { w: 124, h: 50 };
const PILL = { w: 74, h: 16 };
/** Two-line card (`부재`, or `자리 비움 · ~HH:MM` without a 상태 문구). */
const SMALL_CARD_H = 37;

/** The visible body of a hovering 24x24 pet whose feet are 24 px into its tile (PetView), plus its bob. */
function petBody(tx: number, ty: number, zoom: number): Box {
  return { x: (tx * 32 + 16 - 10) * zoom, y: (ty * 32 + 5) * zoom, w: 20 * zoom, h: 19 * zoom };
}

function boxes(
  zoom: number,
): { deskId: string; card: Box; smallCard: Box; pill: Box; icon: Box; perch: Box }[] {
  const s = (v: number) => v * zoom;
  return layouts.map((l) => {
    const headY = s(l.seat.y * 32 + 29 - 27);
    const headX = s(l.seat.x * 32 + 16);
    const minX = l.minX === null ? null : s(l.minX);
    const maxX = l.maxX === null ? null : s(l.maxX);
    const perch = world.spots.perch(l.deskId);
    return {
      deskId: l.deskId,
      card: cardBox(s(l.card.x), s(l.card.y), l.card.alignY, CARD.w, CARD.h, minX, maxX),
      smallCard: cardBox(s(l.card.x), s(l.card.y), l.card.alignY, CARD.w, SMALL_CARD_H, minX, maxX),
      pill: pillBox(s(l.pill.x), s(l.pill.y), l.pill.align, PILL.w, PILL.h),
      icon: { x: headX - 8, y: headY - 17, w: 16, h: 16 },
      perch: petBody(perch.x, perch.y, zoom),
    };
  });
}

/** Rows two boxes share (0 = apart). */
function overlapRows(a: Box, b: Box): number {
  if (!(a.x < b.x + b.w && b.x < a.x + a.w)) return 0;
  return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

describe('desk plate layout on the 606 map', () => {
  it('has a layout for all 14 desks, with neighbour limits only between joined desks', () => {
    expect(layouts).toHaveLength(14);
    const byId = new Map(layouts.map((l) => [l.deskId, l]));
    expect(byId.get('L1a')).toMatchObject({ minX: null, maxX: 160, pill: { align: 'right' } });
    expect(byId.get('L1b')).toMatchObject({ minX: 160, maxX: null, pill: { align: 'left' } });
    expect(byId.get('R2a')).toMatchObject({ maxX: 544 });
    expect(byId.get('R2b')).toMatchObject({ minX: 544 });
    expect(byId.get('R1')).toMatchObject({
      minX: null,
      maxX: null,
      pill: { align: 'center' },
      card: { alignY: 'bottom' },
    });
  });

  it("keeps R1's plate inside the CEO room (on top of the desk, not on the glass wall under the chair)", () => {
    const r1 = layouts.find((l) => l.deskId === 'R1')!;
    const desk = world.deskById('R1')!;
    expect(r1.pill.y).toBeLessThan(desk.tileRect.y * 32);
    expect(r1.pill.y).toBeGreaterThan((desk.tileRect.y - 1) * 32);
    expect(world.isWalkable(Math.floor(r1.pill.x / 32), Math.floor(r1.pill.y / 32))).toBe(true);
  });

  for (const zoom of [1.5, 2]) {
    it(`never covers the pet perched in front of a hidden owner's seat at zoom ${zoom}`, () => {
      for (const b of boxes(zoom)) {
        expect(boxesOverlap(b.card, b.perch), `${b.deskId} card vs its perched pet`).toBe(false);
        expect(boxesOverlap(b.smallCard, b.perch), `${b.deskId} 2-line card vs its perched pet`).toBe(false);
      }
    });
  }

  it('leaves the perched pet visible at zoom 1 too (at most its top 4 px under a 3-line card)', () => {
    for (const b of boxes(1)) {
      expect(overlapRows(b.card, b.perch), `${b.deskId} card vs its perched pet`).toBeLessThanOrEqual(4);
      expect(overlapRows(b.smallCard, b.perch), `${b.deskId} 2-line card vs its perched pet`).toBe(0);
    }
  });

  for (const zoom of [1, 1.5, 2]) {
    it(`keeps every plate apart at zoom ${zoom}`, () => {
      const all = boxes(zoom);
      for (const a of all) {
        // A card never runs into the outer walls.
        expect(a.card.x).toBeGreaterThanOrEqual(32 * zoom);
        expect(a.card.x + a.card.w).toBeLessThanOrEqual(21 * 32 * zoom);
        // The owner's activity icon never covers their own seated plate.
        expect(boxesOverlap(a.pill, a.icon), `${a.deskId} pill vs icon`).toBe(false);
        for (const b of all) {
          if (a === b) continue;
          expect(boxesOverlap(a.card, b.card), `${a.deskId} card vs ${b.deskId} card`).toBe(false);
          expect(boxesOverlap(a.pill, b.pill), `${a.deskId} pill vs ${b.deskId} pill`).toBe(false);
          expect(boxesOverlap(a.card, b.pill), `${a.deskId} card vs ${b.deskId} pill`).toBe(false);
          expect(boxesOverlap(a.pill, b.icon), `${a.deskId} pill vs ${b.deskId} icon`).toBe(false);
        }
      }
    });
  }
});
