import { readFileSync } from 'node:fs';
import { loadOfficeWorld } from '@enu/map';
import { describe, expect, it } from 'vitest';
import { boxesOverlap, cardBox, pillBox, plateLayout, type Box } from './plates';

const world = loadOfficeWorld(
  JSON.parse(readFileSync(new URL('../../../public/assets/maps/office-606/office-606.tmj', import.meta.url), 'utf8')),
);
const layouts = world.desks.map((d) => plateLayout(world, d));

/** Worst cases measured in Galmuri: `오늘 업무 기록` with its icon (+ padding) and a 4-syllable name pill. */
const CARD = { w: 122, h: 50 };
const PILL = { w: 74, h: 16 };

function boxes(zoom: number): { deskId: string; card: Box; pill: Box; icon: Box }[] {
  const s = (v: number) => v * zoom;
  return layouts.map((l) => {
    const headY = s(l.seat.y * 32 + 29 - 27);
    const headX = s(l.seat.x * 32 + 16);
    return {
      deskId: l.deskId,
      card: cardBox(s(l.card.x), s(l.card.y), CARD.w, CARD.h, l.minX === null ? null : s(l.minX), l.maxX === null ? null : s(l.maxX)),
      pill: pillBox(s(l.pill.x), s(l.pill.y), l.pill.align, PILL.w, PILL.h),
      icon: { x: headX - 8, y: headY - 17, w: 16, h: 16 },
    };
  });
}

describe('desk plate layout on the 606 map', () => {
  it('has a layout for all 14 desks, with neighbour limits only between joined desks', () => {
    expect(layouts).toHaveLength(14);
    const byId = new Map(layouts.map((l) => [l.deskId, l]));
    expect(byId.get('L1a')).toMatchObject({ minX: null, maxX: 160, pill: { align: 'right' } });
    expect(byId.get('L1b')).toMatchObject({ minX: 160, maxX: null, pill: { align: 'left' } });
    expect(byId.get('R2a')).toMatchObject({ maxX: 544 });
    expect(byId.get('R2b')).toMatchObject({ minX: 544 });
    expect(byId.get('R1')).toMatchObject({ minX: null, maxX: null, pill: { align: 'center' } });
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
