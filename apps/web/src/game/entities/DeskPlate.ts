import type Phaser from 'phaser';
import type { DeskInfo } from '@enu/map';
import { COLORS, DEPTH, TILE_PX, type Stage } from '../stage';

/**
 * Owner's name on their desk (screen space). Sits on the desk's first tile so it never covers the
 * monitor in the middle; dimmed while the owner is away from the office.
 */
export class DeskPlate {
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly anchorX: number;
  private readonly anchorY: number;
  private name = '';

  constructor(
    private readonly stage: Stage,
    readonly desk: DeskInfo,
  ) {
    const scene = stage.scene;
    const r = desk.tileRect;
    this.anchorX = r.x * TILE_PX + TILE_PX / 2;
    this.anchorY = r.y * TILE_PX + (r.h * TILE_PX) / 2 + (desk.kind === 'ceo' ? -TILE_PX / 2 : 0);
    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, '', {
      fontFamily: stage.font,
      fontSize: '12px',
      color: COLORS.inkCss,
    });
    this.text.setOrigin(0.5, 0.5);
    this.container = stage.overlay(scene.add.container(0, 0, [this.bg, this.text]));
    this.container.setDepth(DEPTH.overlayDesk);
    this.container.setVisible(false);
  }

  setOwner(name: string | null, online: boolean): void {
    const n = name ?? '';
    if (n !== this.name) {
      this.name = n;
      this.text.setText(n);
      const w = Math.ceil(this.text.width) + 8;
      const h = 15;
      this.bg.clear();
      this.bg.fillStyle(COLORS.plateBorder, 1);
      this.bg.fillRoundedRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 3);
      this.bg.fillStyle(COLORS.plateFill, 1);
      this.bg.fillRoundedRect(-w / 2, -h / 2, w, h, 3);
    }
    this.container.setVisible(n !== '');
    this.container.setAlpha(online ? 1 : 0.72);
  }

  update(): void {
    if (!this.container.visible) return;
    const p = this.stage.toScreen(this.anchorX, this.anchorY);
    this.container.setPosition(p.x, p.y);
    // Plates get noisy when zoomed out; keep them readable but subtle.
    this.container.setScale(1);
  }

  destroy(): void {
    this.container.destroy();
  }
}
