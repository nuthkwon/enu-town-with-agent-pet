import Phaser from 'phaser';
import { MAP_LAYERS, type DeskInfo, type OfficeWorld } from '@enu/map';
import { PlateNote, type ChatMsg, type DmMsg, type EmoteMsg } from '@enu/protocol';
import type { PetSnap, PlayerSnap } from '../../realtime/types';
import { AvatarSheetLoader, PetSheetLoader, TEX, ensurePetAnims } from '../assets';
import { BRIDGE_REGISTRY_KEY, FONT_REGISTRY_KEY, type GameBridge } from '../bridge';
import { teamColorNumber } from '../directory';
import { AvatarView } from '../entities/AvatarView';
import { DeskPlate, type PlateModel } from '../entities/DeskPlate';
import { Fx, type WorldPoint } from '../entities/Fx';
import { GroupLayer, type GroupDraw } from '../entities/GroupLayer';
import { PetView, type PetBubbleClick } from '../entities/PetView';
import { PIXEL_FONT_SIZE, SMALL_PIXEL_FONT, SMALL_PIXEL_FONT_SIZE } from '../font';
import {
  DEFAULT_INSETS,
  FOCUS_ZOOM,
  canPan,
  clampFocus,
  fitZoom,
  freeArea,
  overviewFocus,
  panBy,
  scrollFor,
  snapToScreenPixel,
  stepZoom,
  zoomAround,
  type FreeArea,
  type Insets,
  type Point,
} from '../logic/camera';
import { petLook } from '../logic/petCluster';
import { plateLayout } from '../logic/plates';
import { activityIcon, groupChipText, groupsOf, hiddenPlate, type GroupView } from '../logic/presence';
import { TAG_DEFAULT, declutterTags } from '../logic/tags';
import type { Measure } from '../logic/textLayout';
import { canvasMeasure } from '../measure';
import { EFFECT_FRAMES } from '../spriteSpec';
import { COLORS, DEPTH, TILE_PX, tileCenterX, type Stage } from '../stage';
import { STATIC_AVATARS_REGISTRY_KEY } from './PreloadScene';

/** A second click on the same avatar within this window runs `이 사람 보기` instead of the menu. */
const DOUBLE_CLICK_MS = 300;
const DRAG_THRESHOLD_PX = 4;
const ZOOM_TWEEN_MS = 170;
const VIEW_TWEEN_MS = 420;
const VIEW_PULSE_MS = 2000;
/** Wheel: one zoom step per this much accumulated deltaY (trackpads send many small deltas). */
const WHEEL_STEP = 60;
const WHEEL_COOLDOWN_MS = 110;
const EPS = 1e-6;

interface CameraAnim {
  fromZoom: number;
  toZoom: number;
  from: Point;
  to: Point;
  start: number;
  duration: number;
}

