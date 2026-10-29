import Phaser from 'phaser';
import { Anim, Indicator, PetLink, STEP_MS } from '@enu/protocol';
import { APP_TIMEZONE_DEFAULT, formatLocalHm } from '@enu/shared';
import type { PetSnap } from '../../realtime/types';
import { TEX } from '../assets';
import { petAnimKey, petDirection, toDir } from '../logic/direction';
import { petClusterOffset, petLook } from '../logic/petCluster';
import { TileInterpolator } from '../logic/interpolation';
import { EFFECT_FRAMES, PET_ORIGIN, type PetAnim, type PetDirection } from '../spriteSpec';
import { DEPTH, TILE_PX, tileCenterX, type Stage } from '../stage';
import { DueChip, PetSpeechBubble } from './SpeechBubble';

/** Pets trail one tile behind at ~1.1x the step time (see apps/realtime PetFollower). */
export const PET_STEP_MS = Math.round(STEP_MS * 1.1);
/** Pets hover: feet this many px above an avatar's ground line. */
const HOVER_FEET_IN_TILE = 24;
const SLEEP_FEET_IN_TILE = 28;
const NOT_LINKED_TINT = 0xc9c3d6;
/**
 * Depth lift over the feet line: furniture-top tiles (monitors) sort at their row's ground line minus 2
 * (WorldScene), i.e. 6 px under a hovering pet's feet; +8 keeps the pet in front of its own row's monitor
 * and still behind anyone standing on the row below.
 */
export const PET_DEPTH_LIFT = 8;

export function bubbleDisplayFallbackMs(text: string): number {
  return Math.min(15_000, Math.max(6_000, 5_000 + 70 * [...text].length));
}

export interface PetBubbleClick {
  bubbleId: string;
  pointer: Phaser.Input.Pointer;
}

/**
 * A fairy pet: hover idle with a gentle bob, hop while following, sleep with "zzz" when its
 * owner's Claude is not linked, a clock icon when stale. For the owner only, the Claude-authored
 * bubble and a separate due-time chip; for everyone else at most an animated "…" icon.
 */
export class PetView {
  readonly ownerId: string;
  readonly petId: string;
  readonly isMine: boolean;
  readonly interp: TileInterpolator;
  private readonly root: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly bubble: PetSpeechBubble | null;
  private readonly chip: DueChip | null;
  /** Texture look (`petLook`): the species, plus the tint when it is not base. */
  private look = '';
  private offset = { dx: 0, dy: 0 };
  private lastHorizontal: PetDirection = 'right';
  private snap: PetSnap;
  private bubbleShownId = '';
  private bubbleHideAt = 0;
  private seenSent = '';
  private feetX = 0;
  private feetY = 0;
  private readonly phase = Math.random() * Math.PI * 2;
  private readonly onBubbleSeen: (bubbleId: string) => void;
  private ownerFeetX: number | null = null;
  /** Office time zone (MeDto.officeTimeZone) for the due chip. */
  timeZone: string = APP_TIMEZONE_DEFAULT;

  constructor(
    private readonly stage: Stage,
    snap: PetSnap,
    isMine: boolean,
    handlers: {
      onPetClick: (view: PetView, pointer: Phaser.Input.Pointer) => void;
      onBubbleClick: (click: PetBubbleClick) => void;
      onBubbleSeen: (bubbleId: string) => void;
    },
  ) {
    const scene = stage.scene;
    this.ownerId = snap.ownerId;
    this.petId = snap.petId;
    this.isMine = isMine;
    this.offset = petClusterOffset(snap.slot);
    this.snap = snap;
    this.onBubbleSeen = handlers.onBubbleSeen;
    this.interp = new TileInterpolator(snap.x, snap.y, toDir(snap.dir), PET_STEP_MS);
    if (snap.dir === 1) this.lastHorizontal = 'left';

    this.shadow = scene.add.image(0, 1, TEX.effects, EFFECT_FRAMES.shadowSmall).setAlpha(0.7);
    this.sprite = scene.add.sprite(0, 0, '__MISSING').setOrigin(PET_ORIGIN.x, PET_ORIGIN.y).setVisible(false);
    this.icon = scene.add.image(0, -26, TEX.effects, EFFECT_FRAMES.zzz).setVisible(false);
    this.root = stage.world(scene.add.container(0, 0, [this.shadow, this.sprite, this.icon]));

    if (isMine) {
      this.sprite.setInteractive(new Phaser.Geom.Rectangle(2, 2, 20, 21), Phaser.Geom.Rectangle.Contains);
      if (this.sprite.input) this.sprite.input.cursor = 'pointer';
      this.sprite.on(
        'pointerdown',
        (pointer: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
          ev.stopPropagation();
          handlers.onPetClick(this, pointer);
        },
      );
      this.bubble = new PetSpeechBubble(stage, (pointer) => {
        if (this.bubbleShownId) handlers.onBubbleClick({ bubbleId: this.bubbleShownId, pointer });
      });
      this.chip = new DueChip(stage);
    } else {
      this.bubble = null;
      this.chip = null;
    }
    this.setLook(petLook(snap.species, snap.tint));
  }

