import Phaser from 'phaser';
import { STEP_MS, type Dir } from '@enu/protocol';
import { TEX } from '../assets';
import { avatarAnimKey, avatarFrames, toDir, walkFrameIndex, walkLift } from '../logic/direction';
import { TileInterpolator, hopOffset } from '../logic/interpolation';
import type { TagPlacement } from '../logic/tags';
import { AVATAR_ANIMS, AVATAR_COLUMNS, AVATAR_ORIGIN, EFFECT_FRAMES } from '../spriteSpec';
import { COLORS, DEPTH, avatarFeetY, tileCenterX, type Stage } from '../stage';
import { ChatBubble } from './ChatBubble';
import { NameTag } from './NameTag';

export interface AvatarInit {
  userId: string;
  name: string;
  x: number;
  y: number;
  dir: number;
  teamColor: number;
  isMe: boolean;
}

export interface AvatarHandlers {
  onClick(view: AvatarView, pointer: Phaser.Input.Pointer): void;
  onHover(view: AvatarView | null, pointer: Phaser.Input.Pointer): void;
}

/** What the projection says about this person (drives the overlays, never the position). */
export interface AvatarPresence {
  online: boolean;
  /** Effects frame of the activity icon over the head, or null. */
  iconFrame: number | null;
  /** Sitting at their own desk: the desk plate carries the name, so no floating tag. */
  atDesk: boolean;
}

/** Extra per-step hop on top of the sheet's own squash/stretch frames (px). */
export const HOP_TWEEN_PX = 2;
/** Head height above the feet (world px) used to place the name tag. */
const HEAD_ABOVE_FEET = 27;
const SCALE_IN_MS = 600;
/** How long the wand stays raised after a real cast. */
const CAST_MS = 650;
/**
 * Wand tip relative to the feet per facing (world px; down, left, right, up), where a spell charges and leaves.
 * Matches the wand drawn in the avatar sheets.
 */
const WAND_TIP: Record<number, { x: number; y: number }> = {
  0: { x: 8, y: -12 },
  1: { x: -10, y: -13 },
  2: { x: 10, y: -13 },
  3: { x: -8, y: -15 },
};
const FADE_OUT_MS = 320;
const PULSE_PERIOD_MS = 700;

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Gap (screen px) between the feet and a tag moved under them. */
const TAG_BELOW_GAP = 3;
/** The 16 px activity icon plus a 2 px gap, drawn inline on the left of a floating tag. */
const ICON_LEAD = 18;

/**
 * One roster member: a team-colour ground ring, drop shadow and hopping sprite (world), plus the
 * activity icon, floating name tag and chat bubble in screen space. The server director places the
 * avatar (a TileInterpolator replays its tiles); nobody steers it. Hidden members are not drawn at all.
 */
export class AvatarView {
  readonly userId: string;
  readonly isMe: boolean;
  readonly interp: TileInterpolator;
  private readonly root: Phaser.GameObjects.Container;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly pulseRing: Phaser.GameObjects.Graphics;
  private readonly trail: Phaser.GameObjects.Particles.ParticleEmitter | null;
  private readonly icon: Phaser.GameObjects.Image | null;
  private readonly tag: NameTag;
  private readonly chat: ChatBubble;
  private texKey: string | null = null;
  private feetX = 0;
  private feetY = 0;
  private serverDir: Dir;
  private teamColor: number;
  private shown = false;
  private presence: AvatarPresence = { online: false, iconFrame: null, atDesk: false };
  private tween: Phaser.Tweens.Tween | null = null;
  private pulseStart = 0;
  private pulseUntil = 0;
  private headX = 0;
  private headY = 0;
  private feetSY = 0;
  private onScreen = false;
  private castUntil = 0;
  private castDir: Dir = 0 as Dir;

