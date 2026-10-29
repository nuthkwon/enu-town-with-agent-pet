import {
  type AvatarPreset,
  BODY_TYPES,
  DEFAULT_AVATAR,
  DESK_IDS,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  PET_SPECIES,
  SKIN_TONES,
  TILE_CATALOG,
  TILESET_COLUMNS,
} from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_ANIMS,
  AVATAR_COLUMNS,
  AVATAR_DIRECTIONS,
  AVATAR_FEET_Y,
  AVATAR_WALK_LIFT,
  AVATAR_FRAME,
  type Canvas,
  EFFECT_COLUMNS,
  EFFECT_FRAME,
  EFFECT_FRAMES,
  EFFECT_ROWS,
  EFFECT_SHEET_HEIGHT,
  PET_ANIMS,
  PET_COLUMNS,
  PET_FRAME,
  PET_GROUND_Y,
  TILE,
  TILESET_HEIGHT,
  TILESET_WIDTH,
  avatarAnimFrames,
  decodePng,
  petAnimFrames,
  renderAvatarFrame,
  renderAvatarSheet,
  renderEffects,
  renderPetFrame,
  renderPetSheet,
  renderTileset,
} from '../src/index';
import { PET_ART } from '../src/parts/pets';

function frame(sheet: Canvas, size: number, columns: number, index: number): Canvas {
  return sheet.crop((index % columns) * size, Math.floor(index / columns) * size, size, size);
}

/** Lowest / highest row containing a solid pixel (alpha >= 128), or -1. */
function rows(c: Canvas): { top: number; bottom: number } {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (c.alpha(x, y) >= 128) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  return { top, bottom };
}

const variant = (over: Partial<AvatarPreset>): AvatarPreset => ({ ...DEFAULT_AVATAR, ...over });

describe('sheet dimensions follow the spec', () => {
  it('avatar: 10 columns x 4 directions of 32x32', () => {
    const png = decodePng(renderAvatarSheet(DEFAULT_AVATAR));
    expect(png.width).toBe(AVATAR_COLUMNS * AVATAR_FRAME);
    expect(png.height).toBe(AVATAR_DIRECTIONS.length * AVATAR_FRAME);
    expect(AVATAR_COLUMNS).toBe(AVATAR_ANIMS.idle.frames + AVATAR_ANIMS.walk.frames);
    expect([png.width, png.height]).toEqual([320, 128]);
  });

  it('pet: 12 columns (idle, hop, sleep) x 2 directions of 24x24, one sheet per species', () => {
    expect(PET_SPECIES).toHaveLength(16);
    for (const species of PET_SPECIES) {
      const png = decodePng(renderPetSheet(species));
      expect([png.width, png.height]).toEqual([PET_COLUMNS * PET_FRAME, 2 * PET_FRAME]);
    }
    expect(PET_COLUMNS).toBe(PET_ANIMS.idle.frames + PET_ANIMS.hop.frames + PET_ANIMS.sleep.frames);
  });

  it('tileset: TILESET_COLUMNS x ceil(n / columns) tiles of 32px', () => {
    const png = decodePng(renderTileset());
    expect(png.width).toBe(TILESET_WIDTH);
    expect(png.height).toBe(TILESET_HEIGHT);
    expect(png.width).toBe(TILESET_COLUMNS * TILE);
    expect(png.height).toBe(Math.ceil(TILE_CATALOG.length / TILESET_COLUMNS) * TILE);
  });

  it('effects: 16x16 frames, every named frame inside the sheet', () => {
    const png = decodePng(renderEffects());
    expect(png.width).toBe(EFFECT_COLUMNS * EFFECT_FRAME);
    const maxIndex = Math.max(...Object.values(EFFECT_FRAMES));
    expect(png.height).toBe((Math.floor(maxIndex / EFFECT_COLUMNS) + 1) * EFFECT_FRAME);
  });

  it('effects: 3 rows, the activity icons fixed at 16-23 (the web client mirrors these indices)', () => {
    const png = decodePng(renderEffects());
    expect(EFFECT_ROWS).toBe(3);
    expect([png.width, png.height]).toEqual([128, 48]);
    expect(png.height).toBe(EFFECT_SHEET_HEIGHT);
    expect(EFFECT_FRAMES).toMatchObject({
      headset: 16,
      focus: 17,
      cup: 18,
      laptop: 19,
      magnifier: 20,
      link: 21,
      clipboard: 22,
      plane: 23,
    });
    // every cell of the sheet is named exactly once (no gaps, no two names on one frame)
    const indices = Object.values(EFFECT_FRAMES).sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: EFFECT_ROWS * EFFECT_COLUMNS }, (_, i) => i));
  });

  it('anim frame ranges are row * columns + col', () => {
    expect(avatarAnimFrames('down', 'idle')).toEqual({ start: 0, end: 3 });
    expect(avatarAnimFrames('up', 'walk')).toEqual({ start: 34, end: 39 });
    expect(petAnimFrames('right', 'sleep')).toEqual({ start: 22, end: 23 });
  });
});

