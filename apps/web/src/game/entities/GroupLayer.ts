import Phaser from 'phaser';
import { PIXEL_FONT_SIZE } from '../font';
import { COLORS, DEPTH, type Stage } from '../stage';
import type { WorldPoint } from './Fx';

/** One group as the scene resolved it for drawing (world points; hidden members sit on their plates). */
export interface GroupDraw {
  id: string;
  family: 'meeting' | 'work';
  /** Every member drawn together: a hull (meeting) or a short link at the host's desk (work). */
  gathered: boolean;
  /** Member anchors (chest height for avatars, plate middle for hidden members). */
  points: WorldPoint[];
  /** World point the chip hangs from (its bottom edge): kept clear of the members' tags and icons. */
  chipAt: WorldPoint | null;
  chipText: string | null;
  teamColors: number[];
}

export interface Segment {
  groupId: string;
  a: WorldPoint;
  b: WorldPoint;
}

const DASH = 4;
const GAP = 4;
const HULL_PAD = 22;
const CHIP_H = 18;
const MAX_DOTS = 6;

function dashedLine(g: Phaser.GameObjects.Graphics, a: WorldPoint, b: WorldPoint): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let d = 0; d < len; d += DASH + GAP) {
    const e = Math.min(len, d + DASH);
    g.lineBetween(a.x + ux * d, a.y + uy * d, a.x + ux * e, a.y + uy * e);
  }
}

/** Distance from p to the segment ab (world px). */
export function distanceToSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

class Chip {
  readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private key = '';
  w = 0;

  constructor(stage: Stage, onClick: (pointer: Phaser.Input.Pointer) => void) {
    const scene = stage.scene;
    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, '', { fontFamily: stage.font, fontSize: `${PIXEL_FONT_SIZE}px`, color: '#ffffff' });
    this.text.setOrigin(0, 0);
    this.container = stage.overlay(scene.add.container(0, 0, [this.bg, this.text]));
    this.container.setDepth(DEPTH.overlayGroup);
    this.bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1, 1), Phaser.Geom.Rectangle.Contains);
    if (this.bg.input) this.bg.input.cursor = 'pointer';
    this.bg.on('pointerdown', (pointer: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      if (pointer.button !== 0) return;
      ev.stopPropagation();
      onClick(pointer);
    });
  }

  set(text: string, colors: number[]): void {
    const key = `${text}|${colors.join(',')}`;
    if (key === this.key) return;
    this.key = key;
    this.text.setText(text);
    const dots = Math.min(colors.length, MAX_DOTS);
    const dotsW = dots > 0 ? dots * 7 + 3 : 0;
    const w = 8 + dotsW + Math.ceil(this.text.width) + 9;
    this.w = w;
    const left = -Math.round(w / 2);
    const top = -CHIP_H;
    const g = this.bg;
    g.clear();
    g.fillStyle(COLORS.ink, 0.16);
    g.fillRoundedRect(left + 1, top + 2, w, CHIP_H, 9);
    g.fillStyle(COLORS.groupLink, 0.95);
    g.fillRoundedRect(left, top, w, CHIP_H, 9);
    for (let i = 0; i < dots; i++) {
      const cx = left + 8 + 3 + i * 7;
      g.fillStyle(0xffffff, 1);
      g.fillCircle(cx, top + CHIP_H / 2, 3.5);
      g.fillStyle(colors[i] ?? 0xffffff, 1);
      g.fillCircle(cx, top + CHIP_H / 2, 2.5);
    }
    this.text.setPosition(left + 8 + dotsW, top + Math.round((CHIP_H - this.text.height) / 2) + 1);
    if (this.bg.input) (this.bg.input.hitArea as Phaser.Geom.Rectangle).setTo(left - 2, top - 2, w + 4, CHIP_H + 4);
  }

  destroy(): void {
    this.container.destroy();
  }
}

