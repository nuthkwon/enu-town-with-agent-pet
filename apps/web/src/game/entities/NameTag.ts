import type Phaser from 'phaser';
import { PIXEL_FONT_SIZE } from '../font';
import { COLORS, DEPTH, type Stage } from '../stage';

/**
 * Name tag above an avatar (screen space): Galmuri text with a dark outline, a team-colour dot
 * on the left and a status dot on the right.
 */
export class NameTag {
  readonly container: Phaser.GameObjects.Container;
  private readonly text: Phaser.GameObjects.Text;
  private readonly dots: Phaser.GameObjects.Graphics;
  private teamColor: number;
  private status: number;

  constructor(stage: Stage, name: string, teamColor: number, status: number, isMe: boolean) {
    const scene = stage.scene;
    this.teamColor = teamColor;
    this.status = status;
    this.text = scene.add.text(0, 0, name, {
      fontFamily: stage.font,
      fontSize: `${PIXEL_FONT_SIZE}px`,
      color: isMe ? '#fff3b0' : '#ffffff',
      stroke: COLORS.inkCss,
      strokeThickness: 3,
    });
    this.text.setOrigin(0.5, 1);
    this.dots = scene.add.graphics();
    this.container = stage.overlay(scene.add.container(0, 0, [this.dots, this.text]));
    this.container.setDepth(DEPTH.overlayTag);
    this.redrawDots();
  }

  get height(): number {
    return Math.ceil(this.text.height);
  }

  setName(name: string): void {
    if (this.text.text === name) return;
    this.text.setText(name);
    this.redrawDots();
  }

  setTeamColor(color: number): void {
    if (color === this.teamColor) return;
    this.teamColor = color;
    this.redrawDots();
  }

  setStatus(status: number): void {
    if (status === this.status) return;
    this.status = status;
    this.redrawDots();
  }

  private redrawDots(): void {
    const g = this.dots;
    const half = Math.ceil(this.text.width / 2);
    const cy = -Math.round(this.text.height / 2) + 1;
    g.clear();
    // team colour dot (left)
    g.fillStyle(COLORS.ink, 1);
    g.fillCircle(-half - 4, cy, 4);
    g.fillStyle(this.teamColor, 1);
    g.fillCircle(-half - 4, cy, 3);
    // status dot (right)
    g.fillStyle(COLORS.ink, 1);
    g.fillCircle(half + 4, cy, 4);
    g.fillStyle(COLORS.status[this.status] ?? COLORS.status[0] ?? 0x6fcf8f, 1);
    g.fillCircle(half + 4, cy, 3);
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
