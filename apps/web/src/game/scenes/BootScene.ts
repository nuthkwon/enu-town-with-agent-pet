import Phaser from 'phaser';
import { FONT_REGISTRY_KEY } from '../bridge';
import { resolvePixelFontFamily, waitForPixelFont } from '../font';

/** Waits (bounded) for the Galmuri web font so canvas text never bakes in a fallback font. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'boot' });
  }

  create(): void {
    const family = resolvePixelFontFamily();
    this.registry.set(FONT_REGISTRY_KEY, family);
    void waitForPixelFont(family).then(() => {
      if (!this.sys.game || !this.scene.manager) return;
      this.scene.start('preload');
    });
  }
}
