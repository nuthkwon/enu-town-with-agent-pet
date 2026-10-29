import Phaser from 'phaser';
import { STEP_MS, type Dir } from '@enu/protocol';
import { TEX } from '../assets';
import { avatarAnimKey, avatarFrames, toDir, walkFrameIndex, walkLift } from '../logic/direction';
import { TileInterpolator, hopOffset } from '../logic/interpolation';
import { AVATAR_ORIGIN, EFFECT_FRAMES } from '../spriteSpec';
import { DEPTH, avatarFeetY, tileCenterX, type Stage } from '../stage';
import { ChatBubble } from './ChatBubble';
import { NameTag } from './NameTag';

export interface AvatarInit {
  userId: string;
  name: string;
  x: number;
  y: number;
  dir: number;
  status: number;
  teamColor: number;
  isMe: boolean;
}

/** Extra per-step hop on top of the sheet's own squash/stretch frames (px). */
export const HOP_TWEEN_PX = 2;
/** Head height above the feet (world px) used to place the name tag. */
const HEAD_ABOVE_FEET = 27;

/**
 * One person: drop shadow + hopping sprite (world), sparkle trail while moving, and a name tag and
 * chat bubble in screen space. Position comes from a TileInterpolator fed with tile targets.
 */
export class AvatarView {
  readonly userId: string;
  readonly isMe: boolean;
  readonly interp: TileInterpolator;
  private readonly root: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly trail: Phaser.GameObjects.Particles.ParticleEmitter | null;
  private readonly tag: NameTag;
  private readonly chat: ChatBubble;
  private texKey: string | null = null;
  private feetX = 0;
  private feetY = 0;
  private serverDir: Dir;
  private visibleOnScreen = true;

