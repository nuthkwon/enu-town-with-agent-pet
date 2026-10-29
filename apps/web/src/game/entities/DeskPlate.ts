import Phaser from 'phaser';
import type { DeskInfo } from '@enu/map';
import { TEX } from '../assets';
import { PIXEL_FONT_SIZE, SMALL_PIXEL_FONT, SMALL_PIXEL_FONT_SIZE } from '../font';
import { cardBox, pillBox, type Box, type PlateLayout } from '../logic/plates';
import type { HiddenPlate } from '../logic/presence';
import { ELLIPSIS, graphemes, type Measure } from '../logic/textLayout';
import { EFFECT_FRAMES } from '../spriteSpec';
import { COLORS, DEPTH, type Stage } from '../stage';

/**
 * What a desk plate shows (spec §1.3, §5.4):
 *  - `seated`: the owner sits here (shown): a one-line plate, name + online dot;
 *  - `elsewhere`: the owner is shown somewhere else (meeting, pantry, visiting): name only, faded;
 *  - `hidden`: the owner is not drawn: name, then the note or Claude/log label (`plate`);
 *  - `vacant`: nobody owns the desk: nothing.
 */
export type PlateModel =
  | { kind: 'vacant' }
  | {
      kind: 'seated' | 'elsewhere' | 'hidden';
      name: string;
      teamColor: number;
      isMe: boolean;
      online: boolean;
      plate: HiddenPlate | null;
    };

export interface PlateHandlers {
  onClick(desk: DeskInfo, pointer: Phaser.Input.Pointer): void;
  onHover(desk: DeskInfo | null, pointer: Phaser.Input.Pointer): void;
}

const PILL_H = 16;
const PAD_X = 6;
const CARD_PAD_X = 6;
const CARD_PAD_Y = 3;
/** Widest text line of a card (it then grows toward the aisle or the wall, never into a neighbour). */
const CARD_TEXT_MAX = 110;
const ICON = 16;
const DOT_R = 3;

function fit(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text;
  const g = graphemes(text);
  while (g.length > 0 && measure(`${g.join('').trimEnd()}${ELLIPSIS}`) > maxWidth) g.pop();
  return `${g.join('').trimEnd()}${ELLIPSIS}`;
}

/**
 * The owner's name plate on a desk (screen space, crisp at every zoom). Clicking or hovering it acts on
 * the desk's roster member whether or not they are drawn (desk id -> member, never "a Player exists").
 */
export class DeskPlate {
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly name: Phaser.GameObjects.Text;
  private readonly label: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text;
  private readonly icon: Phaser.GameObjects.Image | null;
  private readonly star: Phaser.GameObjects.Image | null;
  private key = '';
  private model: PlateModel = { kind: 'vacant' };
  private w = 0;
  private h = 0;
  private highlighted = false;
  private box: Box | null = null;