/**
 * Groups people formed by mutual corroboration: a soft hull under a gathered meeting with a chip
 * `회의 중 · N명 · ~HH:MM` (team-colour dots), a short dotted link + `같은 작업` for a same-work group
 * at the host's desk, and dotted links between avatars or desk plates for groups that did not gather.
 */
export class GroupLayer {
  private readonly hulls: Phaser.GameObjects.Graphics;
  private readonly links: Phaser.GameObjects.Graphics;
  private readonly chips = new Map<string, Chip>();
  private segments: Segment[] = [];

  constructor(
    private readonly stage: Stage,
    private readonly onChipClick: (groupId: string, pointer: Phaser.Input.Pointer) => void,
  ) {
    this.hulls = stage.world(stage.scene.add.graphics()).setDepth(DEPTH.furniture + 0.5);
    this.links = stage.world(stage.scene.add.graphics()).setDepth(DEPTH.night - 2);
  }

  /** Last drawn link segments (world), for click hit-testing. */
  get linkSegments(): readonly Segment[] {
    return this.segments;
  }

  update(groups: readonly GroupDraw[]): void {
    const h = this.hulls;
    const l = this.links;
    h.clear();
    l.clear();
    this.segments = [];
    const seen = new Set<string>();
    for (const g of groups) {
      if (g.points.length < 2) continue;
      let chipAt: WorldPoint | null = null;
      if (g.family === 'meeting' && g.gathered) {
        const xs = g.points.map((p) => p.x);
        const ys = g.points.map((p) => p.y);
        const x0 = Math.min(...xs) - HULL_PAD;
        const y0 = Math.min(...ys) - HULL_PAD;
        const x1 = Math.max(...xs) + HULL_PAD;
        const y1 = Math.max(...ys) + HULL_PAD - 6;
        h.fillStyle(COLORS.groupHull, 0.13);
        h.fillRoundedRect(x0, y0, x1 - x0, y1 - y0, 18);
        h.lineStyle(2, COLORS.groupHull, 0.5);
        h.strokeRoundedRect(x0, y0, x1 - x0, y1 - y0, 18);
        chipAt = g.chipAt ?? { x: (x0 + x1) / 2, y: y1 };
      } else {
        l.lineStyle(2, COLORS.groupLink, g.gathered ? 0.9 : 0.7);
        for (let i = 1; i < g.points.length; i++) {
          const a = g.points[i - 1] as WorldPoint;
          const b = g.points[i] as WorldPoint;
          dashedLine(l, a, b);
          this.segments.push({ groupId: g.id, a, b });
        }
        if (g.gathered) {
          const ys = g.points.map((p) => p.y);
          const xs = g.points.map((p) => p.x);
          chipAt = g.chipAt ?? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) + 36 };
        }
      }
      if (chipAt && g.chipText) {
        seen.add(g.id);
        let chip = this.chips.get(g.id);
        if (!chip) {
          chip = new Chip(this.stage, (pointer) => this.onChipClick(g.id, pointer));
          this.chips.set(g.id, chip);
        }
        chip.set(g.chipText, g.teamColors);
        const s = this.stage.toScreen(chipAt.x, chipAt.y);
        chip.container.setPosition(s.x, s.y).setVisible(true);
      }
    }
    for (const [id, chip] of this.chips) {
      if (!seen.has(id)) {
        chip.destroy();
        this.chips.delete(id);
      }
    }
  }

  /** The group whose link passes within `tolerance` world px of p, if any. */
  linkAt(p: WorldPoint, tolerance: number): string | null {
    let best: { id: string; d: number } | null = null;
    for (const s of this.segments) {
      const d = distanceToSegment(p, s.a, s.b);
      if (d <= tolerance && (!best || d < best.d)) best = { id: s.groupId, d };
    }
    return best?.id ?? null;
  }

  destroy(): void {
    this.hulls.destroy();
    this.links.destroy();
    for (const c of this.chips.values()) c.destroy();
    this.chips.clear();
  }
}
