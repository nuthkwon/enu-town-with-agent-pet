import type Phaser from 'phaser';
import { PIXEL_FONT_SIZE } from '../font';
import { COLORS, DEPTH, type Stage } from '../stage';

const PAD_X = 6;
const DOT_R = 3;
const HEIGHT = 17;

/**
 * Name tag above an avatar (screen space): a dark translucent pill with the Galmuri name in white
 * (crisp: no antialiased stroke), a team-colour dot on the left and a status dot on the right.
 */
export class NameTag {
  readonly container: Phaser.GameObjects.Container;
  private readonly text: Phaser.GameObjects.Text;
  private readonly bg: Phaser.GameObjects.Graphics;
  private teamColor: number;
  private status: number;

  constructor(
    stage: Stage,
    name: string,
    teamColor: number,
    status: number,
    private readonly isMe: boolean,
  ) {
    const scene = stage.scene;
    this.teamColor = teamColor;
    this.status = status;
    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, name, {
      fontFamily: stage.font,
      fontSize: `${PIXEL_FONT_SIZE}px`,
      color: isMe ? '#fff3b0' : '#ffffff',
    });
    this.text.setOrigin(0, 0);
    this.container = stage.overlay(scene.add.container(0, 0, [this.bg, this.text]));
    this.container.setDepth(DEPTH.overlayTag);
    this.redraw();
  }

  get height(): number {
    return HEIGHT;
  }

  setName(name: string): void {
    if (this.text.text === name) return;
    this.text.setText(name);
    this.redraw();
  }

  setTeamColor(color: number): void {
    if (color === this.teamColor) return;
    this.teamColor = color;
    this.redraw();
  }

  setStatus(status: number): void {
    if (status === this.status) return;
    this.status = status;
    this.redraw();
  }

  private redraw(): void {
    const g = this.bg;
    const textW = Math.ceil(this.text.width);
    const inner = DOT_R * 2 + 4 + textW + 4 + DOT_R * 2;
    const w = inner + PAD_X * 2;
    const left = -Math.round(w / 2);
    const top = -HEIGHT;
    g.clear();
    g.fillStyle(COLORS.ink, this.isMe ? 0.86 : 0.74);
    g.fillRoundedRect(left, top, w, HEIGHT, 8);
    if (this.isMe) {
      g.lineStyle(1, 0xfff3b0, 0.9);
      g.strokeRoundedRect(left + 0.5, top + 0.5, w - 1, HEIGHT - 1, 8);
    }
    const cy = top + HEIGHT / 2;
    // team colour dot (left)
    g.fillStyle(this.teamColor, 1);
    g.fillCircle(left + PAD_X + DOT_R, cy, DOT_R);
    // status dot (right)
    g.fillStyle(COLORS.status[this.status] ?? COLORS.status[0] ?? 0x6fcf8f, 1);
    g.fillCircle(left + w - PAD_X - DOT_R, cy, DOT_R);
    this.text.setPosition(left + PAD_X + DOT_R * 2 + 4, top + Math.round((HEIGHT - this.text.height) / 2) + 1);
  }

  setPosition(x: number, bottomY: number): void {
    this.container.setPosition(x, bottomY);
  }

  setVisible(v: boolean): void {
    this.container.setVisible(v);
  }

  destroy(): void {
    this.container.destroy();
  }
}
