import Phaser from 'phaser';
import { PET_SPECIES } from '@enu/shared';
import { ko } from '@/i18n/ko';
import {
  TEX,
  ensureAvatarAnims,
  ensureEffectAnims,
  ensurePetAnims,
  isAvatarKey,
  loadAvatarSheet,
  loadEffects,
  loadPetSheet,
} from '../assets';
import { BRIDGE_REGISTRY_KEY, FONT_REGISTRY_KEY, type GameBridge } from '../bridge';
import { MAP_PATHS, SPRITE_PATHS } from '../spriteSpec';

export const STATIC_AVATARS_REGISTRY_KEY = 'enu-town-static-avatars';

/** Loads the tileset, effects, pets and the avatar sheets we already know about. */
export class PreloadScene extends Phaser.Scene {
  private label: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: 'preload' });
  }

  preload(): void {
    const bridge = this.registry.get(BRIDGE_REGISTRY_KEY) as GameBridge;
    const font = (this.registry.get(FONT_REGISTRY_KEY) as string | undefined) ?? 'Galmuri11, sans-serif';
    const { width, height } = this.scale;
    this.label = this.add
      .text(Math.round(width / 2), Math.round(height / 2), ko.townUi.loadingMap, {
        fontFamily: font,
        fontSize: '12px',
        color: '#5b4a73',
      })
      .setOrigin(0.5);
    this.load.on('progress', (v: number) => {
      this.label?.setText(`${ko.townUi.loadingMap} ${Math.round(v * 100)}%`);
    });

    // The .tmj was fetched (and hashed) by the React side already: hand Phaser the parsed JSON.
    if (!this.cache.tilemap.exists(TEX.map)) {
      this.cache.tilemap.add(TEX.map, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: bridge.map.json });
    }
    this.load.spritesheet(TEX.tiles, MAP_PATHS.tileset, { frameWidth: 32, frameHeight: 32 });
    loadEffects(this.load);
    for (const species of PET_SPECIES) loadPetSheet(this.load, species);
    this.load.json(TEX.manifest, SPRITE_PATHS.manifest);
  }

  create(): void {
    const bridge = this.registry.get(BRIDGE_REGISTRY_KEY) as GameBridge;
    const manifest = this.cache.json.get(TEX.manifest) as { avatars?: unknown } | undefined;
    // The generator writes `avatars` as { key: path }; older manifests used a list of keys.
    const raw = manifest?.avatars;
    const listed: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.keys(raw) : [];
    const staticKeys = new Set<string>(listed.filter((k): k is string => typeof k === 'string' && isAvatarKey(k)));
    this.registry.set(STATIC_AVATARS_REGISTRY_KEY, staticKeys);

    const wanted = new Set<string>([bridge.me.avatarKey]);
    for (const p of bridge.directory.people) wanted.add(p.avatarKey);
    for (const p of bridge.session.allPlayers()) wanted.add(p.avatar);
    for (const key of wanted) {
      if (isAvatarKey(key) && !this.textures.exists(TEX.avatar(key))) loadAvatarSheet(this.load, key, staticKeys);
    }
    this.load.once('complete', () => {
      ensureEffectAnims(this);
      for (const species of PET_SPECIES) ensurePetAnims(this, species);
      for (const key of wanted) if (isAvatarKey(key)) ensureAvatarAnims(this, key);
      this.label?.destroy();
      this.scene.start('world');
      this.scene.launch('ui');
    });
    this.load.start();
  }
}
