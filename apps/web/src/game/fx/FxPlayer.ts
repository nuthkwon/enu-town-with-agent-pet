import Phaser from 'phaser';
import type { FxCatalogEntry } from '@enu/fx/types';
import { arcControl, bezier, type WorldPoint } from '../entities/Fx';
import { PIXEL_FONT_SIZE } from '../font';
import { COLORS, DEPTH, type Stage } from '../stage';
import { StripLoader, fxEntry, stripKey } from './strips';

/** At most this many effect sprites at once on this screen (a burst of spells never floods the canvas). */
export const MAX_LIVE_FX = 40;
/** World px above the feet for each anchor (the same table as packages/fx `ANCHOR_ABOVE_FEET`). */
export const ANCHOR_ABOVE_FEET = { feet: 0, chest: 14, head: 27, free: 0 } as const;
const SHOUT_MS = 1150;
const SHOUT_RISE = 16;
const SHOUT_SCALE = 2;

export interface PlayOpts {
  /** Ground line used for depth sorting (default: the point's own y). */
  groundY?: number;
  flipX?: boolean;
  delayMs?: number;
  onDone?: () => void;
}

export interface FxLoop {
  move(at: WorldPoint, groundY?: number): void;
  stop(): void;
}

interface Shout {
  text: Phaser.GameObjects.Text;
  at: WorldPoint;
  start: number;
}

export interface FxEnv {
  /** prefers-reduced-motion: no projectiles, no loops, words fade in place. */
  reduced(): boolean;
  /** The tab is hidden: nothing is created (it would only pile up). */
  hidden(): boolean;
}

export const browserFxEnv: FxEnv = {
  reduced: () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  hidden: () => typeof document !== 'undefined' && document.visibilityState !== 'visible',
};

/**
 * Plays baked pixelfx strips in the town (world space, registered with the main camera only) and the floating
 * onomatopoeia over them (overlay space, re-placed every frame). Effects never carry text themselves; the words
 * come from ko.ts and are never numbers.
 */
export class FxPlayer {
  private live = 0;
  private readonly shouts: Shout[] = [];
  private readonly loader: StripLoader;
  /** How many of each effect this screen started (dev/e2e debug hook only). */
  readonly drawn: Record<string, number> = {};

  constructor(
    private readonly stage: Stage,
    private readonly env: FxEnv = browserFxEnv,
  ) {
    this.loader = new StripLoader(stage.scene);
  }

  private get scene(): Phaser.Scene {
    return this.stage.scene;
  }

  get reduced(): boolean {
    return this.env.reduced();
  }

  preload(ids: readonly string[]): void {
    this.loader.request(ids);
  }

  /** Runs `fn` after `ms` on the scene's clock (it pauses with the scene). */
  after(ms: number, fn: () => void): void {
    this.scene.time.delayedCall(ms, fn);
  }

  private allowed(): boolean {
    return !this.env.hidden() && this.live < MAX_LIVE_FX;
  }

  private depthOf(e: FxCatalogEntry, groundY: number): number {
    // Under: on the floor, below everyone and every monitor; over: above whoever stands near that line.
    return e.depth === 'under' ? DEPTH.furniture + 0.5 : DEPTH.entities + groundY + 40;
  }

  private sprite(id: string, e: FxCatalogEntry, at: WorldPoint, opts: PlayOpts): Phaser.GameObjects.Sprite {
    this.loader.ensureAnim(id, e);
    const s = this.stage.world(this.scene.add.sprite(at.x, at.y, stripKey(id), 0));
    s.setOrigin(e.pivot[0] / e.w, e.pivot[1] / e.h);
    s.setDepth(this.depthOf(e, opts.groundY ?? at.y));
    if (opts.flipX) s.setFlipX(true);
    this.live++;
    s.once(Phaser.GameObjects.Events.DESTROY, () => this.live--);
    this.drawn[id] = (this.drawn[id] ?? 0) + 1;
    return s;
  }

  /** Runs `fn` once the strips are loaded (now, if they are). */
  private whenReady(ids: readonly string[], fn: () => void): void {
    if (ids.every((id) => this.loader.ready(id))) fn();
    else this.loader.request(ids, fn);
  }