  /** Switches to a look's sheet; `force` re-applies it once a sheet loaded on demand is ready. */
  setLook(look: string, force = false): void {
    if (look === this.look && !force) return;
    this.look = look;
    const tex = TEX.pet(look);
    if (this.stage.scene.textures.exists(tex)) {
      this.sprite.setTexture(tex, 0).setVisible(true);
      this.sprite.anims.stop();
    }
  }

  get currentLook(): string {
    return this.look;
  }

  /** Latest synced snapshot of this pet. */
  apply(snap: PetSnap, now: number): void {
    const prev = this.snap;
    this.snap = snap;
    if (snap.species !== prev.species || snap.tint !== prev.tint)
      this.setLook(petLook(snap.species, snap.tint));
    if (snap.slot !== prev.slot) this.offset = petClusterOffset(snap.slot);
    if (snap.x !== prev.x || snap.y !== prev.y) this.interp.push(snap.x, snap.y);
    if (this.bubble) this.syncBubble(now);
  }

  /**
   * Pets of hidden owners perch at their desk (server); a hidden owner without a desk has nowhere to
   * perch, so the client hides the pet (spec §5.7).
   */
  setHidden(hidden: boolean): void {
    if (this.root.visible === !hidden) return;
    this.root.setVisible(!hidden);
    if (hidden) this.hideBubble(false);
  }

  get hidden(): boolean {
    return !this.root.visible;
  }

  /** Where the owner stands (world px), so the bubble can lean away from their name tag. */
  setOwnerFeet(x: number | null): void {
    this.ownerFeetX = x;
  }

  get feet(): { x: number; y: number } {
    return { x: this.feetX, y: this.feetY };
  }

  /** Current bubble (owner only): id + verbatim text, or null. */
  get activeBubble(): { bubbleId: string; text: string; kind: number; dueAt: number } | null {
    if (!this.bubble?.visible || !this.bubbleShownId) return null;
    return {
      bubbleId: this.bubbleShownId,
      text: this.snap.bubbleText,
      kind: this.snap.bubbleKind,
      dueAt: this.snap.bubbleDueAt,
    };
  }

  private syncBubble(now: number): void {
    const s = this.snap;
    if (!this.bubble || !this.chip) return;
    if (!s.bubbleText || !s.bubbleId) {
      this.hideBubble();
      return;
    }
    if (s.bubbleId !== this.bubbleShownId) {
      // Server clocks can differ from ours: trust bubbleUntil only when it looks sane.
      const remaining = s.bubbleUntil > 0 ? s.bubbleUntil - Date.now() : 0;
      const duration =
        remaining > 1500 && remaining <= 20_000 ? remaining : bubbleDisplayFallbackMs(s.bubbleText);
      this.bubbleShownId = s.bubbleId;
      this.bubbleHideAt = now + duration;
    }
    if (now >= this.bubbleHideAt || !this.root.visible) {
      this.hideBubble(false);
      return;
    }
    this.bubble.show(s.bubbleText);
    if (s.bubbleDueAt > 0) this.chip.show(formatLocalHm(new Date(s.bubbleDueAt), this.timeZone));
    else this.chip.hide();
  }

  /** Hides the bubble locally right after the owner acted on it (until the server clears it). */
  dismissBubble(bubbleId: string): void {
    if (this.bubbleShownId === bubbleId) {
      this.bubbleHideAt = 0;
      this.hideBubble(false);
    }
  }

  private hideBubble(resetId = true): void {
    this.bubble?.hide();
    this.chip?.hide();
    if (resetId) this.bubbleShownId = '';
  }

