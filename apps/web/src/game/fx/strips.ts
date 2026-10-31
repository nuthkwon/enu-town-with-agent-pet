import { FX_CATALOG } from '@enu/fx/catalog';
import type { FxCatalogEntry } from '@enu/fx/types';
import type Phaser from 'phaser';

/**
 * The pixelfx strips the town plays (ADR 0008; baked from packages/fx/effects by `pnpm sprites:build`). A unit
 * test checks every id here is in the catalog, so a renamed effect fails CI instead of silently not drawing.
 */
export const TOWN_FX = [
  'spell/charge',
  'spell/fireball-fly',
  'spell/fireball-hit',
  'spell/coffee-fall',
  'spell/coffee-splash',
  'spell/zap-strike',
  'spell/zap-sparks',
  'spell/potion-fly',
  'spell/heal',
  'spell/highfive-hit',
  'spell/fireworks',
  'spell/combo-burst',
  'spell/raid-pillar',
  'spell/shield-block',
  'aura/focus-shield',
  'aura/mana-rest',
  'aura/party-cast',
  'aura/rune-ring',
  'town/warp-in',
  'town/blink-out',
  'town/rune-spark',
  'town/heart-burst',
  'town/plane-puff',
  'town/ping-bang',
  'town/bubble-pop',
] as const;

export type TownFxId = (typeof TOWN_FX)[number];

export function fxEntry(id: string): FxCatalogEntry | null {
  return (FX_CATALOG as Record<string, FxCatalogEntry>)[id] ?? null;
}

/** Texture and animation key of a strip (`fx` is the old effects sheet; these never collide with it). */
export const stripKey = (id: string): string => `pfx:${id}`;

/**
 * Loads strips on demand (the town preloads its own after the scene starts, so the first spell rarely waits).
 * A strip that fails to load is skipped: the moment it belonged to has passed.
 */
export class StripLoader {
  private readonly pending = new Map<string, Array<() => void>>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.load.on('loaderror', (file: Phaser.Loader.File) => {
      const key = String(file.key);
      if (key.startsWith('pfx:')) this.pending.delete(key.slice(4));
    });
  }

  ready(id: string): boolean {
    return this.scene.textures.exists(stripKey(id));
  }

  /** Loads what is missing; `onReady` runs once all of `ids` that exist in the catalog are loaded. */
  request(ids: readonly string[], onReady?: () => void): void {
    const missing = ids.filter((id) => fxEntry(id) && !this.ready(id));
    if (missing.length === 0) {
      onReady?.();
      return;
    }
    let left = missing.length;
    const one = () => {
      left--;
      if (left === 0) onReady?.();
    };
    for (const id of missing) {
      const waiting = this.pending.get(id);
      if (waiting) {
        waiting.push(one);
        continue;
      }
      const e = fxEntry(id)!;
      this.pending.set(id, [one]);
      this.scene.load.once(`filecomplete-spritesheet-${stripKey(id)}`, () => {
        const cbs = this.pending.get(id) ?? [];
        this.pending.delete(id);
        for (const cb of cbs) cb();
      });
      this.scene.load.spritesheet(stripKey(id), e.url, { frameWidth: e.w, frameHeight: e.h });
    }
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }

  /** The strip's animation (created once): every frame at the effect's fps, looping or once. */
  ensureAnim(id: string, e: FxCatalogEntry): string {
    const key = stripKey(id);
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers(key, { start: 0, end: e.frames - 1 }),
        frameRate: e.fps,
        repeat: e.loop ? -1 : 0,
      });
    }
    return key;
  }
}