/**
 * The office as a live picture of the teams at work. Nobody steers an avatar: the server director
 * places every roster member, and this scene only draws the projected state (avatars, desk plates,
 * activity icons, groups, waves, the owner's own paper planes) and lets the viewer look around
 * (overview fit, zoom steps, drag-pan past the fit, `이 사람 보기`). It never follows anyone.
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
  private readonly plateByDesk = new Map<string, DeskPlate>();
  private groups!: GroupLayer;
  private fx!: Fx;
  private night!: Phaser.GameObjects.Rectangle;
  private meetingSeats = new Set<string>();
  /** Middle of the meeting table (the chip of a gathered meeting sits there, clear of everyone's tags). */
  private meetingCentre: WorldPoint | null = null;
  private groupViews: GroupView[] = [];
  private readonly offs: Array<() => void> = [];
  private dirty = true;
  private officeOpen: boolean | null = null;
  /** How many waves and paper planes this screen has drawn (read by the dev/e2e debug hook only). */
  private readonly fxDrawn = { wave: 0, plane: 0 };

  private font = 'Galmuri11, sans-serif';
  private measure: Measure = (t) => t.length * PIXEL_FONT_SIZE;
  private measureSmall: Measure = (t) => t.length * SMALL_PIXEL_FONT_SIZE;
  private viewWidth = 0;
  private viewHeight = 0;
  private stage!: Stage;

  // camera: (zoom, focus) where focus is the world point at the centre of the free area
  private insets: Insets = DEFAULT_INSETS;
  private free: FreeArea = { x: 0, y: 0, w: 1, h: 1 };
  private fit = 1;
  private zoom = 1;
  private focus: Point = overviewFocus();
  private targetZoom = 1;
  private targetFocus: Point = overviewFocus();
  private atFit = true;
  private anim: CameraAnim | null = null;
  private scrollX = 0;
  private scrollY = 0;
  private lastCameraKey = '';

  private drag: { x: number; y: number; focus: Point; moved: boolean } | null = null;
  private wheelAcc = 0;
  private wheelAt = 0;
  private lastClick: { userId: string; at: number } | null = null;
  private pulseUserId: string | null = null;
  private hoverPulsed: string | null = null;

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

  private toWorld(sx: number, sy: number): Point {
    return { x: this.scrollX + sx / this.zoom, y: this.scrollY + sy / this.zoom };
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
      get measureSmall() {
        return self.measureSmall;
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

  private get timeZone(): string {
    return this.bridge.me.officeTimeZone;
  }

  private get mapSize(): { w: number; h: number } {
    return { w: this.officeWorld.width * TILE_PX, h: this.officeWorld.height * TILE_PX };
  }

  /* ------------------------------------------------------------------ setup */

  create(): void {
    this.bridge = this.registry.get(BRIDGE_REGISTRY_KEY) as GameBridge;
    this.officeWorld = this.bridge.map.world;
    this.font = (this.registry.get(FONT_REGISTRY_KEY) as string | undefined) ?? this.font;
    this.measure = canvasMeasure(`${PIXEL_FONT_SIZE}px ${this.font}`);
    this.measureSmall = canvasMeasure(`${SMALL_PIXEL_FONT_SIZE}px ${SMALL_PIXEL_FONT}`);
    const staticKeys =
      (this.registry.get(STATIC_AVATARS_REGISTRY_KEY) as Set<string> | undefined) ?? new Set();
    this.sheetLoader = new AvatarSheetLoader(this, staticKeys);
    const seats = this.officeWorld.spots.meetingSeats;
    this.meetingSeats = new Set(seats.map((s) => `${s.x},${s.y}`));
    if (seats.length > 0) {
      const xs = seats.map((s) => s.x);
      const ys = seats.map((s) => s.y);
      this.meetingCentre = {
        x: ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * TILE_PX,
        y: ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * TILE_PX + 9,
      };
    }

    // Keep Phaser's default camera origin (0.5): tilemap culling assumes it. We track the visible
    // world rectangle's top-left ourselves (scrollX/scrollY fields) and centre the camera on it.
    this.mainCam = this.cameras.main;
    this.mainCam.setBackgroundColor('rgba(0,0,0,0)');
    this.overlayCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'overlay');
    this.stage = this.makeStage();
    this.applyViewport(this.scale.width, this.scale.height);

    this.buildMap();
    this.buildPlates();
    this.groups = new GroupLayer(this.stage, (groupId, pointer) =>
      this.bridge.bus.emit('group:clicked', { groupId, screenX: pointer.x, screenY: pointer.y }),
    );
    this.fx = new Fx(this.stage);
    const { w, h } = this.mapSize;
    this.night = this.world(this.add.rectangle(0, 0, w, h, COLORS.night, 0.4).setOrigin(0, 0));
    this.night.setDepth(DEPTH.night).setVisible(false).setAlpha(0);

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
    this.mainCam.setSize(this.viewWidth, this.viewHeight);
    this.overlayCam.setSize(this.viewWidth, this.viewHeight);
    this.refit();
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
    for (const desk of this.officeWorld.desks) {
      const plate = new DeskPlate(this.stage, desk, plateLayout(this.officeWorld, desk), {
        onClick: (d, pointer) => this.onDeskClicked(d.deskId, pointer),
        onHover: (d, pointer) => this.emitHover(d ? this.deskOwner(d.deskId) : null, pointer),
      });
      this.plates.push(plate);
      this.plateByDesk.set(desk.deskId, plate);
    }
    this.dirty = true;
  }

  /* ------------------------------------------------------------------ camera */

  /** Recomputes the fit for the current free area; keeps the overview when it was showing it. */
  private refit(): void {
    this.free = freeArea(this.viewWidth, this.viewHeight, this.insets);
    this.fit = fitZoom(this.free.w, this.free.h);
    if (this.atFit) this.setCamera(this.fit, overviewFocus(), 0);
    else this.setCamera(this.targetZoom, this.targetFocus, 0);
  }

  private setCamera(zoom: number, focus: Point, durationMs: number): void {
    const clamped = clampFocus(focus, zoom, this.fit, this.free, this.mapSize);
    this.targetZoom = zoom;
    this.targetFocus = clamped;
    this.atFit = Math.abs(zoom - this.fit) < EPS;
    if (durationMs <= 0) {
      this.anim = null;
      this.zoom = zoom;
      this.focus = clamped;
    } else {
      this.anim = {
        fromZoom: this.zoom,
        toZoom: zoom,
        from: { ...this.focus },
        to: clamped,
        start: this.time.now,
        duration: durationMs,
      };
    }
    this.input?.setDefaultCursor(canPan(zoom, this.fit) ? 'grab' : 'default');
    const key = `${zoom}|${this.fit}|${this.atFit}`;
    if (key !== this.lastCameraKey) {
      this.lastCameraKey = key;
      this.bridge?.bus.emit('camera:changed', { zoom, fit: this.fit, atFit: this.atFit });
    }
  }

  /** Wheel, the top-bar ± buttons and the keys: one step through the zoom list (0 = back to the fit). */
  private zoomBy(delta: number, anchor: Point | null): void {
    if (delta === 0) {
      this.setCamera(this.fit, overviewFocus(), ZOOM_TWEEN_MS + 60);
      return;
    }
    const next = stepZoom(this.targetZoom, delta, this.fit);
    if (Math.abs(next - this.targetZoom) < EPS) return;
    const a = anchor ?? { x: this.free.x + this.free.w / 2, y: this.free.y + this.free.h / 2 };
    const focus = zoomAround(this.targetFocus, this.targetZoom, next, a, this.free);
    this.setCamera(next, focus, ZOOM_TWEEN_MS);
  }

  /** `이 사람 보기`: zoom max(2, fit) centred on the person, with a 2 s pulse ring. No follow. */
  private viewUser(userId: string): void {
    const view = this.avatars.get(userId);
    if (!view?.isShown) return;
    const zoom = Math.max(FOCUS_ZOOM, this.fit);
    this.setCamera(zoom, view.chest, VIEW_TWEEN_MS);
    view.pulse(this.time.now, VIEW_PULSE_MS);
  }

  private updateCamera(now: number): void {
    const a = this.anim;
    if (a) {
      const t = Math.min(1, (now - a.start) / a.duration);
      const e = 1 - Math.pow(1 - t, 3);
      this.zoom = Math.exp(Math.log(a.fromZoom) + (Math.log(a.toZoom) - Math.log(a.fromZoom)) * e);
      this.focus = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e };
      if (t >= 1) {
        this.anim = null;
        this.zoom = a.toZoom;
        this.focus = a.to;
      }
    }
    const s = scrollFor(this.focus, this.zoom, this.free);
    this.scrollX = snapToScreenPixel(s.x, this.zoom);
    this.scrollY = snapToScreenPixel(s.y, this.zoom);
    this.mainCam.setZoom(this.zoom);
    // centerOn() with origin 0.5: the visible rect's top-left lands exactly on (scrollX, scrollY).
    this.mainCam.centerOn(
      this.scrollX + this.viewWidth / (2 * this.zoom),
      this.scrollY + this.viewHeight / (2 * this.zoom),
    );
  }

  /* ------------------------------------------------------------------ realtime -> views */

  private bindRealtime(): void {
    const { session, directory } = this.bridge;
    this.officeOpen = session.getOfficeOpen();
    this.offs.push(
      session.on('reset', () => this.clearEntities()),
      session.on('player:add', (p) => this.addAvatar(p)),
      session.on('player:change', ({ player, prev }) => this.changeAvatar(player, prev)),
      session.on('player:remove', (p) => this.removeAvatar(p.id)),
      session.on('pet:add', (p) => this.addPet(p)),
      session.on('pet:change', ({ pet }) => this.changePet(pet)),
      session.on('pet:remove', (p) => this.removePet(p.petId)),
      session.on('office', (open) => this.setOfficeOpen(open)),
      session.on('chat:msg', (m) => this.onChat(m)),
      session.on('emote', (m) => this.onEmote(m)),
      session.on('dm:msg', (m) => this.onDm(m)),
      directory.on('change', () => {
        for (const [id, view] of this.avatars) view.setTeamColor(this.teamColorOf(id));
        this.dirty = true;
      }),
    );
    for (const p of session.allPlayers()) this.addAvatar(p);
    for (const p of session.allPets()) this.addPet(p);
    this.setOfficeOpen(this.officeOpen);
  }

  private teamColorOf(userId: string): number {
    return teamColorNumber(this.bridge.directory.person(userId)?.team ?? null);
  }

  private setOfficeOpen(open: boolean | null): void {
    this.officeOpen = open;
    const closed = open === false;
    this.tweens.killTweensOf(this.night);
    if (closed) {
      this.night.setVisible(true);
      this.tweens.add({ targets: this.night, alpha: 1, duration: 600 });
    } else if (this.night.visible) {
      this.tweens.add({
        targets: this.night,
        alpha: 0,
        duration: 600,
        onComplete: () => this.night.setVisible(false),
      });
    }
    this.dirty = true;
  }

  private clearEntities(): void {
    for (const v of this.avatars.values()) v.destroy();
    for (const v of this.pets.values()) v.destroy();
    this.avatars.clear();
    this.pets.clear();
    this.hoverPulsed = null;
    this.officeOpen = null;
    if (this.night?.active) this.night.setVisible(false).setAlpha(0);
    this.dirty = true;
  }

  private addAvatar(p: PlayerSnap): void {
    const existing = this.avatars.get(p.id);
    if (existing) {
      this.changeAvatar(p, null);
      return;
    }
    const view = new AvatarView(
      this.stage,
      {
        userId: p.id,
        name: p.name || this.bridge.directory.person(p.id)?.displayName || '',
        x: p.x,
        y: p.y,
        dir: p.dir,
        teamColor: this.teamColorOf(p.id),
        isMe: p.id === this.bridge.me.userId,
      },
      {
        onClick: (v, pointer) => this.onAvatarClicked(v, pointer),
        onHover: (v, pointer) => this.emitHover(v ? v.userId : null, pointer),
      },
    );
    this.avatars.set(p.id, view);
    this.sheetLoader.request(p.avatar, () => view.setAvatarKey(p.avatar));
    view.setShown(p.shown, p.x, p.y, p.dir, false);
    this.dirty = true;
  }

  private changeAvatar(p: PlayerSnap, prev: PlayerSnap | null): void {
    const view = this.avatars.get(p.id);
    if (!view) return;
    if (!prev || prev.avatar !== p.avatar)
      this.sheetLoader.request(p.avatar, () => view.setAvatarKey(p.avatar));
    view.setName(p.name || this.bridge.directory.person(p.id)?.displayName || '');
    if (p.shown !== view.isShown) {
      if (!p.shown) this.fx.sparkle({ x: view.feet.x, y: view.feet.y - 10 });
      view.setShown(p.shown, p.x, p.y, p.dir, prev !== null);
      if (p.shown && prev !== null) this.fx.sparkle({ x: view.feet.x, y: view.feet.y - 10 });
    } else if (p.shown && (!prev || prev.x !== p.x || prev.y !== p.y)) {
      view.moveTo(p.x, p.y);
    }
    view.setServerDir(p.dir);
    if (prev && p.logPulse !== prev.logPulse && p.shown && this.officeOpen === true) {
      this.fx.logPulse({ x: view.feet.x, y: view.feet.y - 36 });
    }
    this.dirty = true;
  }

  private removeAvatar(id: string): void {
    this.avatars.get(id)?.destroy();
    this.avatars.delete(id);
    this.dirty = true;
  }

  /** Tinted looks are loaded on demand (base looks are preloaded). */
  private petSheets: PetSheetLoader | null = null;

  private ensureLook(p: PetSnap, view: PetView): void {
    const look = petLook(p.species, p.tint);
    if (look === p.species) {
      ensurePetAnims(this, look);
      return;
    }
    this.petSheets ??= new PetSheetLoader(this);
    this.petSheets.request(look, () => {
      if (this.pets.get(p.petId) === view && view.currentLook === look) view.setLook(look, true);
    });
  }

  private changePet(p: PetSnap): void {
    const view = this.pets.get(p.petId);
    if (!view) return;
    const before = view.currentLook;
    view.apply(p, this.time.now);
    if (view.currentLook !== before) this.ensureLook(p, view);
  }

  /** The owner's pet views, by slot. */
  private petViewsOf(ownerId: string): PetView[] {
    return [...this.pets.values()].filter((v) => v.ownerId === ownerId);
  }

  private addPet(p: PetSnap): void {
    if (this.pets.has(p.petId)) {
      this.changePet(p);
      return;
    }
    const isMine = p.ownerId === this.bridge.me.userId;
    const view = new PetView(this.stage, p, isMine, {
      onPetClick: (_v, pointer) =>
        this.bridge.bus.emit('pet:clicked', { screenX: pointer.x, screenY: pointer.y }),
      onBubbleClick: (c: PetBubbleClick) =>
        this.bridge.bus.emit('pet:bubble-clicked', {
          bubbleId: c.bubbleId,
          screenX: c.pointer.x,
          screenY: c.pointer.y,
        }),
      onBubbleSeen: (bubbleId) => this.bridge.session.bubbleSeen(bubbleId),
    });
    view.timeZone = this.timeZone;
    view.apply(p, this.time.now);
    this.pets.set(p.petId, view);
    this.ensureLook(p, view);
    this.dirty = true;
  }

  private removePet(petId: string): void {
    this.pets.get(petId)?.destroy();
    this.pets.delete(petId);
  }

  private onChat(m: ChatMsg): void {
    // Room chat keeps working after hours, but no bubble is drawn over anyone then.
    if (this.officeOpen !== true || !m.text) return;
    const view = this.avatars.get(m.fromUserId);
    if (view?.isShown) view.showChat(m.text, this.time.now);
  }

  /** A public wave: an arc from the sender to the target (the server checked both are shown). */
  private onEmote(m: EmoteMsg): void {
    if (m.kind !== 'wave' || this.officeOpen !== true) return;
    const from = this.avatars.get(m.fromUserId);
    const to = this.avatars.get(m.toUserId);
    if (!from?.isShown || !to?.isShown) return;
    this.fx.wave(from.chest, to.chest);
    this.fxDrawn.wave++;
  }

  /** DMs reach only their two participants, so the paper plane is drawn only on their screens. */
  private onDm(m: DmMsg): void {
    if (this.officeOpen !== true || m.fromUserId === m.toUserId) return;
    const from = this.anchorOf(m.fromUserId);
    const to = this.anchorOf(m.toUserId);
    if (from && to) {
      this.fx.plane(from, to);
      this.fxDrawn.plane++;
    }
  }

  /** Where someone is on the map: their avatar while shown, else their desk plate, else nowhere. */
  private anchorOf(userId: string): WorldPoint | null {
    const view = this.avatars.get(userId);
    if (view?.isShown) return view.chest;
    const deskId =
      this.bridge.session.getPlayer(userId)?.deskId || this.bridge.directory.person(userId)?.deskId;
    const plate = deskId ? this.plateByDesk.get(deskId) : undefined;
    return plate?.visible ? plate.worldAnchor : null;
  }

  /* ------------------------------------------------------------------ plates, presence, groups */

  /**
   * Who sits at a desk. The live state wins once it has arrived: every roster member is a Player and
   * `Player.deskId` follows `desks_changed`, so no Player on a desk means vacant. The REST desk list
   * (fetched once) only bridges the moment before the first state.
   */
  private deskOwner(deskId: string): string | null {
    let anyPlayer = false;
    for (const p of this.bridge.session.allPlayers()) {
      anyPlayer = true;
      if (p.deskId === deskId) return p.id;
    }
    if (anyPlayer) return null;
    return this.bridge.directory.desk(deskId)?.userId ?? null;
  }

  private atOwnSeat(p: PlayerSnap): boolean {
    const desk = p.deskId ? this.officeWorld.deskById(p.deskId) : null;
    return desk !== null && p.x === desk.seatX && p.y === desk.seatY;
  }

  /** Re-derives plates, avatar overlays and pet visibility from the projected Player fields. */
  private refresh(): void {
    const { directory, session, me } = this.bridge;
    for (const plate of this.plates) {
      const ownerId = this.deskOwner(plate.desk.deskId);
      if (!ownerId) {
        plate.set({ kind: 'vacant' });
        continue;
      }
      const player = session.getPlayer(ownerId);
      const name =
        player?.name ||
        directory.person(ownerId)?.displayName ||
        directory.desk(plate.desk.deskId)?.displayName ||
        '';
      const base = { name, teamColor: this.teamColorOf(ownerId), isMe: ownerId === me.userId };
      let model: PlateModel;
      if (player?.shown) {
        model = {
          kind: this.atOwnSeat(player) ? 'seated' : 'elsewhere',
          ...base,
          online: player.online,
          plate: null,
        };
      } else {
        model = {
          kind: 'hidden',
          ...base,
          online: false,
          plate: player ? hiddenPlate(player, this.timeZone) : null,
        };
      }
      plate.set(model);
    }
    this.groupViews = groupsOf(session.allPlayers());
    // In a gathered meeting the chip on the table already says 회의 중: no headset over every head.
    const seated = new Set<string>();
    for (const g of this.groupViews) {
      if (
        g.family === 'meeting' &&
        g.members.every((m) => m.shown && this.meetingSeats.has(`${m.x},${m.y}`))
      ) {
        for (const m of g.members) seated.add(m.id);
      }
    }
    for (const [id, view] of this.avatars) {
      const p = session.getPlayer(id);
      if (!p) continue;
      const icon = p.note === PlateNote.None && !seated.has(id) ? activityIcon(p.activity) : null;
      view.setPresence({
        online: p.online,
        iconFrame: icon ? EFFECT_FRAMES[icon] : null,
        atDesk: this.atOwnSeat(p),
      });
    }
    for (const pet of this.pets.values()) {
      const owner = session.getPlayer(pet.ownerId);
      pet.setHidden(!owner || (!owner.shown && !owner.deskId));
    }
    this.applyPulse();
    this.dirty = false;
  }

  private groupDraws(): GroupDraw[] {
    const out: GroupDraw[] = [];
    for (const g of this.groupViews) {
      const points: WorldPoint[] = [];
      for (const m of g.members) {
        const p = this.anchorOf(m.id);
        if (p) points.push(p);
      }
      const allShown = g.members.every((m) => m.shown);
      let gathered = false;
      if (g.family === 'meeting') {
        gathered = allShown && g.members.every((m) => this.meetingSeats.has(`${m.x},${m.y}`));
      } else if (allShown) {
        let far = 0;
        for (const a of g.members)
          for (const b of g.members) far = Math.max(far, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
        gathered = far <= 3;
      }
      // Gathered meeting: the chip sits on the table; same work at a desk: under the pair's feet.
      let chipAt: WorldPoint | null = null;
      if (gathered && g.family === 'meeting') chipAt = this.meetingCentre;
      else if (gathered) {
        const feet = g.members.map((m) => this.avatars.get(m.id)?.feet).filter((f): f is WorldPoint => !!f);
        if (feet.length > 0) {
          chipAt = {
            x: feet.reduce((sum, f) => sum + f.x, 0) / feet.length,
            y: Math.max(...feet.map((f) => f.y)) + 6 + 18 / this.zoom,
          };
        }
      }
      out.push({
        id: g.id,
        family: g.family,
        gathered,
        points,
        chipAt,
        chipText: groupChipText(g, this.timeZone),
        teamColors: g.members.map((m) => this.teamColorOf(m.id)),
      });
    }
    return out;
  }

  /**
   * Team-rail hover: pulse the avatar while the row is hovered, or highlight the desk plate of someone
   * who is not drawn. Only the hover pulse is stopped here (a running `이 사람 보기` pulse finishes).
   */
  private applyPulse(): void {
    const id = this.pulseUserId;
    if (this.hoverPulsed && this.hoverPulsed !== id) {
      this.avatars.get(this.hoverPulsed)?.stopPulse();
      this.hoverPulsed = null;
    }
    const view = id ? this.avatars.get(id) : undefined;
    const shown = view?.isShown === true;
    if (id && view && shown && this.hoverPulsed !== id) {
      view.pulse(this.time.now, 60 * 60 * 1000);
      this.hoverPulsed = id;
    }
    const deskId = id
      ? this.bridge.session.getPlayer(id)?.deskId || this.bridge.directory.person(id)?.deskId
      : null;
    for (const plate of this.plates) plate.setHighlight(!shown && !!deskId && deskId === plate.desk.deskId);
  }

  /* ------------------------------------------------------------------ input (looking only) */

  private bindInput(): void {
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;

    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
        if (pointer.button !== 0 || over.length > 0) return;
        this.drag = { x: pointer.x, y: pointer.y, focus: { ...this.targetFocus }, moved: false };
      },
    );
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (!d || !pointer.isDown) return;
      const dx = pointer.x - d.x;
      const dy = pointer.y - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      if (!canPan(this.targetZoom, this.fit)) return;
      this.input.setDefaultCursor('grabbing');
      this.setCamera(this.targetZoom, panBy(d.focus, dx, dy, this.targetZoom), 0);
    });
    const endDrag = (pointer: Phaser.Input.Pointer, click: boolean) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      this.input.setDefaultCursor(canPan(this.targetZoom, this.fit) ? 'grab' : 'default');
      if (click && !d.moved) this.onFloorClick(pointer);
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => endDrag(pointer, true));
    // The game ignores window input events (createGame), so a drag released outside the canvas (over a
    // panel or outside the window) is ended here instead of by POINTER_UP_OUTSIDE.
    const onWindowUp = (e: PointerEvent) => {
      if (e.target !== canvas && this.drag) endDrag(this.input.activePointer, false);
    };
    window.addEventListener('pointerup', onWindowUp);
    this.offs.push(() => window.removeEventListener('pointerup', onWindowUp));
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        const now = this.time.now;
        this.wheelAcc += dy;
        if (Math.abs(this.wheelAcc) < WHEEL_STEP || now - this.wheelAt < WHEEL_COOLDOWN_MS) return;
        const delta = this.wheelAcc < 0 ? 1 : -1;
        this.wheelAcc = 0;
        this.wheelAt = now;
        this.zoomBy(delta, { x: pointer.x, y: pointer.y });
      },
    );

    // Keys only while the canvas has focus, and they never move anyone (spec §5.2).
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      switch (e.key) {
        case '+':
        case '=':
          this.zoomBy(1, null);
          break;
        case '-':
        case '_':
          this.zoomBy(-1, null);
          break;
        case '0':
        case 'Escape':
          this.zoomBy(0, null);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    canvas.addEventListener('keydown', onKey);
    this.offs.push(() => canvas.removeEventListener('keydown', onKey));
  }

  private bindBus(): void {
    const { bus } = this.bridge;
    this.offs.push(
      bus.on('pet:bubble-hide', ({ bubbleId }) => {
        for (const v of this.petViewsOf(this.bridge.me.userId)) v.dismissBubble(bubbleId);
      }),
      bus.on('camera:view-user', ({ userId }) => this.viewUser(userId)),
      bus.on('camera:zoom', ({ delta }) => this.zoomBy(delta, null)),
      bus.on('camera:insets', (insets) => {
        this.insets = insets;
        this.refit();
      }),
      bus.on('person:pulse', ({ userId }) => {
        this.pulseUserId = userId;
        this.applyPulse();
      }),
    );
  }

  private emitHover(userId: string | null, pointer: Phaser.Input.Pointer): void {
    this.bridge.bus.emit('entity:hover', { userId, screenX: pointer.x, screenY: pointer.y });
  }

  private onAvatarClicked(view: AvatarView, pointer: Phaser.Input.Pointer): void {
    const now = this.time.now;
    const last = this.lastClick;
    if (last && last.userId === view.userId && now - last.at <= DOUBLE_CLICK_MS) {
      this.lastClick = null;
      this.bridge.bus.emit('entity:view', { userId: view.userId });
      this.viewUser(view.userId);
      return;
    }
    this.lastClick = { userId: view.userId, at: now };
    this.bridge.bus.emit('entity:clicked', {
      userId: view.userId,
      source: 'avatar',
      screenX: pointer.x,
      screenY: pointer.y,
    });
  }

  /** Desk clicks resolve desk -> roster member (whether or not that member is drawn). */
  private onDeskClicked(deskId: string, pointer: Phaser.Input.Pointer): void {
    const ownerId = this.deskOwner(deskId);
    if (!ownerId) return;
    this.bridge.bus.emit('entity:clicked', {
      userId: ownerId,
      source: 'desk',
      screenX: pointer.x,
      screenY: pointer.y,
    });
  }

  /** A click on the floor: a group link opens the group popover, a desk its member's menu, else nothing. */
  private onFloorClick(pointer: Phaser.Input.Pointer): void {
    const wp = this.toWorld(pointer.x, pointer.y);
    const groupId = this.groups.linkAt(wp, 6 / this.zoom + 2);
    if (groupId) {
      this.bridge.bus.emit('group:clicked', { groupId, screenX: pointer.x, screenY: pointer.y });
      return;
    }
    const tx = Math.floor(wp.x / TILE_PX);
    const ty = Math.floor(wp.y / TILE_PX);
    if (!this.officeWorld.inBounds(tx, ty)) return;
    const desk: DeskInfo | null = this.officeWorld.deskAtTile(tx, ty);
    if (desk) this.onDeskClicked(desk.deskId, pointer);
  }

  /* ------------------------------------------------------------------ loop */

  override update(time: number): void {
    const now = time;
    this.updateCamera(now);
    if (this.dirty) this.refresh();

    for (const v of this.avatars.values()) v.update(now);
    this.layoutOverlays(now);

    const myView = this.avatars.get(this.bridge.me.userId);
    for (const v of this.petViewsOf(this.bridge.me.userId))
      v.setOwnerFeet(myView?.isShown ? myView.feet.x : null);
    const tabVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
    for (const v of this.pets.values()) v.update(now, tabVisible);

    for (const plate of this.plates) plate.update();
    this.groups.update(this.officeOpen === false ? [] : this.groupDraws());
  }

  /** Floating tags never stack on top of each other (logic/tags.ts: alternate under the feet, then up). */
  private layoutOverlays(now: number): void {
    const placements = declutterTags(
      [...this.avatars.values()]
        .filter((v) => v.wantsTag)
        .map((v) => ({
          id: v.userId,
          isMe: v.isMe,
          feetX: v.feet.x,
          feetY: v.feet.y,
          above: v.tagRect(),
          below: v.tagRectBelow(),
        })),
    );
    const chatAllowed = this.officeOpen === true;
    for (const v of this.avatars.values())
      v.placeOverlays(now, placements.get(v.userId) ?? TAG_DEFAULT, chatAllowed);
  }

  /**
   * Development/e2e only: lets tests find canvas positions (avatars, pets, desks) and the camera
   * state without pixel guessing. Never installed in production builds.
   */
  private installDebugHook(): void {
    if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return;
    const hook = {
      avatarScreen: (userId: string) => {
        const v = this.avatars.get(userId);
        return v?.isShown ? this.toScreen(v.feet.x, v.feet.y - 14) : null;
      },
      /** The owner's default pet (slot 0) on screen. */
      petScreen: (ownerId: string) => {
        const id = this.bridge.session.petsOf(ownerId)[0]?.petId;
        const v = id ? this.pets.get(id) : undefined;
        return v && !v.hidden ? this.toScreen(v.feet.x, v.feet.y - 6) : null;
      },
      tileScreen: (tx: number, ty: number) => this.toScreen(tileCenterX(tx), ty * TILE_PX + TILE_PX / 2),
      /** The tile the server director placed someone on, or null while they are not drawn. */
      playerTile: (userId: string) => {
        const p = this.bridge.session.getPlayer(userId);
        return p?.shown ? { x: p.x, y: p.y } : null;
      },
      /** The projected Player fields this screen received (null for someone not on the roster). */
      playerState: (userId: string) => {
        const p = this.bridge.session.getPlayer(userId);
        if (!p) return null;
        const { shown, online, activity, source, until, note, groupId, statusText, deskId } = p;
        return { shown, online, activity, source, until, note, groupId, statusText, deskId };
      },
      /** A desk plate as drawn: its kind, its text lines and whether the owner's online dot is on. */
      plate: (deskId: string) => {
        const plate = this.plateByDesk.get(deskId);
        return plate ? { kind: plate.kind, lines: plate.textLines, online: plate.online } : null;
      },
      /** Waves and paper planes drawn on this screen so far. */
      fxDrawn: () => ({ ...this.fxDrawn }),
      /** Screen rectangles of the visible desk plates (CSS px inside the canvas). */
      plateRects: () =>
        this.plates.flatMap((p) => {
          const r = p.rect;
          return r ? [{ deskId: p.desk.deskId, ...r }] : [];
        }),
      plateScreen: (deskId: string) => {
        const r = this.plateByDesk.get(deskId)?.rect;
        return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
      },
      zoom: () => this.targetZoom,
      fitZoom: () => this.fit,
      officeOpen: () => this.officeOpen,
      avatarCount: () => [...this.avatars.values()].filter((v) => v.isShown).length,
      /** My own pet's bubble as drawn on the canvas (null while none is visible). */
      petBubble: () =>
        this.petViewsOf(this.bridge.me.userId)
          .map((v) => v.activeBubble)
          .find((b) => b !== null) ?? null,
      /** Someone's pet as this client decoded it (bubble fields are '' / 0 for everyone but the owner). */
      petState: (ownerId: string) => {
        const p = this.bridge.session.getPet(ownerId);
        if (!p) return null;
        const { bubbleId, bubbleText, bubbleUntil, indicator } = p;
        return { bubbleId, bubbleText, bubbleUntil, indicator };
      },
      /** Every pet of the owner as this client decoded it, by slot (looks and slots only, plus owner-only bubbles). */
      petsOf: (ownerId: string) =>
        this.bridge.session.petsOf(ownerId).map((p) => ({
          petId: p.petId,
          slot: p.slot,
          species: p.species,
          tint: p.tint,
          name: p.name,
          bubbleText: p.bubbleText,
        })),
    };
    (window as unknown as { __ENU_DEN_DEBUG__?: typeof hook }).__ENU_DEN_DEBUG__ = hook;
    this.offs.push(() => {
      const w = window as unknown as { __ENU_DEN_DEBUG__?: typeof hook };
      if (w.__ENU_DEN_DEBUG__ === hook) delete w.__ENU_DEN_DEBUG__;
    });
  }

  private teardown(): void {
    for (const off of this.offs.splice(0)) off();
    this.scale.off('resize', this.onResize, this);
    this.clearEntities();
    for (const p of this.plates.splice(0)) p.destroy();
    this.plateByDesk.clear();
    this.groups?.destroy();
  }
}
