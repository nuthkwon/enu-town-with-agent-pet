import Phaser from 'phaser';
import { findPath, nearestWalkable, type OfficeWorld } from '@enu/map';
import { MAP_LAYERS } from '@enu/map';
import type { Dir } from '@enu/protocol';
import type { ChatMsg, EmoteMsg, MoveCorrectMsg } from '@enu/protocol';
import type { PetSnap, PlayerSnap } from '../../realtime/types';
import { AvatarSheetLoader, FX_SPARKLE_ANIM, TEX, ensurePetAnims } from '../assets';
import { BRIDGE_REGISTRY_KEY, FONT_REGISTRY_KEY, type GameBridge } from '../bridge';
import { teamColorNumber } from '../directory';
import { AvatarView } from '../entities/AvatarView';
import { DeskPlate } from '../entities/DeskPlate';
import { PetView, type PetBubbleClick } from '../entities/PetView';
import { PIXEL_FONT_SIZE } from '../font';
import { chooseZoom, smoothing, snapToScreenPixel, targetScroll } from '../logic/camera';
import { keyToDir, toDir } from '../logic/direction';
import { LocalMover, type Tile } from '../logic/movement';
import type { Measure } from '../logic/textLayout';
import { canvasMeasure } from '../measure';
import { EFFECT_FRAMES } from '../spriteSpec';
import { DEPTH, TILE_PX, avatarFeetY, tileCenterX, type Stage } from '../stage';
import { STATIC_AVATARS_REGISTRY_KEY } from './PreloadScene';

const CAMERA_LERP = 0.14;
const FOCUS_OTHER_MS = 2500;

function isEditable(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Movement keys only drive the avatar when focus is on the page/map, not inside overlays. */
function allowsMovementKeys(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target === document.body || target === document.documentElement) return true;
  if (isEditable(target)) return false;
  if (target.closest('[role="dialog"],[role="menu"],[role="listbox"],[role="tablist"],[data-town-keys="ui"]')) return false;
  return true;
}

/**
 * The office: tilemap layers, everyone's avatar and pet, desk name plates, local movement with
 * prediction, click-to-move, camera, and the screen-space overlay camera for tags/bubbles.
 */
