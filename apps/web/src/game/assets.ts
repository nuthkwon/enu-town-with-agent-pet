import type Phaser from 'phaser';
import { avatarAnimKey, avatarFrames, petAnimKey, petFrames } from './logic/direction';
import {
  AVATAR_ANIMS,
  AVATAR_DIRECTIONS,
  AVATAR_FRAME,
  EFFECT_FRAME,
  EFFECT_FRAMES,
  PET_ANIMS,
  PET_DIRECTIONS,
  PET_FRAME,
  SPRITE_PATHS,
} from './spriteSpec';

export const TEX = {
  effects: 'fx',
  tiles: 'office-tiles',
  manifest: 'sprite-manifest',
  map: 'office-606',
  pet: (species: string) => `pet-${species}`,
  avatar: (key: string) => `av:${key}`,
} as const;

export const FX_SPARKLE_ANIM = 'fx:sparkle';
export const FX_DOTS_ANIM = 'fx:dots';

/** `av-{body}-{hair}-{hairColor}-{outfit}-{skin}`, then `-w` (wings) and `-n` (no hat), in that order. */
const AVATAR_KEY_RE = /^av-[a-z]+(-[a-z]+){4}(-w)?(-n)?$/;
const SPECIES_RE = /^[a-z]{2,16}$/;

export function isAvatarKey(key: string): boolean {
  return key.length <= 64 && AVATAR_KEY_RE.test(key);
}

export function isSpecies(species: string): boolean {
  return SPECIES_RE.test(species);
}

/** Static sheets listed in the generated manifest; anything else comes from the sprite API. */
export function avatarSheetUrl(key: string, staticKeys: ReadonlySet<string>): string {
  return staticKeys.has(key) ? SPRITE_PATHS.avatarStatic(key) : SPRITE_PATHS.avatarApi(key);
}

export function loadAvatarSheet(
  load: Phaser.Loader.LoaderPlugin,
  key: string,
  staticKeys: ReadonlySet<string>,
): void {
  load.spritesheet(TEX.avatar(key), avatarSheetUrl(key, staticKeys), {
    frameWidth: AVATAR_FRAME,
    frameHeight: AVATAR_FRAME,
  });
}

export function loadPetSheet(load: Phaser.Loader.LoaderPlugin, species: string): void {
  load.spritesheet(TEX.pet(species), SPRITE_PATHS.pet(species), {
    frameWidth: PET_FRAME,
    frameHeight: PET_FRAME,
  });
}

/**
 * Tinted pet sheets (`pt-<species>-<tint>` from the sprite API), loaded once on demand; base looks are preloaded.
 * `onReady` runs when the texture and its animations exist.
 */
export class PetSheetLoader {
  private readonly pending = new Map<string, Array<() => void>>();

  constructor(private readonly scene: Phaser.Scene) {}

  request(look: string, onReady: () => void): void {
    const tex = TEX.pet(look);
    if (this.scene.textures.exists(tex)) {
      ensurePetAnims(this.scene, look);
      onReady();
      return;
    }
    if (!/^[a-z]{2,16}-[a-z]{2,16}$/.test(look)) return;
    const waiting = this.pending.get(look);
    if (waiting) {
      waiting.push(onReady);
      return;
    }
    this.pending.set(look, [onReady]);
    this.scene.load.once(`filecomplete-spritesheet-${tex}`, () => {
      ensurePetAnims(this.scene, look);
      const cbs = this.pending.get(look) ?? [];
      this.pending.delete(look);
      for (const cb of cbs) cb();
    });
    this.scene.load.spritesheet(tex, SPRITE_PATHS.petApi(`pt-${look}`), {
      frameWidth: PET_FRAME,
      frameHeight: PET_FRAME,
    });
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }
}

export function loadEffects(load: Phaser.Loader.LoaderPlugin): void {
  load.spritesheet(TEX.effects, SPRITE_PATHS.effects, {
    frameWidth: EFFECT_FRAME,
    frameHeight: EFFECT_FRAME,
  });
}

/** Idle animations per direction for one avatar sheet (walk frames are driven by hop progress). */
export function ensureAvatarAnims(scene: Phaser.Scene, avatarKey: string): void {
  const tex = TEX.avatar(avatarKey);
  if (!scene.textures.exists(tex)) return;
  for (let dir = 0; dir < AVATAR_DIRECTIONS.length; dir++) {
    for (const anim of ['idle', 'walk'] as const) {
      const key = avatarAnimKey(tex, dir, anim);
      if (scene.anims.exists(key)) continue;
      const def = AVATAR_ANIMS[anim];
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(tex, avatarFrames(dir, anim)),
        frameRate: def.frameRate,
        repeat: def.repeat,
      });
    }
  }
}

export function ensurePetAnims(scene: Phaser.Scene, species: string): void {
  const tex = TEX.pet(species);
  if (!scene.textures.exists(tex)) return;
  for (const dir of PET_DIRECTIONS) {
    for (const anim of ['idle', 'hop', 'sleep'] as const) {
      const key = petAnimKey(species, dir, anim);
      if (scene.anims.exists(key)) continue;
      const def = PET_ANIMS[anim];
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(tex, petFrames(dir, anim)),
        frameRate: def.frameRate,
        repeat: def.repeat,
      });
    }
  }
}

export function ensureEffectAnims(scene: Phaser.Scene): void {
  if (!scene.textures.exists(TEX.effects)) return;
  if (!scene.anims.exists(FX_SPARKLE_ANIM)) {
    scene.anims.create({
      key: FX_SPARKLE_ANIM,
      frames: scene.anims.generateFrameNumbers(TEX.effects, {
        start: EFFECT_FRAMES.sparkle0,
        end: EFFECT_FRAMES.sparkle3,
      }),
      frameRate: 10,
      repeat: 0,
    });
  }
}

/**
 * Loads avatar sheets on demand (new people joining with presets nobody had before).
 * Each key is requested once; callbacks run when the texture is ready (or immediately if it is).
 */
export class AvatarSheetLoader {
  private readonly pending = new Map<string, Array<() => void>>();
  private readonly failed = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly staticKeys: ReadonlySet<string>,
  ) {
    scene.load.on('loaderror', (file: Phaser.Loader.File) => {
      const key = String(file.key);
      if (!key.startsWith('av:')) return;
      const avatarKey = key.slice(3);
      // Static file missing? Try the generator API once before giving up.
      if (this.staticKeys.has(avatarKey) && !this.failed.has(avatarKey)) {
        this.failed.add(avatarKey);
        this.scene.load.spritesheet(key, SPRITE_PATHS.avatarApi(avatarKey), {
          frameWidth: AVATAR_FRAME,
          frameHeight: AVATAR_FRAME,
        });
        this.scene.load.start();
        return;
      }
      this.pending.delete(avatarKey);
    });
  }

  request(avatarKey: string, onReady: () => void): void {
    if (!isAvatarKey(avatarKey)) return;
    const tex = TEX.avatar(avatarKey);
    if (this.scene.textures.exists(tex)) {
      ensureAvatarAnims(this.scene, avatarKey);
      onReady();
      return;
    }
    const waiting = this.pending.get(avatarKey);
    if (waiting) {
      waiting.push(onReady);
      return;
    }
    this.pending.set(avatarKey, [onReady]);
    this.scene.load.once(`filecomplete-spritesheet-${tex}`, () => {
      ensureAvatarAnims(this.scene, avatarKey);
      const cbs = this.pending.get(avatarKey) ?? [];
      this.pending.delete(avatarKey);
      for (const cb of cbs) cb();
    });
    loadAvatarSheet(this.scene.load, avatarKey, this.staticKeys);
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }
}
