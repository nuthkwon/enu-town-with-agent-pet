import { COLORS, DEPTH, type Stage } from '../stage';
import { BubbleBox } from './BubbleBox';

export const CHAT_BUBBLE_MS = 6000;
const FADE_MS = 400;

/** Recent nearby/room chat line above a person's head (max 3 lines, ~6 s). */
export class ChatBubble {
  private readonly box: BubbleBox;
  private shownAt = 0;
  private until = 0;

  constructor(stage: Stage) {
    this.box = new BubbleBox(
      stage,
      {
        fill: COLORS.chatFill,
        border: COLORS.chatBorder,
        textColor: COLORS.inkCss,
        maxWidth: 190,
        maxLines: 3,
        padX: 7,
        padY: 5,
        radius: 6,
        tail: 5,
        lineSpacing: 3,
      },
      DEPTH.overlayChat,
    );
  }

  show(text: string, now: number): void {
    this.box.setText(text);
    this.shownAt = now;
    this.until = now + CHAT_BUBBLE_MS;
    this.box.container.setVisible(true).setAlpha(1).setScale(1);
  }

  get visible(): boolean {
    return this.box.container.visible;
  }

  get height(): number {
    return this.box.height;
  }

  /** Positions the tail tip at (x, y) in screen px; hides after the display time. */
  update(now: number, x: number, y: number, viewWidth: number): void {
    const c = this.box.container;
    if (!c.visible) return;
    if (now >= this.until) {
      c.setVisible(false);
      return;
    }
    const age = now - this.shownAt;
    const left = this.until - now;
    c.setAlpha(left < FADE_MS ? left / FADE_MS : 1);
    c.setScale(age < 120 ? 0.85 + (0.15 * age) / 120 : 1);
    c.setPosition(x, y);
    const half = this.box.width / 2;
    const shift = x - half < 4 ? x - half - 4 : x + half > viewWidth - 4 ? x + half - (viewWidth - 4) : 0;
    this.box.setTailShift(shift);
  }

  hide(): void {
    this.box.container.setVisible(false);
  }

  destroy(): void {
    this.box.destroy();
  }
}
