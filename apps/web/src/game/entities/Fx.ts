import type Phaser from 'phaser';
import { FX_SPARKLE_ANIM, TEX } from '../assets';
import { EFFECT_FRAMES } from '../spriteSpec';
import type { FxPlayer } from '../fx/FxPlayer';
import { COLORS, DEPTH, type Stage } from '../stage';

export interface WorldPoint {
  x: number;
  y: number;
}

/** The paper plane flies at full icon size (16 px), swelling a little mid-flight. */
const PLANE_SCALE = 1;
/** World px between the dots of the plane's trail. */
const PLANE_TRAIL_GAP = 7;

/** Quadratic Bézier point for t in [0, 1]. */
export function bezier(a: WorldPoint, c: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** Control point that lifts an arc above the straight line between a and b (higher for longer arcs). */
export function arcControl(a: WorldPoint, b: WorldPoint): WorldPoint {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 28 - dist * 0.22 };
}

/**
 * One-shot effects in world space (they scale with the map and never carry text): the sparkle, the public
 * wave arc (landing in a burst of hearts) and the participant-only DM paper plane (landing in a puff).
 */
export class Fx {
  constructor(
    private readonly stage: Stage,
    private readonly player: FxPlayer | null = null,
  ) {}

  private get scene(): Phaser.Scene {
    return this.stage.scene;
  }

  private get ready(): boolean {
    return this.scene.textures.exists(TEX.effects);
  }

  /** The existing four-frame sparkle at a point (arrival, leaving, landing). */
  sparkle(at: WorldPoint, scale = 1): void {
    if (!this.ready) return;
    const s = this.stage.world(this.scene.add.sprite(at.x, at.y, TEX.effects, EFFECT_FRAMES.sparkle0));
    s.setDepth(DEPTH.entities + at.y + 40).setScale(scale);
    if (this.scene.anims.exists(FX_SPARKLE_ANIM)) {
      s.play(FX_SPARKLE_ANIM);
      s.once('animationcomplete', () => s.destroy());
    } else {
      this.scene.time.delayedCall(400, () => s.destroy());
    }
  }

  /** Claude wrote a colleague-visible log entry: sparkle + a clipboard popping over the head. */
  logPulse(head: WorldPoint): void {
    if (!this.ready) return;
    this.sparkle({ x: head.x - 7, y: head.y + 2 }, 0.9);
    this.scene.time.delayedCall(120, () => this.sparkle({ x: head.x + 8, y: head.y - 4 }, 0.7));
    const icon = this.stage.world(this.scene.add.image(head.x, head.y, TEX.effects, EFFECT_FRAMES.clipboard));
    icon
      .setDepth(DEPTH.entities + head.y + 41)
      .setScale(0.4)
      .setAlpha(0);
    this.scene.tweens.add({
      targets: icon,
      y: head.y - 16,
      scale: { from: 0.4, to: 0.8 },
      alpha: { from: 1, to: 0 },
      duration: 1100,
      ease: 'Sine.easeOut',
      onComplete: () => icon.destroy(),
    });
  }

  /**
   * A public wave: a faint dotted arc from the sender to the target with three hearts travelling along it. With
   * reduced motion no hearts fly: only their landing burst plays at the target. False when nothing was drawn.
   */
  wave(from: WorldPoint, to: WorldPoint): boolean {
    if (this.player?.reduced) {
      this.player.play('town/heart-burst', to);
      return true;
    }
    if (!this.ready) return false;
    const c = arcControl(from, to);
    const trail = this.stage.world(this.scene.add.graphics());
    trail.setDepth(DEPTH.night - 1);
    const steps = Math.max(8, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 7));
    trail.fillStyle(COLORS.petBubbleBorder, 0.85);
    for (let i = 1; i < steps; i++) {
      const p = bezier(from, c, to, i / steps);
      trail.fillCircle(p.x, p.y, 1.4);
    }
    trail.setAlpha(0);
    this.scene.tweens.add({
      targets: trail,
      alpha: 1,
      duration: 160,
      yoyo: true,
      hold: 900,
      onComplete: () => trail.destroy(),
    });
    for (let i = 0; i < 3; i++) {
      const heart = this.stage.world(this.scene.add.image(from.x, from.y, TEX.effects, EFFECT_FRAMES.heart));
      heart
        .setDepth(DEPTH.night - 1)
        .setScale(0.55)
        .setAlpha(0);
      const state = { t: 0 };
      this.scene.tweens.add({
        targets: state,
        t: 1,
        delay: i * 140,
        duration: 950,
        ease: 'Sine.easeInOut',
        onStart: () => heart.setAlpha(1),
        onUpdate: () => {
          const p = bezier(from, c, to, state.t);
          heart.setPosition(p.x, p.y).setScale(0.5 + 0.25 * Math.sin(state.t * Math.PI));
        },
        onComplete: () => {
          heart.destroy();
          if (i !== 2) return;
          if (this.player) this.player.play('town/heart-burst', to);
          else this.sparkle({ x: to.x, y: to.y - 4 });
        },
      });
    }
    return true;
  }

  /**
   * A DM or work request between the two participants (drawn only on their own screens): a paper plane
   * at full icon size leaving a fading dotted trail, so it reads as a flight (a small pale plane alone
   * looked like a mouse pointer). With reduced motion nothing flies: only the puff where it lands plays.
   * False when nothing was drawn.
   */
  plane(from: WorldPoint, to: WorldPoint): boolean {
    if (this.player?.reduced) {
      this.player.play('town/plane-puff', to);
      return true;
    }
    if (!this.ready) return false;
    const c = arcControl(from, to);
    const plane = this.stage.world(this.scene.add.image(from.x, from.y, TEX.effects, EFFECT_FRAMES.plane));
    plane.setDepth(DEPTH.night - 1).setScale(PLANE_SCALE);
    const trail = this.stage.world(this.scene.add.graphics());
    trail.setDepth(DEPTH.night - 2);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const state = { t: 0 };
    let last = from;
    // Trail dots at fixed spots along the arc, laid down as the plane passes them (even on slow frames).
    const dots = Math.max(6, Math.round(dist / PLANE_TRAIL_GAP));
    let dotsDrawn = 0;
    this.scene.tweens.add({
      targets: state,
      t: 1,
      duration: Math.min(1700, 800 + dist * 1.6),
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const p = bezier(from, c, to, state.t);
        // The icon points up-right (-45°): rotate it along the direction of flight.
        if (Math.hypot(p.x - last.x, p.y - last.y) > 0.01) {
          plane.setRotation(Math.atan2(p.y - last.y, p.x - last.x) + Math.PI / 4);
        }
        last = p;
        trail.fillStyle(COLORS.planeTrail, 0.8);
        while (dotsDrawn < dots && (dotsDrawn + 1) / dots < state.t) {
          dotsDrawn++;
          const d = bezier(from, c, to, dotsDrawn / dots);
          trail.fillCircle(d.x, d.y, 1.6);
        }
        plane.setPosition(p.x, p.y).setScale(PLANE_SCALE + 0.3 * Math.sin(state.t * Math.PI));
      },
      onComplete: () => {
        plane.destroy();
        if (this.player) this.player.play('town/plane-puff', to);
        else this.sparkle({ x: to.x, y: to.y });
        this.scene.tweens.add({ targets: trail, alpha: 0, duration: 500, onComplete: () => trail.destroy() });
      },
    });
    return true;
  }
}