  constructor(
    private readonly stage: Stage,
    init: AvatarInit,
    onClick: (view: AvatarView, pointer: Phaser.Input.Pointer) => void,
  ) {
    const scene = stage.scene;
    this.userId = init.userId;
    this.isMe = init.isMe;
    this.serverDir = toDir(init.dir);
    this.interp = new TileInterpolator(init.x, init.y, toDir(init.dir), STEP_MS);

    this.shadow = scene.add.image(0, 1, TEX.effects, EFFECT_FRAMES.shadow).setAlpha(0.85);
    this.sprite = scene.add.sprite(0, 0, '__MISSING').setOrigin(AVATAR_ORIGIN.x, AVATAR_ORIGIN.y);
    this.sprite.setVisible(false);
    this.root = stage.world(scene.add.container(0, 0, [this.shadow, this.sprite]));

    this.sprite.setInteractive(new Phaser.Geom.Rectangle(7, 2, 18, 30), Phaser.Geom.Rectangle.Contains);
    if (this.sprite.input) this.sprite.input.cursor = 'pointer';
    this.sprite.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        onClick(this, pointer);
      },
    );

    this.trail = scene.textures.exists(TEX.effects)
      ? stage.world(
          scene.add.particles(0, 0, TEX.effects, {
            frame: [EFFECT_FRAMES.sparkle1, EFFECT_FRAMES.sparkle2, EFFECT_FRAMES.star, EFFECT_FRAMES.heart],
            lifespan: { min: 380, max: 620 },
            speedX: { min: -10, max: 10 },
            speedY: { min: -24, max: -6 },
            scale: { start: 0.55, end: 0.1 },
            alpha: { start: 0.95, end: 0 },
            frequency: 120,
            quantity: 1,
            maxAliveParticles: 5,
            emitting: false,
          }),
        )
      : null;

    this.tag = new NameTag(stage, init.name, init.teamColor, init.status, init.isMe);
    this.chat = new ChatBubble(stage);
    this.place(this.interp.update(scene.time.now));
  }

  /** The avatar sheet finished loading (or changed). */
  setAvatarKey(avatarKey: string): void {
    const tex = TEX.avatar(avatarKey);
    if (!this.stage.scene.textures.exists(tex) || tex === this.texKey) return;
    this.texKey = tex;
    this.sprite.setTexture(tex, avatarFrames(this.interp.dir, 'idle').start);
    this.sprite.setVisible(true);
    this.sprite.anims.stop();
  }

  setName(name: string): void {
    this.tag.setName(name);
  }

  setStatus(status: number): void {
    this.tag.setStatus(status);
  }

  setTeamColor(color: number): void {
    this.tag.setTeamColor(color);
  }

  /** Authoritative tile from the server (remote players) or the local prediction (me). */
  moveTo(x: number, y: number): void {
    this.interp.push(x, y);
  }

  snapTo(x: number, y: number, dir?: number): void {
    this.interp.snap(x, y, dir === undefined ? undefined : toDir(dir));
  }

  /** Facing reported by the server; used while standing still (turning in place). */
  setServerDir(dir: number): void {
    this.serverDir = toDir(dir);
  }

  showChat(text: string, now: number): void {
    this.chat.show(text, now);
  }

  get feet(): { x: number; y: number } {
    return { x: this.feetX, y: this.feetY };
  }

  get tile(): { x: number; y: number } {
    return this.interp.target;
  }

  private place(sample: ReturnType<TileInterpolator['update']>): void {
    this.feetX = Math.round(tileCenterX(sample.x));
    this.feetY = Math.round(avatarFeetY(sample.y));
  }

  update(now: number): void {
    const s = this.interp.update(now);
    if (!s.moving && !this.isMe) this.interp.dir = this.serverDir;
    this.place(s);
    const dir = s.moving ? s.dir : this.interp.dir;
    const lift = s.moving ? Math.round(-hopOffset(s.hop, HOP_TWEEN_PX)) : 0;
    this.root.setPosition(this.feetX, this.feetY);
    this.root.setDepth(DEPTH.entities + this.feetY);
    this.sprite.y = -lift;

    let frameLift = 0;
    if (this.texKey) {
      if (s.moving) {
        const idx = walkFrameIndex(s.hop, s.steps);
        this.sprite.anims.stop();
        this.sprite.setFrame(avatarFrames(dir, 'walk').start + idx);
        frameLift = walkLift(idx);
      } else {
        const key = avatarAnimKey(this.texKey, dir, 'idle');
        if (this.sprite.anims.currentAnim?.key !== key || !this.sprite.anims.isPlaying) {
          if (this.stage.scene.anims.exists(key)) this.sprite.play({ key, startFrame: 0 }, true);
        }
      }
    }
    const air = lift + frameLift;
    this.shadow.setScale(1 - Math.min(0.35, air * 0.06), 1 - Math.min(0.3, air * 0.05));
    this.shadow.setAlpha(0.85 - Math.min(0.35, air * 0.05));

    if (this.trail) {
      this.trail.setPosition(this.feetX, this.feetY - 6);
      this.trail.setDepth(DEPTH.entities + this.feetY - 1);
      if (s.moving && !this.trail.emitting) this.trail.start();
      else if (!s.moving && this.trail.emitting) this.trail.stop();
    }

    // screen-space overlays
    const head = this.stage.toScreen(this.feetX, this.feetY - HEAD_ABOVE_FEET - lift - frameLift);
    const onScreen =
      head.x > -120 && head.x < this.stage.viewWidth + 120 && head.y > -80 && head.y < this.stage.viewHeight + 120;
    if (onScreen !== this.visibleOnScreen) {
      this.visibleOnScreen = onScreen;
      this.tag.setVisible(onScreen);
    }
    this.tag.setPosition(head.x, head.y);
    this.chat.update(now, head.x, head.y - this.tag.height - 2, this.stage.viewWidth);
  }

  destroy(): void {
    this.trail?.destroy();
    this.root.destroy();
    this.tag.destroy();
    this.chat.destroy();
  }
}
