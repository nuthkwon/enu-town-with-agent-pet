import Phaser from 'phaser';
import { PIXEL_FONT_SIZE } from '../font';
import { layoutText } from '../logic/textLayout';
import type { Stage } from '../stage';

export interface BubbleStyle {
  fill: number;
  border: number;
  /** Optional second border colour drawn inside the first (pastel double outline). */
  innerBorder?: number;
  textColor: string;
  maxWidth: number;
  maxLines: number;
  padX: number;
  padY: number;
  radius: number;
  tail: number;
  lineSpacing: number;
}

/**
 * Rounded speech bubble with a tail, drawn in screen space (overlay camera). The text object
 * receives the (wrapped, possibly clamped) text only — plain Phaser Text, no markup.
 * The container's origin is the tail tip, so placing it at a character's head and scaling it
 * pops the bubble out of the speaker.
 */
export class BubbleBox {
  readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private w = 0;
  private h = 0;
  private tailShift = 0;
  truncated = false;

  constructor(
    private readonly stage: Stage,
    private readonly style: BubbleStyle,
    depth: number,
  ) {
    const scene = stage.scene;
    this.bg = scene.add.graphics();
    this.label = scene.add.text(0, 0, '', {
      fontFamily: stage.font,
      fontSize: `${PIXEL_FONT_SIZE}px`,
      color: style.textColor,
      lineSpacing: style.lineSpacing,
      align: 'left',
    });
    this.label.setOrigin(0, 0);
    this.container = stage.overlay(scene.add.container(0, 0, [this.bg, this.label]));
    this.container.setDepth(depth);
    this.container.setVisible(false);
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h + this.style.tail;
  }

  setText(text: string): void {
    const s = this.style;
    const layout = layoutText(text, {
      maxWidth: s.maxWidth - s.padX * 2,
      maxLines: s.maxLines,
      measure: this.stage.measure,
    });
    this.truncated = layout.truncated;
    this.label.setText(layout.lines.join('\n'));
    const textH = Math.ceil(this.label.height);
    this.w = Math.max(28, Math.ceil(layout.width) + s.padX * 2);
    this.h = textH + s.padY * 2;
    this.redraw();
  }

  /** Largest sideways body offset that still keeps the tail under the body. */
  get maxShift(): number {
    return Math.max(0, this.w / 2 - this.style.radius - 6);
  }

  /** Moves the body sideways (keeps it on screen) while the tail still points at the speaker. */
  setTailShift(shift: number): void {
    const max = this.maxShift;
    const clamped = Math.round(Math.max(-max, Math.min(max, shift)));
    if (clamped === this.tailShift) return;
    this.tailShift = clamped;
    this.redraw();
  }

  /** Body rectangle in container coordinates. */
  private bodyRect(): { x: number; y: number; w: number; h: number } {
    return {
      x: Math.round(-this.w / 2 - this.tailShift),
      y: -this.h - this.style.tail,
      w: this.w,
      h: this.h,
    };
  }

  private redraw(): void {
    const s = this.style;
    const g = this.bg;
    const r = this.bodyRect();
    g.clear();
    // soft drop shadow
    g.fillStyle(0x3b2f4a, 0.16);
    g.fillRoundedRect(r.x + 1, r.y + 2, r.w, r.h, s.radius);
    // body
    g.fillStyle(s.border, 1);
    g.fillRoundedRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, s.radius + 1);
    g.fillStyle(s.fill, 1);
    g.fillRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, Math.max(1, s.radius - 1));
    if (s.innerBorder !== undefined) {
      g.lineStyle(1, s.innerBorder, 1);
      g.strokeRoundedRect(r.x + 2.5, r.y + 2.5, r.w - 5, r.h - 5, Math.max(1, s.radius - 2));
    }
    // tail: border triangle, then fill triangle (tip at 0,0)
    if (s.tail > 0) {
      const t = s.tail;
      g.fillStyle(s.border, 1);
      g.fillTriangle(-t - 1, -t - 2, t + 1, -t - 2, 0, 1);
      g.fillStyle(s.fill, 1);
      g.fillTriangle(-t + 1, -t - 3, t - 1, -t - 3, 0, -2);
    }
    this.label.setPosition(r.x + s.padX, r.y + s.padY);
    if (this.bg.input) {
      (this.bg.input.hitArea as Phaser.Geom.Rectangle).setTo(r.x - 2, r.y - 2, r.w + 4, r.h + s.tail + 4);
    }
  }

  makeInteractive(onClick: (pointer: Phaser.Input.Pointer) => void): void {
    const r = this.bodyRect();
    this.bg.setInteractive(
      new Phaser.Geom.Rectangle(r.x - 2, r.y - 2, r.w + 4, r.h + this.style.tail + 4),
      Phaser.Geom.Rectangle.Contains,
    );
    if (this.bg.input) this.bg.input.cursor = 'pointer';
    this.bg.on('pointerdown', (pointer: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onClick(pointer);
    });
  }

  destroy(): void {
    this.container.destroy();
  }
}