  /** One pass of a strip with its origin at `at` (world px). */
  play(id: string, at: WorldPoint, opts: PlayOpts = {}): void {
    const e = fxEntry(id);
    if (!e || !this.allowed()) {
      opts.onDone?.();
      return;
    }
    const go = () => {
      if (!this.allowed()) {
        opts.onDone?.();
        return;
      }
      const s = this.sprite(id, e, at, opts);
      s.play(stripKey(id));
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        s.destroy();
        opts.onDone?.();
      });
    };
    this.whenReady([id], () => {
      if (opts.delayMs) this.scene.time.delayedCall(opts.delayMs, go);
      else go();
    });
  }

  /** A looping strip that follows someone (auras); null with reduced motion or a missing strip. */
  loop(id: string, at: WorldPoint, groundY = at.y): FxLoop | null {
    const e = fxEntry(id);
    if (!e || this.env.reduced()) return null;
    let sprite: Phaser.GameObjects.Sprite | null = null;
    let stopped = false;
    let pos = at;
    let ground = groundY;
    this.whenReady([id], () => {
      if (stopped || this.live >= MAX_LIVE_FX) return;
      sprite = this.sprite(id, e, pos, { groundY: ground });
      sprite.play(stripKey(id));
    });
    return {
      move: (p, g = p.y) => {
        pos = p;
        ground = g;
        sprite?.setPosition(p.x, p.y).setDepth(this.depthOf(e, g));
      },
      stop: () => {
        stopped = true;
        sprite?.destroy();
        sprite = null;
      },
    };
  }

  /**
   * A projectile: a looping strip along an arc from `from` to `to`, turned along its flight when `rotate`
   * (strips are drawn flying to the right). With reduced motion, a hidden tab or no strip it lands at once.
   */
  fly(
    id: string,
    from: WorldPoint,
    to: WorldPoint,
    opts: {
      durationMs?: number;
      lift?: number;
      rotate?: boolean;
      /** Strips drawn flying right are mirrored for a throw to the left (instead of rotated). */
      mirrorLeft?: boolean;
      onArrive: () => void;
    },
  ): void {
    const e = fxEntry(id);
    if (!e || this.env.reduced() || !this.allowed()) {
      opts.onArrive();
      return;
    }
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const duration = opts.durationMs ?? Math.min(1100, 380 + dist * 2.2);
    const c = arcControl(from, to);
    if (opts.lift !== undefined) c.y = Math.min(from.y, to.y) - opts.lift;
    this.whenReady([id], () => {
      if (!this.allowed()) {
        opts.onArrive();
        return;
      }
      const s = this.sprite(id, e, from, {
        groundY: Math.max(from.y, to.y) + 20,
        flipX: opts.mirrorLeft === true && to.x < from.x,
      });
      s.setDepth(DEPTH.night - 1);
      s.play(stripKey(id));
      const state = { t: 0 };
      let last = from;
      this.scene.tweens.add({
        targets: state,
        t: 1,
        duration,
        ease: 'Sine.easeIn',
        onUpdate: () => {
          const p = bezier(from, c, to, state.t);
          if (opts.rotate && Math.hypot(p.x - last.x, p.y - last.y) > 0.01) {
            s.setRotation(Math.atan2(p.y - last.y, p.x - last.x));
          }
          last = p;
          s.setPosition(p.x, p.y);
        },
        onComplete: () => {
          s.destroy();
          opts.onArrive();
        },
      });
    });
  }

  /** A chain of lightning between two points (drawn, a few frames): the combo's link. */
  chain(a: WorldPoint, b: WorldPoint, seed: number): void {
    if (this.env.reduced() || !this.allowed()) return;
    const g = this.stage.world(this.scene.add.graphics());
    g.setDepth(DEPTH.night - 1);
    let n = seed >>> 0 || 1;
    const rand = () => {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      return n / 4294967296;
    };
    const draw = () => {
      g.clear();
      const steps = Math.max(5, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 7));
      const pts: WorldPoint[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const j = i === 0 || i === steps ? 0 : (rand() - 0.5) * 7;
        pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + j });
      }
      const stroke = (width: number, color: number, alpha: number) => {
        g.lineStyle(width, color, alpha);
        g.beginPath();
        g.moveTo(pts[0]!.x, pts[0]!.y);
        for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
        g.strokePath();
      };
      stroke(3, COLORS.planeTrail, 0.55);
      stroke(1, COLORS.white, 1);
    };
    draw();
    const timer = this.scene.time.addEvent({ delay: 60, repeat: 6, callback: draw });
    this.scene.time.delayedCall(480, () => {
      timer.remove();
      g.destroy();
    });
  }

  /** A floating word (onomatopoeia from ko.ts) that pops over a point and rises away. */
  shout(text: string, at: WorldPoint, color: string, delayMs = 0): void {
    if (this.env.hidden() || !text) return;
    const make = () => {
      const t = this.stage.overlay(
        this.scene.add.text(0, 0, text, {
          fontFamily: this.stage.font,
          fontSize: `${PIXEL_FONT_SIZE}px`,
          color,
          stroke: COLORS.inkCss,
          strokeThickness: 3,
        }),
      );
      t.setOrigin(0.5, 1)
        .setDepth(DEPTH.overlayChat - 10)
        .setScale(SHOUT_SCALE)
        .setAlpha(0);
      this.shouts.push({ text: t, at, start: this.scene.time.now });
    };
    if (delayMs) this.scene.time.delayedCall(delayMs, make);
    else make();
  }

  /** Re-places the floating words (the overlay camera does not follow the map). */
  update(now: number): void {
    const reduced = this.env.reduced();
    for (let i = this.shouts.length - 1; i >= 0; i--) {
      const s = this.shouts[i]!;
      const k = (now - s.start) / SHOUT_MS;
      if (k >= 1) {
        s.text.destroy();
        this.shouts.splice(i, 1);
        continue;
      }
      const rise = reduced ? 0 : SHOUT_RISE * (1 - (1 - k) * (1 - k));
      const p = this.stage.toScreen(s.at.x, s.at.y - rise);
      let scale = SHOUT_SCALE;
      if (!reduced && k < 0.1) scale = SHOUT_SCALE * (0.55 + 0.75 * (k / 0.1));
      else if (!reduced && k < 0.18) scale = SHOUT_SCALE * (1.3 - 0.3 * ((k - 0.1) / 0.08));
      s.text
        .setPosition(p.x, p.y)
        .setScale(Math.round(scale * 4) / 4)
        .setAlpha(k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1);
    }
  }

  destroy(): void {
    for (const s of this.shouts.splice(0)) s.text.destroy();
  }
}

/** Where a strip with this anchor goes on someone standing with their feet at `feet`. */
export function anchorPoint(feet: WorldPoint, anchor: keyof typeof ANCHOR_ABOVE_FEET): WorldPoint {
  return { x: feet.x, y: feet.y - ANCHOR_ABOVE_FEET[anchor] };
}