describe('determinism', () => {
  it('same input gives identical bytes', () => {
    const p = variant({ body: 'f', hair: 'ponytail', hairColor: 'pink', wings: true });
    expect(renderAvatarSheet(p).equals(renderAvatarSheet({ ...p }))).toBe(true);
    expect(renderPetSheet('fox').equals(renderPetSheet('fox'))).toBe(true);
    expect(renderTileset().equals(renderTileset())).toBe(true);
    expect(renderEffects().equals(renderEffects())).toBe(true);
  });
});

describe('content', () => {
  it("every tile except 'void' has pixels", () => {
    const sheet = decodePng(renderTileset());
    TILE_CATALOG.forEach((t, i) => {
      const tile = frame(sheet, TILE, TILESET_COLUMNS, i);
      expect(tile.hasContent(), t.name).toBe(t.name !== 'void');
    });
  });

  it('floors and walls are opaque (no holes under characters)', () => {
    const sheet = decodePng(renderTileset());
    const opaque = [
      'floor_carpet',
      'floor_runner',
      'floor_wood',
      'floor_tile',
      'floor_meeting',
      'floor_server',
      'wall',
      'window',
    ];
    for (const name of opaque) {
      const tile = frame(
        sheet,
        TILE,
        TILESET_COLUMNS,
        TILE_CATALOG.findIndex((t) => t.name === name),
      );
      let min = 255;
      for (let i = 3; i < tile.data.length; i += 4) min = Math.min(min, tile.data[i]!);
      expect(min, name).toBe(255);
    }
  });

  it('every effect frame has pixels', () => {
    const sheet = decodePng(renderEffects());
    for (const [name, idx] of Object.entries(EFFECT_FRAMES)) {
      expect(frame(sheet, EFFECT_FRAME, EFFECT_COLUMNS, idx).hasContent(), name).toBe(true);
    }
  });

  it('every effect frame is a different picture', () => {
    const sheet = decodePng(renderEffects());
    const seen = new Map<string, string>();
    for (const [name, idx] of Object.entries(EFFECT_FRAMES)) {
      const bytes = Buffer.from(frame(sheet, EFFECT_FRAME, EFFECT_COLUMNS, idx).data).toString('base64');
      expect(seen.get(bytes), name).toBeUndefined();
      seen.set(bytes, name);
    }
  });

  it('pets differ per species', () => {
    const sheets = PET_SPECIES.map((s) => renderPetSheet(s));
    for (let i = 0; i < sheets.length; i++)
      for (let j = i + 1; j < sheets.length; j++) expect(sheets[i]!.equals(sheets[j]!)).toBe(false);
  });

  it('there is a different pet species for every desk', () => {
    expect(new Set(PET_SPECIES).size).toBe(PET_SPECIES.length);
    expect(PET_SPECIES.length).toBeGreaterThanOrEqual(DESK_IDS.length);
  });

  it('every two species look clearly different (shape and colour), not just recoloured details', () => {
    // Idle frame 0 facing left: the silhouettes must differ, and a large share of the pet's pixels
    // must differ in colour (catches copy-pasted templates with a few changed pixels).
    const frames = PET_SPECIES.map((s) => renderPetFrame(s, 'left', 'idle', 0).data);
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const a = frames[i]!;
        const b = frames[j]!;
        let union = 0;
        let shape = 0;
        let differs = 0;
        for (let p = 0; p < a.length; p += 4) {
          const sa = a[p + 3]! >= 128;
          const sb = b[p + 3]! >= 128;
          if (!sa && !sb) continue;
          union++;
          if (sa !== sb) {
            shape++;
            differs++;
          } else if (Math.hypot(a[p]! - b[p]!, a[p + 1]! - b[p + 1]!, a[p + 2]! - b[p + 2]!) > 48) differs++;
        }
        const pair = `${PET_SPECIES[i]} / ${PET_SPECIES[j]}`;
        expect(shape, pair).toBeGreaterThanOrEqual(10);
        expect(differs / union, pair).toBeGreaterThan(0.4);
      }
    }
  });

  it('sleeping pets close their eyes (the eye shine is gone)', () => {
    const isWhite = (c: Canvas, x: number, y: number): boolean => c.get(x, y).every((v) => v === 255);
    for (const species of PET_SPECIES) {
      const { body } = PET_ART[species];
      const x0 = Math.floor((PET_FRAME - Math.max(...body.map((r) => r.length))) / 2) - 1;
      const awake = renderPetFrame(species, 'left', 'idle', 0); // body bottom on row 18
      const asleep = renderPetFrame(species, 'left', 'sleep', 0); // body bottom on row 21
      let shines = 0;
      body.forEach((row, ty) =>
        [...row].forEach((ch, tx) => {
          if (ch !== 'w') return;
          shines++;
          expect(isWhite(awake, x0 + tx, 18 - body.length + 1 + ty), `${species} awake`).toBe(true);
          expect(isWhite(asleep, x0 + tx, 21 - body.length + 1 + ty), `${species} asleep`).toBe(false);
        }),
      );
      expect(shines, species).toBeGreaterThan(0);
    }
  });

  it('every pet frame has pixels; sleeping:false leaves the sleep cells empty', () => {
    for (const species of PET_SPECIES) {
      const sheet = decodePng(renderPetSheet(species));
      for (let i = 0; i < PET_COLUMNS * 2; i++)
        expect(frame(sheet, PET_FRAME, PET_COLUMNS, i).hasContent()).toBe(true);
      const awake = decodePng(renderPetSheet(species, { sleeping: false }));
      const { start, end } = petAnimFrames('left', 'sleep');
      for (let i = start; i <= end; i++)
        expect(frame(awake, PET_FRAME, PET_COLUMNS, i).hasContent()).toBe(false);
      expect(frame(awake, PET_FRAME, PET_COLUMNS, 0).hasContent()).toBe(true);
    }
  });

  it('pets float above the ground line and never clip the frame', () => {
    for (const species of PET_SPECIES) {
      const sheet = decodePng(renderPetSheet(species));
      for (let i = 0; i < PET_COLUMNS * 2; i++) {
        const { top, bottom } = rows(frame(sheet, PET_FRAME, PET_COLUMNS, i));
        expect(top, `${species} #${i}`).toBeGreaterThan(0);
        expect(bottom, `${species} #${i}`).toBeLessThan(PET_GROUND_Y);
      }
    }
  });

  it('avatars differ per body, hair style, hair colour, outfit, skin and wings', () => {
    const base = renderAvatarSheet(DEFAULT_AVATAR);
    const differs = (p: AvatarPreset): boolean => !renderAvatarSheet(p).equals(base);
    for (const body of BODY_TYPES)
      if (body !== DEFAULT_AVATAR.body) expect(differs(variant({ body }))).toBe(true);
    for (const hair of HAIR_STYLES)
      if (hair !== DEFAULT_AVATAR.hair) expect(differs(variant({ hair })), hair).toBe(true);
    for (const hairColor of HAIR_COLORS)
      if (hairColor !== DEFAULT_AVATAR.hairColor)
        expect(differs(variant({ hairColor })), hairColor).toBe(true);
    for (const outfit of OUTFIT_COLORS)
      if (outfit !== DEFAULT_AVATAR.outfit) expect(differs(variant({ outfit })), outfit).toBe(true);
    for (const skin of SKIN_TONES)
      if (skin !== DEFAULT_AVATAR.skin) expect(differs(variant({ skin })), skin).toBe(true);
    expect(differs(variant({ wings: true }))).toBe(true);
  });

  it('every hair style has its own silhouette', () => {
    const silhouettes = HAIR_STYLES.map((hair) => {
      const f = renderAvatarFrame(variant({ hair }), 'down', 'idle', 0);
      let bits = '';
      for (let i = 3; i < f.data.length; i += 4) bits += f.data[i]! >= 128 ? '1' : '0';
      return bits;
    });
    expect(new Set(silhouettes).size).toBe(HAIR_STYLES.length);
  });

  it('feet rest on a constant baseline when grounded and hops never clip the top', () => {
    const presets = [
      DEFAULT_AVATAR,
      variant({ body: 'f', hair: 'bun', wings: true }),
      variant({ hair: 'long' }),
    ];
    for (const p of presets) {
      for (const dir of AVATAR_DIRECTIONS) {
        for (let i = 0; i < AVATAR_ANIMS.idle.frames; i++) {
          const { top, bottom } = rows(renderAvatarFrame(p, dir, 'idle', i));
          expect(bottom).toBe(AVATAR_FEET_Y - 1);
          expect(top).toBeGreaterThan(0);
        }
        for (let i = 0; i < AVATAR_ANIMS.walk.frames; i++) {
          const { top, bottom } = rows(renderAvatarFrame(p, dir, 'walk', i));
          expect(bottom).toBe(AVATAR_FEET_Y - 1 - AVATAR_WALK_LIFT[i]!);
          expect(top).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('right is the mirror of left', () => {
    const p = variant({ hair: 'ponytail', body: 'f' });
    const left = renderAvatarFrame(p, 'left', 'walk', 2);
    const right = renderAvatarFrame(p, 'right', 'walk', 2);
    expect(Buffer.from(right.data).equals(Buffer.from(left.flipX().data))).toBe(true);
  });
});

describe('performance', () => {
  it('renderAvatarSheet is fast enough for on-demand rendering (< 50 ms)', () => {
    const p = variant({ body: 'f', hair: 'curly', wings: true });
    renderAvatarSheet(p); // warm-up (JIT)
    const runs = 10;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++)
      renderAvatarSheet({ ...p, outfit: OUTFIT_COLORS[i % OUTFIT_COLORS.length]! });
    expect((performance.now() - t0) / runs).toBeLessThan(50);
  });
});
