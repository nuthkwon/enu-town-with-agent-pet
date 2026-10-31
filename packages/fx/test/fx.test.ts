import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEN } from '../effects/_den.js';
import {
  CATALOG_FILE,
  MAX_STRIP_BYTES,
  VENDOR_DIR,
  bakeAll,
  catalogSource,
  checkEffect,
  effectIds,
  loadEffect,
  px,
  type BakedStrip,
} from '../src/index';

/** The effects toolkit: vendored pixelfx untouched, every effect passes the check, the bake is fresh. */

describe('vendored pixelfx', () => {
  const pinned = JSON.parse(readFileSync(join(VENDOR_DIR, 'VENDORED.json'), 'utf8')) as {
    commit: string;
    files: Record<string, string>;
  };

  it('is byte for byte the pinned upstream files', () => {
    for (const [file, sha] of Object.entries(pinned.files)) {
      const got = createHash('sha256')
        .update(readFileSync(join(VENDOR_DIR, file)))
        .digest('hex');
      expect(got, file).toBe(sha);
    }
  });

  it('holds only the listed files, with the licence and no fonts', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [relative(VENDOR_DIR, p)];
      });
    const files = walk(VENDOR_DIR).filter((f) => f !== 'VENDORED.json' && f !== 'VENDORED.md');
    expect(files.sort()).toEqual(Object.keys(pinned.files).sort());
    expect(files).toContain('LICENSE');
    expect(files).toContain('NOTICE.md');
    expect(files.some((f) => /\.(woff2?|ttf|otf)$/.test(f))).toBe(false);
  });
});

describe('house ramps', () => {
  it('run dark to bright, and every solid ramp starts at the plum ink', () => {
    for (const [name, ramp] of Object.entries(DEN)) {
      const l = ramp.map((h) => px.luma(px.hex(h)));
      for (let i = 1; i < l.length; i++) expect(l[i]!, `${name}[${i}]`).toBeGreaterThan(l[i - 1]!);
      if (name !== 'puff') expect(ramp[0], name).toBe('#3b2a52');
    }
  });
});

describe('effects', () => {
  const ids = effectIds();

  it.each(ids.length ? ids : ['(none)'])('%s passes the check', async (id) => {
    if (id === '(none)') return;
    const c = checkEffect(await loadEffect(id));
    expect(c.errors).toEqual([]);
  });

  describe('bake', () => {
    let strips: BakedStrip[] = [];
    beforeAll(async () => {
      strips = await bakeAll();
    });

    it('fits the byte budget for every strip', () => {
      for (const s of strips) expect(s.png.length, s.key).toBeLessThanOrEqual(MAX_STRIP_BYTES);
    });

    it('matches the committed catalog and strips (run `pnpm sprites:build` after changing an effect)', () => {
      expect(readFileSync(CATALOG_FILE, 'utf8')).toBe(catalogSource(strips));
      for (const s of strips) {
        const file = join(CATALOG_FILE, '..', '..', '..', '..', 'apps/web/public/assets/sprites/fx', s.file);
        expect(existsSync(file), s.file).toBe(true);
        expect(readFileSync(file).equals(s.png), s.file).toBe(true);
      }
    });
  });
});