  constructor(
    private readonly stage: Stage,
    init: AvatarInit,
    handlers: AvatarHandlers,
  ) {
    const scene = stage.scene;
    this.userId = init.userId;
    this.isMe = init.isMe;
    this.teamColor = init.teamColor;
    this.serverDir = toDir(init.dir);
    this.interp = new TileInterpolator(init.x, init.y, toDir(init.dir), STEP_MS);

    this.ring = scene.add.graphics();
    this.shadow = scene.add.image(0, 1, TEX.effects, EFFECT_FRAMES.shadow).setAlpha(0.85);
    this.sprite = scene.add.sprite(0, 0, '__MISSING').setOrigin(AVATAR_ORIGIN.x, AVATAR_ORIGIN.y);
    this.sprite.setVisible(false);
    this.root = stage.world(scene.add.container(0, 0, [this.shadow, this.ring, this.sprite]));
    this.root.setVisible(false);
    this.drawRing();

    this.pulseRing = stage.world(scene.add.graphics());
    this.pulseRing.setVisible(false);

    this.sprite.setInteractive(new Phaser.Geom.Rectangle(7, 2, 18, 30), Phaser.Geom.Rectangle.Contains);
    if (this.sprite.input) this.sprite.input.cursor = 'pointer';
    this.sprite.disableInteractive();
    this.sprite.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        if (pointer.button !== 0) return;
        ev.stopPropagation();
        handlers.onClick(this, pointer);
      },
    );
    this.sprite.on('pointerover', (pointer: Phaser.Input.Pointer) => handlers.onHover(this, pointer));
    this.sprite.on('pointerout', (pointer: Phaser.Input.Pointer) => handlers.onHover(null, pointer));

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

    this.icon = scene.textures.exists(TEX.effects)
      ? stage
          .overlay(scene.add.image(0, 0, TEX.effects, EFFECT_FRAMES.headset))
          .setDepth(DEPTH.overlayIcon)
          .setVisible(false)
      : null;
    this.tag = new NameTag(stage, init.name, init.teamColor, init.isMe);
    this.tag.setVisible(false);
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

  setTeamColor(color: number): void {
    if (color === this.teamColor) return;
    this.teamColor = color;
    this.tag.setTeamColor(color);
    this.drawRing();
  }

  private drawRing(): void {
    // A 2 px team-colour ellipse on the floor around the feet (spec §5.4).
    this.ring.clear();
    this.ring.lineStyle(2, this.teamColor, 0.95);
    this.ring.strokeEllipse(0, 1, 24, 10);
  }

  get isShown(): boolean {
    return this.shown;
  }

  /**
   * Hidden -> shown: placed directly at its spot with a sparkle and a 600 ms scale-in (no door walk).
   * Shown -> hidden: fades out where it stands. Nothing is drawn while hidden.
   */
  setShown(shown: boolean, x: number, y: number, dir: number, animate: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.tween?.stop();
    this.tween = null;
    const scene = this.stage.scene;
    if (shown) {
      this.interp.snap(x, y, toDir(dir));
      this.serverDir = toDir(dir);
      this.place(this.interp.update(scene.time.now));
      this.root.setPosition(this.feetX, this.feetY).setVisible(true);
      this.sprite.setInteractive();
      if (animate) {
        this.root.setScale(0.4).setAlpha(0);
        this.tween = scene.tweens.add({
          targets: this.root,
          scale: 1,
          alpha: 1,
          duration: SCALE_IN_MS,
          ease: 'Back.easeOut',
        });
      } else {
        this.root.setScale(1).setAlpha(1);
      }
    } else {
      this.sprite.disableInteractive();
      this.trail?.stop();
      this.chat.hide();
      this.hideOverlays();
      if (animate) {
        this.tween = scene.tweens.add({
          targets: this.root,
          alpha: 0,
          scale: 0.7,
          duration: FADE_OUT_MS,
          ease: 'Sine.easeIn',
          onComplete: () => {
            if (!this.shown) this.root.setVisible(false);
          },
        });
      } else {
        this.root.setVisible(false);
      }
    }
  }

  setPresence(p: AvatarPresence): void {
    this.presence = p;
    this.tag.setOnline(p.online);
    if (this.icon && p.iconFrame !== null) this.icon.setFrame(p.iconFrame);
  }

  /** Authoritative tile from the server director. */
  moveTo(x: number, y: number): void {
    this.interp.push(x, y);
  }

  /** Facing reported by the server; used while standing still (turning in place). */
  setServerDir(dir: number): void {
    this.serverDir = toDir(dir);
  }

  showChat(text: string, now: number): void {
    if (this.shown) this.chat.show(text, now);
  }

  /** 2 s pulse ring around the feet (`이 사람 보기`, team-rail hover). */
  pulse(now: number, durationMs = 2000): void {
    this.pulseStart = now;
    this.pulseUntil = now + durationMs;
  }

  stopPulse(): void {
    this.pulseUntil = 0;
  }

  get feet(): { x: number; y: number } {
    return { x: this.feetX, y: this.feetY };
  }

  /** World point a little above the feet (links, arcs and planes start here). */
  get chest(): { x: number; y: number } {
    return { x: this.feetX, y: this.feetY - 14 };
  }

  get tile(): { x: number; y: number } {
    return this.interp.target;
  }

  /**
   * Raises the wand towards `dir` for a moment: only ever called when this person really cast a spell (the
   * server's `spell` message), never to fake activity. Sheets without cast frames simply stay idle.
   */
  playCast(dir: Dir, now: number): void {
    if (!this.shown) return;
    this.castDir = dir;
    this.castUntil = now + CAST_MS;
  }

  /** Where the wand tip is now (world px). */
  get wandTip(): { x: number; y: number } {
    const facing = this.castUntil > this.stage.scene.time.now ? this.castDir : this.interp.dir;
    const o = WAND_TIP[facing] ?? WAND_TIP[0]!;
    return { x: this.feetX + o.x, y: this.feetY + o.y };
  }

  private castKey(dir: Dir): string {
    return `${this.texKey}:cast:${dir}`;
  }

  /** Creates the cast animation for this sheet once, if the sheet has the frames. */
  private ensureCastAnim(dir: Dir): boolean {
    const def = (
      AVATAR_ANIMS as Record<string, { start: number; frames: number; frameRate: number } | undefined>
    ).cast;
    const scene = this.stage.scene;
    if (!def || !this.texKey) return false;
    const key = this.castKey(dir);
    if (scene.anims.exists(key)) return true;
    const start = dir * AVATAR_COLUMNS + def.start;
    const end = start + def.frames - 1;
    if (scene.textures.get(this.texKey).frameTotal - 1 <= end) return false;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(this.texKey, { start, end }),
      frameRate: def.frameRate,
      repeat: 0,
    });
    return true;
  }

  private place(sample: ReturnType<TileInterpolator['update']>): void {
    this.feetX = Math.round(tileCenterX(sample.x));
    this.feetY = Math.round(avatarFeetY(sample.y));
  }

  /** World update (position, animation, pulse) and the head's screen position for the overlays. */
  update(now: number): void {
    const s = this.interp.update(now);
    if (!s.moving) this.interp.dir = this.serverDir;
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
      } else if (now < this.castUntil && this.ensureCastAnim(this.castDir)) {
        const key = this.castKey(this.castDir);
        if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play({ key, startFrame: 0 }, true);
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
      const walking = this.shown && s.moving;
      if (walking && !this.trail.emitting) this.trail.start();
      else if (!walking && this.trail.emitting) this.trail.stop();
    }

    if (this.pulseUntil > now && this.shown) {
      const phase = ((now - this.pulseStart) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
      const g = this.pulseRing;
      g.clear();
      g.lineStyle(2, COLORS.pulse, 0.9 * (1 - phase));
      g.strokeEllipse(this.feetX, this.feetY + 1, 26 + phase * 22, 11 + phase * 9);
      g.lineStyle(2, COLORS.pulse, 0.9);
      g.strokeEllipse(this.feetX, this.feetY + 1, 26, 11);
      g.setDepth(DEPTH.entities + this.feetY - 1).setVisible(true);
    } else if (this.pulseRing.visible) {
      this.pulseRing.clear().setVisible(false);
    }

    const head = this.stage.toScreen(this.feetX, this.feetY - HEAD_ABOVE_FEET - air);
    this.headX = head.x;
    this.headY = head.y;
    this.feetSY = this.stage.toScreen(this.feetX, this.feetY).y;
    this.onScreen =
      this.shown &&
      head.x > -120 &&
      head.x < this.stage.viewWidth + 120 &&
      head.y > -80 &&
      head.y < this.stage.viewHeight + 140;
  }

  /** True when a floating name tag is drawn (shown, on screen, away from the own desk). */
  get wantsTag(): boolean {
    return this.onScreen && !this.presence.atDesk;
  }

  /** Width (screen px) the inline activity icon adds on the left of a floating tag above the head. */
  private get iconLead(): number {
    return this.icon && this.presence.iconFrame !== null ? ICON_LEAD : 0;
  }

  /** Where the floating tag (with its inline activity icon) would sit before decluttering (screen px). */
  tagRect(): ScreenRect {
    const w = this.tag.width;
    const lead = this.iconLead;
    return {
      x: this.headX - (w + lead) / 2,
      y: this.headY - this.tag.height,
      w: w + lead,
      h: this.tag.height,
    };
  }

  /** The decluttering alternative: the tag just under the feet (clear of the pet hovering above). */
  tagRectBelow(): ScreenRect {
    const w = this.tag.width;
    return { x: this.headX - w / 2, y: this.feetSY + TAG_BELOW_GAP, w, h: this.tag.height };
  }

  /**
   * Positions the screen-space overlays: the tag above the head (moved up by `tag.shift` px, or put under
   * the feet with `tag.below`, when the scene decluttered it) with the activity icon inline on its left,
   * or the icon alone over the head when no tag is above it (at the own desk, the plate carries the
   * name); then the chat bubble. Keeping the icon beside the tag keeps the stack low, clear of the pet
   * hovering behind its owner.
   */
  placeOverlays(now: number, tag: TagPlacement, chatAllowed: boolean): void {
    if (!this.onScreen) {
      this.hideOverlays();
      if (!this.shown) this.chat.hide();
      return;
    }
    let top = this.headY;
    let tagBottom: number | null = null;
    if (this.wantsTag) {
      if (tag.below) {
        this.tag.setPosition(this.headX, this.feetSY + TAG_BELOW_GAP + this.tag.height);
      } else {
        tagBottom = this.headY - tag.shift;
        this.tag.setPosition(this.headX + this.iconLead / 2, tagBottom);
        top = tagBottom - this.tag.height;
      }
      this.tag.setVisible(true);
    } else {
      this.tag.setVisible(false);
    }
    if (this.icon) {
      if (this.presence.iconFrame !== null) {
        const bob = Math.round(Math.sin(now / 520 + this.feetX) * 1);
        if (tagBottom !== null) {
          const left = this.headX + this.iconLead / 2 - this.tag.width / 2;
          this.icon.setPosition(left - ICON_LEAD / 2, tagBottom - this.tag.height / 2 + bob).setVisible(true);
        } else {
          this.icon.setPosition(this.headX, top - 9 + bob).setVisible(true);
          top -= 18;
        }
      } else {
        this.icon.setVisible(false);
      }
    }
    if (!chatAllowed) this.chat.hide();
    this.chat.update(now, this.headX, top - 2, this.stage.viewWidth);
  }

  private hideOverlays(): void {
    this.tag.setVisible(false);
    this.icon?.setVisible(false);
  }

  destroy(): void {
    this.tween?.stop();
    this.trail?.destroy();
    this.root.destroy();
    this.pulseRing.destroy();
    this.icon?.destroy();
    this.tag.destroy();
    this.chat.destroy();
  }
}
