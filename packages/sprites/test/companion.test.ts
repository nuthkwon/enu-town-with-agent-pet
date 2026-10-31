import { PET_SPECIES, PET_TINTS } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  COMPANION_COLUMNS,
  COMPANION_EXPRESSIONS,
  COMPANION_FRAME,
  type Canvas,
  type CompanionExpression,
  decodePng,
  renderCompanionFrame,
  renderCompanionSheet,
  renderPetFrame,
  renderPetSheet,
} from '../src/index';
import { MOUTH_KEY, openMouth } from '../src/parts/faces';
import { PET_ART } from '../src/parts/pets';

const same = (a: Canvas, b: Canvas): boolean => {
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) if (a.get(x, y).join() !== b.get(x, y).join()) return false;
  return true;
};

describe('pet tints', () => {
  it('base is the plain sheet and every tint gives a different picture', () => {
    for (const species of PET_SPECIES) {
      const base = renderPetSheet(species);
      expect(renderPetSheet(species, { tint: 'base' }).equals(base)).toBe(true);
      const sheets = PET_TINTS.map((tint) => renderPetSheet(species, { tint }).toString('base64'));
      expect(new Set(sheets).size, species).toBe(PET_TINTS.length);
    }
  });

  it('keeps the eyes, outline and silhouette', () => {
    for (const species of PET_SPECIES) {
      const base = renderPetFrame(species, 'left', 'idle', 0);
      for (const tint of PET_TINTS) {
        const tinted = renderPetFrame(species, 'left', 'idle', 0, tint);
        for (let y = 0; y < base.height; y++) {
          for (let x = 0; x < base.width; x++) {
            expect(tinted.alpha(x, y) > 0, `${species} ${tint} ${x},${y}`).toBe(base.alpha(x, y) > 0);
            const px = base.get(x, y);
            // White eye shine stays white.
            if (px.every((v) => v === 255)) expect(tinted.get(x, y)).toEqual(px);
          }
        }
      }
    }
  });
});

describe('companion sheets', () => {
  it('are one row of 26 frames of 24x24, every frame drawn', () => {
    for (const species of PET_SPECIES) {
      const sheet = decodePng(renderCompanionSheet(species));
      expect([sheet.width, sheet.height]).toEqual([COMPANION_COLUMNS * COMPANION_FRAME, COMPANION_FRAME]);
      expect(COMPANION_COLUMNS).toBe(26);
      for (let i = 0; i < COMPANION_COLUMNS; i++) {
        expect(sheet.crop(i * COMPANION_FRAME, 0, COMPANION_FRAME, COMPANION_FRAME).hasContent()).toBe(true);
      }
    }
  });

  it('cover the columns exactly once', () => {
    const cols = Object.values(COMPANION_EXPRESSIONS).flatMap((d) =>
      Array.from({ length: d.frames }, (_, i) => d.start + i),
    );
    expect(cols).toEqual(Array.from({ length: COMPANION_COLUMNS }, (_, i) => i));
  });

  it('idle matches the town pet and every expression changes the face', () => {
    for (const species of PET_SPECIES) {
      const idle = renderCompanionFrame(species, 'idle', 0);
      expect(same(idle, renderPetFrame(species, 'left', 'idle', 0)), species).toBe(true);
      const differs = (expr: CompanionExpression, i: number, from: Canvas) =>
        expect(same(renderCompanionFrame(species, expr, i), from), `${species} ${expr} ${i}`).toBe(false);
      differs('blink', 1, idle);
      differs('listen', 0, idle);
      differs('think', 0, idle);
      differs('talk', 1, renderCompanionFrame(species, 'talk', 0));
      differs('happy', 0, idle);
      differs('sleep', 0, idle);
      differs('eat', 0, idle);
      differs('eat', 1, renderCompanionFrame(species, 'eat', 0));
      differs('cast', 0, idle);
      differs('cast', 1, renderCompanionFrame(species, 'cast', 0));
    }
  });

  it('eat and cast sit at the end of the row and keep their props inside the frame', () => {
    expect(COMPANION_EXPRESSIONS.eat).toMatchObject({ start: 22, frames: 2 });
    expect(COMPANION_EXPRESSIONS.cast).toMatchObject({ start: 24, frames: 2 });
    for (const species of PET_SPECIES)
      for (const expr of ['eat', 'cast'] as const)
        for (let i = 0; i < 2; i++) {
          const f = renderCompanionFrame(species, expr, i);
          for (let k = 0; k < COMPANION_FRAME; k++) {
            expect(f.alpha(0, k), `${species} ${expr} ${i} left edge`).toBe(0);
            expect(f.alpha(k, 0), `${species} ${expr} ${i} top edge`).toBe(0);
          }
        }
  });

  it('open a mouth on every species (beaks and big noses included)', () => {
    for (const species of PET_SPECIES) {
      const art = PET_ART[species];
      const opened = openMouth(art.body, art.mouth);
      expect(opened.join('').split(MOUTH_KEY).length - 1, species).toBeGreaterThanOrEqual(3);
      expect(art.body.join(''), species).not.toContain(MOUTH_KEY);
    }
  });

  it('tint like the town sheet and stay deterministic', () => {
    expect(renderCompanionSheet('owl', 'mint').equals(renderCompanionSheet('owl', 'mint'))).toBe(true);
    expect(renderCompanionSheet('owl', 'mint').equals(renderCompanionSheet('owl'))).toBe(false);
    expect(
      same(renderCompanionFrame('owl', 'idle', 0, 'mint'), renderPetFrame('owl', 'left', 'idle', 0, 'mint')),
    ).toBe(true);
  });
});