export class WorldScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private officeWorld!: OfficeWorld;
  private mainCam!: Phaser.Cameras.Scene2D.Camera;
  private overlayCam!: Phaser.Cameras.Scene2D.Camera;
  private sheetLoader!: AvatarSheetLoader;
  private readonly avatars = new Map<string, AvatarView>();
  private readonly pets = new Map<string, PetView>();
  private readonly plates: DeskPlate[] = [];
  private mover: LocalMover | null = null;
  private readonly keysDown: Dir[] = [];
  private textFocused = false;
  private zoomBias = 0;
  private scrollX = 0;
  private scrollY = 0;
  private cameraPlaced = false;
  private focusOther: { userId: string; until: number } | null = null;
  private marker: Phaser.GameObjects.Sprite | null = null;
  private readonly offs: Array<() => void> = [];
  private platesDirty = true;

  private font = 'Galmuri11, sans-serif';
  private measure: Measure = (t) => t.length * PIXEL_FONT_SIZE;
  private zoom = 2;
  private viewWidth = 0;
  private viewHeight = 0;
  private stage!: Stage;

  constructor() {
    super({ key: 'world' });
  }

  /* ------------------------------------------------------------------ Stage */

  private world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.overlayCam.ignore(obj);
    return obj;
  }

  private overlay<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.mainCam.ignore(obj);
    return obj;
  }

  private toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: Math.round((wx - this.scrollX) * this.zoom), y: Math.round((wy - this.scrollY) * this.zoom) };
  }

  private makeStage(): Stage {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      scene: this,
      get font() {
        return self.font;
      },
      get measure() {
        return self.measure;
      },
      world: (obj) => self.world(obj),
      overlay: (obj) => self.overlay(obj),
      toScreen: (wx, wy) => self.toScreen(wx, wy),
      get zoom() {
        return self.zoom;
      },
      get viewWidth() {
        return self.viewWidth;
      },
      get viewHeight() {
        return self.viewHeight;
      },
    };
  }

  /* ------------------------------------------------------------------ setup */

  create(): void {
    this.bridge = this.registry.get(BRIDGE_REGISTRY_KEY) as GameBridge;
    this.officeWorld = this.bridge.map.world;
    this.font = (this.registry.get(FONT_REGISTRY_KEY) as string | undefined) ?? this.font;
    this.measure = canvasMeasure(`${PIXEL_FONT_SIZE}px ${this.font}`);
    const staticKeys = (this.registry.get(STATIC_AVATARS_REGISTRY_KEY) as Set<string> | undefined) ?? new Set();
    this.sheetLoader = new AvatarSheetLoader(this, staticKeys);

    // Keep Phaser's default camera origin (0.5): tilemap culling assumes it. We track the visible
    // world rectangle's top-left ourselves (scrollX/scrollY fields) and centre the camera on it.
    this.mainCam = this.cameras.main;
    this.mainCam.setBackgroundColor('rgba(0,0,0,0)');
    this.overlayCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'overlay');
    this.applyViewport(this.scale.width, this.scale.height);
    this.stage = this.makeStage();

    this.buildMap();
    this.buildPlates();
    this.marker = this.world(this.add.sprite(0, 0, TEX.effects, EFFECT_FRAMES.sparkle0).setVisible(false));
    this.marker.setDepth(DEPTH.entities - 1);

    this.bindInput();
    this.bindRealtime();
    this.bindBus();

    this.scale.on('resize', this.onResize, this);
    this.installDebugHook();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
    this.bridge.bus.emit('game:ready');
  }

  private onResize(size: Phaser.Structs.Size): void {
    this.applyViewport(size.width, size.height);
  }

  private applyViewport(w: number, h: number): void {
    this.viewWidth = Math.max(1, Math.round(w));
    this.viewHeight = Math.max(1, Math.round(h));
    this.zoom = chooseZoom(this.viewWidth, this.viewHeight, this.zoomBias);
    this.mainCam.setSize(this.viewWidth, this.viewHeight);
    this.mainCam.setZoom(this.zoom);
    this.overlayCam.setSize(this.viewWidth, this.viewHeight);
    this.cameraPlaced = false;
  }

  private buildMap(): void {
    const map = this.make.tilemap({ key: TEX.map });
    const tileset = map.addTilesetImage('office-tiles', TEX.tiles);
    if (!tileset) throw new Error('office tileset missing');
    const layers: Array<[string, number]> = [
      [MAP_LAYERS.floor, DEPTH.floor],
      [MAP_LAYERS.walls, DEPTH.walls],
      [MAP_LAYERS.furniture, DEPTH.furniture],
    ];
    for (const [name, depth] of layers) {
      const layer = map.createLayer(name, tileset, 0, 0);
      if (layer) this.world(layer.setDepth(depth));
    }
    // furniture-top (monitors): one image per tile, depth-sorted with people by its ground line.
    const top = map.getLayer(MAP_LAYERS.furnitureTop);
    if (top) {
      top.data.forEach((row, ty) =>
        row.forEach((tile, tx) => {
          if (!tile || tile.index < tileset.firstgid) return;
          const img = this.add.image(tx * TILE_PX, ty * TILE_PX, TEX.tiles, tile.index - tileset.firstgid);
          img.setOrigin(0, 0).setDepth(DEPTH.entities + (ty + 1) * TILE_PX - 2);
          this.world(img);
        }),
      );
    }
  }

  private buildPlates(): void {
    for (const desk of this.officeWorld.desks) this.plates.push(new DeskPlate(this.stage, desk));
    this.platesDirty = true;
  }

  private refreshPlates(): void {
    const { directory, session } = this.bridge;
    for (const plate of this.plates) {
      const d = directory.desk(plate.desk.deskId);
      const ownerId = d?.userId ?? null;
      const online = ownerId ? session.getPlayer(ownerId) !== undefined : false;
      plate.setOwner(d?.displayName ?? null, online);
    }
    this.platesDirty = false;
  }

  /* ------------------------------------------------------------------ realtime -> views */

  private bindRealtime(): void {
    const { session, directory } = this.bridge;
    this.offs.push(
      session.on('reset', () => this.clearEntities()),
      session.on('player:add', (p) => this.addAvatar(p)),
      session.on('player:change', ({ player, prev }) => this.changeAvatar(player, prev)),
      session.on('player:remove', (p) => this.removeAvatar(p.id)),
      session.on('pet:add', (p) => this.addPet(p)),
      session.on('pet:change', ({ pet }) => this.pets.get(pet.ownerId)?.apply(pet, this.time.now)),
      session.on('pet:remove', (p) => this.removePet(p.ownerId)),
      session.on('move:correct', (m) => this.onCorrect(m)),
      session.on('chat:msg', (m) => this.onChat(m)),
      session.on('emote', (m) => this.onEmote(m)),
      session.on('status', (s) => {
        if (s.kind !== 'connected') {
          this.keysDown.length = 0;
          this.mover?.hold(null);
          this.mover?.clearPath();
        }
      }),
      directory.on('change', () => {
        for (const [id, view] of this.avatars) {
          const person = directory.person(id);
          if (person) view.setTeamColor(teamColorNumber(person.team));
        }
        this.platesDirty = true;
      }),
    );
    for (const p of session.allPlayers()) this.addAvatar(p);
    for (const p of session.allPets()) this.addPet(p);
  }

  private clearEntities(): void {
    for (const v of this.avatars.values()) v.destroy();
    for (const v of this.pets.values()) v.destroy();
    this.avatars.clear();
    this.pets.clear();
    this.mover = null;
    this.platesDirty = true;
  }

  private addAvatar(p: PlayerSnap): void {
    if (this.avatars.has(p.id)) {
      this.changeAvatar(p, null);
      return;
    }
    const isMe = p.id === this.bridge.me.userId;
    const person = this.bridge.directory.person(p.id);
    const view = new AvatarView(
      this.stage,
      {
        userId: p.id,
        name: p.name || person?.displayName || '',
        x: p.x,
        y: p.y,
        dir: p.dir,
        status: p.status,
        teamColor: teamColorNumber(person?.team ?? null),
        isMe,
      },
      (v, pointer) => this.onAvatarClicked(v, pointer),
    );
    this.avatars.set(p.id, view);
    this.sheetLoader.request(p.avatar, () => view.setAvatarKey(p.avatar));
    if (isMe) {
      this.mover = new LocalMover(this.officeWorld, { x: p.x, y: p.y }, toDir(p.dir));
      this.cameraPlaced = false;
    }
    this.platesDirty = true;
  }

  private changeAvatar(p: PlayerSnap, prev: PlayerSnap | null): void {
    const view = this.avatars.get(p.id);
    if (!view) return;
    const now = this.time.now;
    if (!prev || prev.avatar !== p.avatar) this.sheetLoader.request(p.avatar, () => view.setAvatarKey(p.avatar));
    view.setName(p.name || this.bridge.directory.person(p.id)?.displayName || '');
    view.setStatus(p.status);
    if (view.isMe && this.mover) {
      if (this.mover.observeServer(p.x, p.y, now)) view.moveTo(p.x, p.y);
      return;
    }
    if (!prev || prev.x !== p.x || prev.y !== p.y) view.moveTo(p.x, p.y);
    view.setServerDir(p.dir);
  }

  private removeAvatar(id: string): void {
    this.avatars.get(id)?.destroy();
    this.avatars.delete(id);
    if (id === this.bridge.me.userId) this.mover = null;
    this.platesDirty = true;
  }

  private addPet(p: PetSnap): void {
    if (this.pets.has(p.ownerId)) {
      this.pets.get(p.ownerId)?.apply(p, this.time.now);
      return;
    }
    ensurePetAnims(this, p.species);
    const isMine = p.ownerId === this.bridge.me.userId;
    const view = new PetView(this.stage, p, isMine, {
      onPetClick: (_v, pointer) => this.bridge.bus.emit('pet:clicked', { screenX: pointer.x, screenY: pointer.y }),
      onBubbleClick: (c: PetBubbleClick) =>
        this.bridge.bus.emit('pet:bubble-clicked', {
          bubbleId: c.bubbleId,
          screenX: c.pointer.x,
          screenY: c.pointer.y,
        }),
      onBubbleSeen: (bubbleId) => this.bridge.session.bubbleSeen(bubbleId),
    });
    view.apply(p, this.time.now);
    this.pets.set(p.ownerId, view);
  }

  private removePet(ownerId: string): void {
    this.pets.get(ownerId)?.destroy();
    this.pets.delete(ownerId);
  }

  private onCorrect(m: MoveCorrectMsg): void {
    const me = this.avatars.get(this.bridge.me.userId);
    if (!this.mover || !me) return;
    this.mover.correct(m.x, m.y, this.time.now);
    me.moveTo(m.x, m.y);
  }

  private onChat(m: ChatMsg): void {
    const view = this.avatars.get(m.fromUserId);
    if (view && m.text) view.showChat(m.text, this.time.now);
  }

  private onEmote(m: EmoteMsg): void {
    const view = this.avatars.get(m.fromUserId);
    if (!view) return;
    const { x, y } = view.feet;
    for (let i = 0; i < 3; i++) {
      const heart = this.world(this.add.image(x + (i - 1) * 8, y - 30, TEX.effects, EFFECT_FRAMES.heart));
      heart.setDepth(DEPTH.entities + y + 1).setScale(0.6).setAlpha(0);
      this.tweens.add({
        targets: heart,
        y: y - 44 - i * 4,
        alpha: { from: 1, to: 0 },
        scale: { from: 0.4, to: 0.8 },
        delay: i * 120,
        duration: 900,
        ease: 'Sine.easeOut',
        onComplete: () => heart.destroy(),
      });
    }
  }

  /* ------------------------------------------------------------------ input */

  private bindInput(): void {
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (over.length > 0 || pointer.button !== 0) return;
        const wp = this.mainCam.getWorldPoint(pointer.x, pointer.y);
        this.onFloorClick(Math.floor(wp.x / TILE_PX), Math.floor(wp.y / TILE_PX), pointer);
      },
    );

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      if (this.textFocused || !allowsMovementKeys(e.target)) return;
      const dir = keyToDir(e.code) ?? keyToDir(e.key);
      if (dir === null) return;
      e.preventDefault();
      if (!this.keysDown.includes(dir)) this.keysDown.push(dir);
      this.mover?.hold(this.keysDown.at(-1) ?? null);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = keyToDir(e.code) ?? keyToDir(e.key);
      if (dir === null) return;
      const i = this.keysDown.indexOf(dir);
      if (i >= 0) this.keysDown.splice(i, 1);
      this.mover?.hold(this.keysDown.at(-1) ?? null);
    };
    const onBlur = () => {
      this.keysDown.length = 0;
      this.mover?.hold(null);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.offs.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  private bindBus(): void {
    const { bus } = this.bridge;
    this.offs.push(
      bus.on('ui:text-focus', ({ focused }) => {
        this.textFocused = focused;
        if (focused) {
          this.keysDown.length = 0;
          this.mover?.hold(null);
        }
      }),
      bus.on('move:to-user', ({ userId }) => this.walkToUser(userId)),
      bus.on('pet:bubble-hide', ({ bubbleId }) => this.pets.get(this.bridge.me.userId)?.dismissBubble(bubbleId)),
      bus.on('camera:focus-user', ({ userId }) => {
        this.focusOther = { userId, until: this.time.now + FOCUS_OTHER_MS };
      }),
      bus.on('camera:zoom', ({ delta }) => {
        this.zoomBias = delta === 0 ? 0 : Math.max(-2, Math.min(3, this.zoomBias + delta));
        this.applyViewport(this.viewWidth, this.viewHeight);
      }),
    );
  }

  private onAvatarClicked(view: AvatarView, pointer: Phaser.Input.Pointer): void {
    this.bridge.bus.emit('entity:clicked', {
      userId: view.userId,
      source: 'avatar',
      screenX: pointer.x,
      screenY: pointer.y,
    });
  }

  private onFloorClick(tx: number, ty: number, pointer: Phaser.Input.Pointer): void {
    const w = this.officeWorld;
    if (!w.inBounds(tx, ty)) return;
    const desk = w.deskAtTile(tx, ty);
    if (desk) {
      const ownerId = this.bridge.directory.desk(desk.deskId)?.userId ?? null;
      const ownerOnline = ownerId ? this.bridge.session.getPlayer(ownerId) !== undefined : false;
      if (ownerId && ownerId !== this.bridge.me.userId && !ownerOnline) {
        this.bridge.bus.emit('entity:clicked', {
          userId: ownerId,
          source: 'desk',
          screenX: pointer.x,
          screenY: pointer.y,
        });
        return;
      }
    }
    if (!this.mover || !this.bridge.session.connected) return;
    const target = w.isWalkable(tx, ty) ? { x: tx, y: ty } : nearestWalkable(w, tx, ty);
    if (!target) return;
    this.walkTo(target);
  }

  private walkTo(target: Tile): boolean {
    if (!this.mover) return false;
    const path = findPath(this.officeWorld, this.mover.pos, target, { maxNodes: 6000 });
    if (!path) {
      this.bridge.bus.emit('move:unreachable');
      return false;
    }
    this.keysDown.length = 0;
    this.mover.hold(null);
    this.mover.setPath(path);
    this.showMarker(target);
    return true;
  }

  private walkToUser(userId: string): void {
    if (!this.mover) return;
    const other = this.avatars.get(userId);
    let goal: Tile | null = other ? other.tile : null;
    if (!goal) {
      const deskId = this.bridge.directory.person(userId)?.deskId;
      goal = deskId ? this.officeWorld.seatOf(deskId) : null;
    }
    if (!goal) return;
    const from = this.mover.pos;
    let best: Tile[] | null = null;
    for (const [dx, dy] of [
      [0, 1],
      [-1, 0],
      [1, 0],
      [0, -1],
    ] as const) {
      const t = { x: goal.x + dx, y: goal.y + dy };
      if (!this.officeWorld.isWalkable(t.x, t.y)) continue;
      const path = findPath(this.officeWorld, from, t, { maxNodes: 6000 });
      if (path && (!best || path.length < best.length)) best = path;
    }
    if (!best) {
      this.bridge.bus.emit('move:unreachable');
      return;
    }
    this.keysDown.length = 0;
    this.mover.hold(null);
    this.mover.setPath(best);
    const last = best.at(-1);
    if (last) this.showMarker(last);
  }

  private showMarker(t: Tile): void {
    const m = this.marker;
    if (!m) return;
    m.setPosition(tileCenterX(t.x), avatarFeetY(t.y) - 6).setVisible(true).setAlpha(1);
    if (this.anims.exists(FX_SPARKLE_ANIM)) {
      m.play(FX_SPARKLE_ANIM);
      m.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => m.setVisible(false));
    } else {
      this.time.delayedCall(400, () => m.setVisible(false));
    }
  }

  /* ------------------------------------------------------------------ loop */

  override update(time: number, delta: number): void {
    const now = time;
    const { session, me } = this.bridge;
    const myView = this.avatars.get(me.userId);

    if (this.mover && myView && session.connected) {
      const action = this.mover.update(now);
      if (action?.kind === 'step') {
        if (session.sendStep(action.seq, action.dir)) myView.moveTo(action.to.x, action.to.y);
        else this.mover.correct(action.from.x, action.from.y, now);
      } else if (action?.kind === 'face') {
        session.sendFace(action.dir);
        myView.interp.dir = action.dir;
      }
    }

    for (const v of this.avatars.values()) v.update(now);
    this.pets.get(me.userId)?.setOwnerFeet(myView ? myView.feet.x : null);
    const tabVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
    for (const v of this.pets.values()) v.update(now, tabVisible);

    this.updateCamera(now, delta, myView);
    if (this.platesDirty) this.refreshPlates();
    for (const plate of this.plates) plate.update();
  }

  private updateCamera(now: number, delta: number, myView: AvatarView | undefined): void {
    let focus: { x: number; y: number } | null = null;
    if (this.focusOther && now < this.focusOther.until) {
      const other = this.avatars.get(this.focusOther.userId);
      if (other) focus = other.feet;
    } else {
      this.focusOther = null;
    }
    if (!focus && myView) focus = { x: myView.feet.x, y: myView.feet.y - 12 };
    if (!focus) {
      const seat = this.bridge.me.deskId ? this.officeWorld.seatOf(this.bridge.me.deskId) : null;
      focus = seat
        ? { x: tileCenterX(seat.x), y: avatarFeetY(seat.y) }
        : { x: (this.officeWorld.width * TILE_PX) / 2, y: (this.officeWorld.height * TILE_PX) / 2 };
    }
    const viewW = this.viewWidth / this.zoom;
    const viewH = this.viewHeight / this.zoom;
    const tx = targetScroll(focus.x, viewW, this.officeWorld.width * TILE_PX);
    const ty = targetScroll(focus.y, viewH, this.officeWorld.height * TILE_PX);
    if (!this.cameraPlaced) {
      this.scrollX = tx;
      this.scrollY = ty;
      this.cameraPlaced = true;
    } else {
      const k = smoothing(CAMERA_LERP, delta);
      this.scrollX += (tx - this.scrollX) * k;
      this.scrollY += (ty - this.scrollY) * k;
      if (Math.abs(tx - this.scrollX) < 0.02) this.scrollX = tx;
      if (Math.abs(ty - this.scrollY) < 0.02) this.scrollY = ty;
    }
    this.scrollX = snapToScreenPixel(this.scrollX, this.zoom);
    this.scrollY = snapToScreenPixel(this.scrollY, this.zoom);
    // centerOn() with origin 0.5: the visible rect's top-left lands exactly on (scrollX, scrollY).
    this.mainCam.centerOn(this.scrollX + viewW / 2, this.scrollY + viewH / 2);
  }

  /**
   * Development/e2e only: lets tests find canvas positions (avatars, pets, desks) without pixel
   * guessing. Never installed in production builds.
   */
  private installDebugHook(): void {
    if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return;
    const hook = {
      avatarScreen: (userId: string) => {
        const v = this.avatars.get(userId);
        return v ? this.toScreen(v.feet.x, v.feet.y - 14) : null;
      },
      petScreen: (ownerId: string) => {
        const v = this.pets.get(ownerId);
        return v ? this.toScreen(v.feet.x, v.feet.y - 6) : null;
      },
      tileScreen: (tx: number, ty: number) => this.toScreen(tileCenterX(tx), ty * TILE_PX + TILE_PX / 2),
      myTile: () => (this.mover ? { ...this.mover.pos } : null),
      zoom: () => this.zoom,
      avatarCount: () => this.avatars.size,
      petBubble: () => this.pets.get(this.bridge.me.userId)?.activeBubble ?? null,
    };
    (window as unknown as { __ENU_TOWN_DEBUG__?: typeof hook }).__ENU_TOWN_DEBUG__ = hook;
    this.offs.push(() => {
      const w = window as unknown as { __ENU_TOWN_DEBUG__?: typeof hook };
      if (w.__ENU_TOWN_DEBUG__ === hook) delete w.__ENU_TOWN_DEBUG__;
    });
  }

  private teardown(): void {
    for (const off of this.offs.splice(0)) off();
    this.scale.off('resize', this.onResize, this);
    this.clearEntities();
    for (const p of this.plates.splice(0)) p.destroy();
  }
}
