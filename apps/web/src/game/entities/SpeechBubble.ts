import type Phaser from 'phaser';
import { TEX } from '../assets';
import { PIXEL_FONT_SIZE } from '../font';
import { EFFECT_FRAMES } from '../spriteSpec';
import { COLORS, DEPTH, type Stage } from '../stage';
import { BubbleBox } from './BubbleBox';

/**
 * The owner's pet bubble. It contains exactly the Claude-authored text (wrapped to at most four
 * lines; longer text is cut with '…' and the full text stays available in the bubble popover,
 * MyPetPanel and the screen-reader live region). Nothing is prefixed or appended.
 */
export class PetSpeechBubble {
  private readonly box: BubbleBox;
  private text = '';
  private popTween: Phaser.Tweens.Tween | null = null;

  constructor(
    private readonly stage: Stage,
    onClick: (pointer: Phaser.Input.Pointer) => void,
  ) {
    this.box = new BubbleBox(
      stage,
      {
        fill: COLORS.petBubbleFill,
        border: COLORS.petBubbleBorder,
        innerBorder: COLORS.petBubbleShade,
        textColor: '#4a3560',
        maxWidth: 200,
        maxLines: 4,
        padX: 9,
        padY: 7,
        radius: 8,
        tail: 6,
        lineSpacing: 3,
      },
      DEPTH.overlayPetBubble,
    );
    this.box.makeInteractive(onClick);
  }

  get visible(): boolean {
    return this.box.container.visible;
  }

  get currentText(): string {
    return this.text;
  }

  get truncated(): boolean {
    return this.box.truncated;
  }

  show(text: string): void {
    const changed = text !== this.text || !this.box.container.visible;
    this.text = text;
    this.box.setText(text);
    const c = this.box.container;
    c.setVisible(true);
    if (!changed) return;
    this.popTween?.stop();
    c.setScale(0.3).setAlpha(0);
    this.popTween = this.stage.scene.tweens.add({
      targets: c,
      scale: 1,
      alpha: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });
  }

  hide(): void {
    this.popTween?.stop();
    this.popTween = null;
    this.text = '';
    this.box.container.setVisible(false);
  }

  update(x: number, y: number, viewWidth: number): void {
    const c = this.box.container;
    if (!c.visible) return;
    c.setPosition(x, y);
    const half = this.box.width / 2;
    const shift = x - half < 6 ? x - half - 6 : x + half > viewWidth - 6 ? x + half - (viewWidth - 6) : 0;
    this.box.setTailShift(shift);
  }

  destroy(): void {
    this.popTween?.stop();
    this.box.destroy();
  }
}

/** System chip under the pet: alarm icon + HH:MM (Asia/Seoul). Never part of the bubble. */
export class DueChip {
  readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;

  constructor(stage: Stage) {
    const scene = stage.scene;
    this.bg = scene.add.graphics();
    this.icon = scene.add.image(0, 0, TEX.effects, EFFECT_FRAMES.alarm).setOrigin(0, 0.5);
    this.label = scene.add.text(0, 0, '', {
      fontFamily: stage.font,
      fontSize: `${PIXEL_FONT_SIZE}px`,
      color: '#ffffff',
    });
    this.label.setOrigin(0, 0.5);
    this.container = stage.overlay(scene.add.container(0, 0, [this.bg, this.icon, this.label]));
    this.container.setDepth(DEPTH.overlayPetBubble - 1);
    this.container.setVisible(false);
  }

  show(hm: string): void {
    this.label.setText(hm);
    const w = 16 + 2 + Math.ceil(this.label.width) + 10;
    const h = 18;
    const x = -Math.round(w / 2);
    this.bg.clear();
    this.bg.fillStyle(COLORS.chipFill, 0.88);
    this.bg.fillRoundedRect(x, 0, w, h, 6);
    this.icon.setPosition(x + 3, h / 2);
    this.label.setPosition(x + 3 + 16 + 2, h / 2 + 1);
    this.container.setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  destroy(): void {
    this.container.destroy();
  }
}