  constructor(
    private readonly stage: Stage,
    readonly desk: DeskInfo,
    readonly layout: PlateLayout,
    handlers: PlateHandlers,
  ) {
    const scene = stage.scene;
    this.bg = scene.add.graphics();
    const style = { fontFamily: stage.font, fontSize: `${PIXEL_FONT_SIZE}px`, color: COLORS.inkCss };
    this.name = scene.add.text(0, 0, '', style).setOrigin(0, 0);
    this.label = scene.add.text(0, 0, '', style).setOrigin(0, 0);
    this.detail = scene.add
      .text(0, 0, '', { fontFamily: SMALL_PIXEL_FONT, fontSize: `${SMALL_PIXEL_FONT_SIZE}px`, color: COLORS.plateMutedCss })
      .setOrigin(0, 0);
    const hasFx = scene.textures.exists(TEX.effects);
    this.icon = hasFx ? scene.add.image(0, 0, TEX.effects, EFFECT_FRAMES.note).setOrigin(0, 0) : null;
    this.star = hasFx ? scene.add.image(0, 0, TEX.effects, EFFECT_FRAMES.star).setScale(0.75) : null;
    const children: Phaser.GameObjects.GameObject[] = [this.bg, this.name, this.label, this.detail];
    if (this.icon) children.push(this.icon);
    if (this.star) children.push(this.star);
    this.container = stage.overlay(scene.add.container(0, 0, children));
    this.container.setDepth(DEPTH.overlayDesk);
    this.container.setVisible(false);

    this.bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1, 1), Phaser.Geom.Rectangle.Contains);
    if (this.bg.input) this.bg.input.cursor = 'pointer';
    this.bg.on('pointerdown', (pointer: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      if (pointer.button !== 0) return;
      ev.stopPropagation();
      handlers.onClick(this.desk, pointer);
    });
    this.bg.on('pointerover', (pointer: Phaser.Input.Pointer) => handlers.onHover(this.desk, pointer));
    this.bg.on('pointerout', (pointer: Phaser.Input.Pointer) => handlers.onHover(null, pointer));
  }

  get visible(): boolean {
    return this.container.visible;
  }

  /** The plate's text lines as drawn (name, then the label and detail of a card); [] while invisible. */
  get textLines(): string[] {
    if (!this.container.visible) return [];
    const lines = [this.name.text];
    if (this.label.visible && this.label.text) lines.push(this.label.text);
    if (this.detail.visible && this.detail.text) lines.push(this.detail.text);
    return lines;
  }

  /** What the plate shows: `seated`, `elsewhere`, `hidden` or `vacant` (and whether the owner's dot is on). */
  get kind(): PlateModel['kind'] {
    return this.model.kind;
  }

  get online(): boolean {
    return this.model.kind !== 'vacant' && this.model.online;
  }

  /** Screen rectangle of the plate (null while invisible). */
  get rect(): Box | null {
    return this.container.visible ? this.box : null;
  }

  /** World point at the plate's middle: arcs, planes and group links start here for hidden people. */
  get worldAnchor(): { x: number; y: number } {
    const { card, pill } = this.layout;
    if (this.model.kind !== 'hidden') return { x: pill.x, y: pill.y };
    // A bottom-anchored card stands on its anchor: aim at about its middle.
    return { x: card.x, y: card.alignY === 'bottom' ? card.y - 14 : card.y };
  }

  setHighlight(on: boolean): void {
    if (on === this.highlighted) return;
    this.highlighted = on;
    this.redraw();
  }

  set(model: PlateModel): void {
    const key = JSON.stringify(model);
    if (key === this.key) return;
    this.key = key;
    this.model = model;
    if (model.kind === 'vacant' || !model.name) {
      this.container.setVisible(false);
      return;
    }
    this.layoutText();
    this.redraw();
    this.container.setVisible(true);
  }

  private layoutText(): void {
    const m = this.model;
    if (m.kind === 'vacant') return;
    const measure = this.stage.measure;
    const card = m.kind === 'hidden' && m.plate !== null && !m.plate.quiet;
    this.name.setText(fit(m.name, CARD_TEXT_MAX, measure));
    this.name.setColor(m.isMe ? (card ? COLORS.inkCss : COLORS.meYellowCss) : m.kind === 'hidden' && !card ? COLORS.plateMutedCss : COLORS.inkCss);
    const nameW = Math.ceil(this.name.width);
    const lead = m.isMe && this.star ? 13 : 0;
    if (!card) {
      this.label.setVisible(false);
      this.detail.setVisible(false);
      this.icon?.setVisible(false);
      const trail = m.online ? 5 + DOT_R * 2 : 0;
      this.w = PAD_X + lead + nameW + trail + PAD_X;
      this.h = PILL_H;
      const top = -this.h / 2;
      this.star?.setVisible(lead > 0).setPosition(PAD_X + 5, 0);
      this.name.setPosition(PAD_X + lead, Math.round(top + (this.h - this.name.height) / 2) + 1);
      return;
    }
    const plate = m.plate as HiddenPlate;
    const lbl = plate.label;
    const iconW = lbl?.icon && this.icon ? ICON + 3 : 0;
    this.label.setText(lbl ? fit(lbl.text, CARD_TEXT_MAX - iconW, measure) : '');
    this.label.setColor(lbl && !lbl.icon ? COLORS.plateAwayCss : COLORS.inkCss);
    this.label.setVisible(lbl !== null);
    this.detail.setText(plate.detail ? fit(plate.detail, CARD_TEXT_MAX, this.stage.measureSmall) : '');
    this.detail.setVisible(plate.detail !== null);
    const labelW = lbl ? iconW + Math.ceil(this.label.width) : 0;
    const detailW = plate.detail ? Math.ceil(this.detail.width) : 0;
    const inner = Math.max(lead + nameW, labelW, detailW);
    this.w = CARD_PAD_X * 2 + inner;
    const nameH = 14;
    const labelH = lbl ? 17 : 0;
    const detailH = plate.detail ? 12 : 0;
    this.h = CARD_PAD_Y * 2 + nameH + labelH + detailH;
    const top = -this.h / 2;
    let y = top + CARD_PAD_Y;
    this.star?.setVisible(lead > 0).setPosition(CARD_PAD_X + 5, Math.round(y + nameH / 2));
    this.name.setPosition(CARD_PAD_X + lead, Math.round(y + 1));
    y += nameH;
    if (lbl) {
      if (this.icon) {
        if (lbl.icon) this.icon.setFrame(EFFECT_FRAMES[lbl.icon]).setPosition(CARD_PAD_X, Math.round(y)).setVisible(true);
        else this.icon.setVisible(false);
      }
      this.label.setPosition(CARD_PAD_X + iconW, Math.round(y + (ICON - this.label.height) / 2) + 1);
      y += labelH;
    } else {
      this.icon?.setVisible(false);
    }
    if (plate.detail) this.detail.setPosition(CARD_PAD_X, Math.round(y));
  }

  private redraw(): void {
    const m = this.model;
    if (m.kind === 'vacant') return;
    const g = this.bg;
    const w = this.w;
    const h = this.h;
    const top = -h / 2;
    const card = m.kind === 'hidden' && m.plate !== null && !m.plate.quiet;
    const quiet = m.kind === 'hidden' && !card;
    const meDark = m.isMe && !card;
    g.clear();
    if (this.highlighted) {
      g.lineStyle(3, COLORS.pulse, 1);
      g.strokeRoundedRect(-3, top - 3, w + 6, h + 6, 7);
    }
    // soft drop shadow, then the team-colour border (2 px) and the fill
    g.fillStyle(COLORS.ink, quiet ? 0.08 : 0.16);
    g.fillRoundedRect(1, top + 2, w, h, 5);
    g.fillStyle(m.teamColor, quiet ? 0.55 : 1);
    g.fillRoundedRect(0, top, w, h, 5);
    g.fillStyle(meDark ? COLORS.ink : COLORS.plateFill, quiet ? 0.9 : 0.97);
    g.fillRoundedRect(2, top + 2, w - 4, h - 4, 3);
    if (!card && m.online) {
      const x = w - PAD_X - DOT_R;
      g.fillStyle(COLORS.onlineRing, 1);
      g.fillCircle(x, 0, DOT_R + 1);
      g.fillStyle(COLORS.online, 1);
      g.fillCircle(x, 0, DOT_R);
    }
    if (this.bg.input) (this.bg.input.hitArea as Phaser.Geom.Rectangle).setTo(-2, top - 2, w + 4, h + 4);
    this.container.setAlpha(m.kind === 'elsewhere' ? 0.6 : 1);
  }

  update(): void {
    const m = this.model;
    if (m.kind === 'vacant' || !this.container.visible) return;
    const l = this.layout;
    const card = m.kind === 'hidden' && m.plate !== null && !m.plate.quiet;
    let box: Box;
    if (card) {
      const c = this.stage.toScreen(l.card.x, l.card.y);
      const minSx = l.minX === null ? null : this.stage.toScreen(l.minX, 0).x;
      const maxSx = l.maxX === null ? null : this.stage.toScreen(l.maxX, 0).x;
      box = cardBox(c.x, c.y, l.card.alignY, this.w, this.h, minSx, maxSx);
    } else {
      const a = this.stage.toScreen(l.pill.x, l.pill.y);
      box = pillBox(a.x, a.y, l.pill.align, this.w, this.h);
    }
    this.box = box;
    this.container.setPosition(box.x, box.y + box.h / 2);
  }

  destroy(): void {
    this.container.destroy();
  }
}
