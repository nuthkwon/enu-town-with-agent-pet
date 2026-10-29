import type Phaser from 'phaser';
import { TEX } from '../assets';
import { PIXEL_FONT_SIZE } from '../font';
import { EFFECT_FRAMES } from '../spriteSpec';
import { COLORS, DEPTH, type Stage } from '../stage';

const PAD_X = 6;
const DOT_R = 3;
const HEIGHT = 17;

/**
 * Floating name tag above an avatar that is away from its own desk (screen space): a dark translucent pill
 * with the Galmuri name in white (crisp: no antialiased stroke), a team-colour dot on the left (a gold star
 * for the viewer) and a green online dot on the right only while the person is connected.
 */
export class NameTag {
  readonly container: Phaser.GameObjects.Container;
  private readonly text: Phaser.GameObjects.Text;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly star: Phaser.GameObjects.Image | null;
  private teamColor: number;
  private online = false;
  private widthPx = 0;

  constructor(
    stage: Stage,
    name: string,
    teamColor: number,
    private readonly isMe: boolean,
  ) {
    const scene = stage.scene;
    this.teamColor = teamColor;
    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, name, {
      fontFamily: stage.font,
      fontSize: `${PIXEL_FONT_SIZE}px`,
      color: isMe ? COLORS.meYellowCss : '#ffffff',
    });
    this.text.setOrigin(0, 0);
    const children: Phaser.GameObjects.GameObject[] = [this.bg, this.text];
    this.star =
      isMe && scene.textures.exists(TEX.effects)
        ? scene.add.image(0, 0, TEX.effects, EFFECT_FRAMES.star)
        : null;
    if (this.star) {
      this.star.setScale(0.75);
      children.push(this.star);
    }
    this.container = stage.overlay(scene.add.container(0, 0, children));
    this.container.setDepth(DEPTH.overlayTag);
    this.redraw();
  }

  get height(): number {
    return HEIGHT;
  }

  get width(): number {
    return this.widthPx;
  }

  get visible(): boolean {
    return this.container.visible;
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

  setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    this.redraw();
  }

  private redraw(): void {
    const g = this.bg;
    const textW = Math.ceil(this.text.width);
    const lead = this.star ? 12 : DOT_R * 2 + 4;
    const trail = this.online ? 4 + DOT_R * 2 : 0;
    const w = PAD_X + lead + textW + trail + PAD_X;
    this.widthPx = w;
    const left = -Math.round(w / 2);
    const top = -HEIGHT;
    g.clear();
    g.fillStyle(COLORS.ink, this.isMe ? 0.88 : 0.78);
    g.fillRoundedRect(left, top, w, HEIGHT, 8);
    if (this.isMe) {
      g.lineStyle(1, COLORS.meYellow, 0.9);
      g.strokeRoundedRect(left + 0.5, top + 0.5, w - 1, HEIGHT - 1, 8);
    }
    const cy = top + HEIGHT / 2;
    if (this.star) {
      this.star.setPosition(left + PAD_X + 5, Math.round(cy));
    } else {
      g.fillStyle(this.teamColor, 1);
      g.fillCircle(left + PAD_X + DOT_R, cy, DOT_R);
    }
    if (this.online) {
      const x = left + w - PAD_X - DOT_R;
      g.fillStyle(COLORS.onlineRing, 1);
      g.fillCircle(x, cy, DOT_R + 1);
      g.fillStyle(COLORS.online, 1);
      g.fillCircle(x, cy, DOT_R);
    }
    this.text.setPosition(left + PAD_X + lead, top + Math.round((HEIGHT - this.text.height) / 2) + 1);
  }

  /** (x, bottomY): centre x and the bottom edge of the pill, in screen px. */
  setPosition(x: number, bottomY: number): void {
    this.container.setPosition(x, bottomY);
  }

  setVisible(v: boolean): void {
    if (this.container.visible !== v) this.container.setVisible(v);
  }

  destroy(): void {
    this.container.destroy();
  }
}