  private chooseAnim(moving: boolean): PetAnim {
    if (moving) return 'hop';
    if (this.snap.anim === Anim.Sleep || this.snap.linkState === PetLink.NotLinked) return 'sleep';
    return 'idle';
  }

  update(now: number, tabVisible: boolean): void {
    const s = this.interp.update(now);
    const anim = this.chooseAnim(s.moving || this.snap.anim === Anim.Walk);
    const dir = petDirection(s.moving ? s.dir : this.snap.dir, this.lastHorizontal);
    this.lastHorizontal = dir;

    const sleeping = anim === 'sleep';
    const bob = anim === 'idle' ? Math.round(Math.sin(now / 420 + this.phase) * 1.5) : 0;
    this.feetX = Math.round(tileCenterX(s.x)) + this.offset.dx;
    this.feetY =
      Math.round(s.y * TILE_PX + (sleeping ? SLEEP_FEET_IN_TILE : HOVER_FEET_IN_TILE)) + this.offset.dy;
    this.root.setPosition(this.feetX, this.feetY + 4);
    // depth: pets fly, so they sit in front of everything on their own row, monitors included (a pet
    // perched on its hidden owner's desk is drawn in front of the monitor, not behind it)
    this.root.setDepth(DEPTH.entities + this.feetY + PET_DEPTH_LIFT);
    this.sprite.y = -4 + bob;
    this.shadow.y = 0;
    this.shadow.setScale(1 + (bob < 0 ? 0.08 * bob : 0), 1);

    if (this.sprite.visible) {
      const key = petAnimKey(this.look, dir, anim);
      if (this.sprite.anims.currentAnim?.key !== key && this.stage.scene.anims.exists(key)) {
        this.sprite.play(key, true);
      }
      if (this.snap.linkState === PetLink.NotLinked) this.sprite.setTint(NOT_LINKED_TINT);
      else this.sprite.clearTint();
    }

    // status icon above the pet (never text)
    let iconFrame: number | null = null;
    if (sleeping) iconFrame = EFFECT_FRAMES.zzz;
    else if (this.snap.linkState === PetLink.Stale) iconFrame = EFFECT_FRAMES.clock;
    else if (!this.isMine && this.snap.indicator === Indicator.Dots) iconFrame = EFFECT_FRAMES.dots;
    if (iconFrame === null) {
      this.icon.setVisible(false);
    } else {
      this.icon.setFrame(iconFrame).setVisible(true);
      const wobble = Math.sin(now / 300 + this.phase);
      if (iconFrame === EFFECT_FRAMES.dots) {
        this.icon.setPosition(0, -26 + Math.round(wobble)).setAlpha(0.75 + 0.25 * wobble);
      } else if (iconFrame === EFFECT_FRAMES.zzz) {
        this.icon
          .setPosition(9 + Math.round(wobble), -24 + Math.round(Math.sin(now / 600) * 2))
          .setAlpha(0.9);
      } else {
        this.icon.setPosition(10, -22).setAlpha(1);
      }
      this.icon.setScale(iconFrame === EFFECT_FRAMES.dots ? 1 : 0.75);
    }

    if (this.bubble && this.chip) {
      if (this.bubbleShownId && this.bubble.visible && now >= this.bubbleHideAt) {
        this.hideBubble(false);
        // Tell the server this bubble has run its course on screen (it then takes it down).
        if (tabVisible && this.seenSent !== this.bubbleShownId) {
          this.seenSent = this.bubbleShownId;
          this.onBubbleSeen(this.bubbleShownId);
        }
      }
      if (this.bubble.visible) {
        const head = this.stage.toScreen(this.feetX, this.feetY - 20 + bob);
        const dx = this.ownerFeetX === null ? 0 : this.ownerFeetX - this.feetX;
        this.bubble.update(head.x, head.y - 2, this.stage.viewWidth, dx > 6 ? 1 : dx < -6 ? -1 : 0);
        // System chip just below and beside the pet (never inside the bubble; clear of the owner's
        // name tag, which sits right under a pet hovering behind its owner).
        const below = this.stage.toScreen(this.feetX + 12, this.feetY - 6);
        this.chip.setPosition(below.x + Math.round(this.chip.width / 2) + 4, below.y);
      }
    }
  }

  destroy(): void {
    this.root.destroy();
    this.bubble?.destroy();
    this.chip?.destroy();
  }
}
