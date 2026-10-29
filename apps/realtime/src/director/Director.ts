import {
  ANY_COLLEAGUE,
  NEUTRAL_PROJECTION,
  canShareActivity,
  canShowLive,
  canViewLog,
  groupPeople,
  isOfficeOpen,
  projectForColleagues,
  resolveActivity,
  type ActivityGroup,
  type ActivityInputs,
  type ColleagueProjection,
  type LogVisibilityFields,
  type ResolvedActivity,
} from '@enu/domain';
import {
  allocateSpots,
  type AllocatedSpot,
  type OfficeWorld,
  type Point,
  type Spot,
  type SpotIntent,
} from '@enu/map';
import {
  Anim,
  Indicator,
  Pet,
  Player,
  facingToDir,
  linkStateToCode,
  type Dir,
  type OfficeState,
} from '@enu/protocol';
import { DESK_IDS, LIMITS, TOWN_TIMING, localDateKey, type LinkState, type ManualStatus } from '@enu/shared';
import { PetFollower, type PerchTarget } from '../world/PetFollower';
import { dirBetween } from '../world/Movement';
import { activityCode, plateNoteCode, sourceCode } from './codes';
import { Walker } from './Walker';

/**
 * The server director: places every roster member (one `Player` and their pets, connected or not)
 * from their own signals only. Nobody steers an avatar. Every decision is made by the pure domain
 * functions (`resolveActivity`, `projectForColleagues`, `groupPeople`) and the map helpers
 * (`allocateSpots`, `findPath`); this class only binds them to the synced state.
 * No I/O, no clock reads, no randomness: `now` (business time) and `nowMs` (monotonic) are arguments,
 * and actors are visited in a fixed order, so the same inputs always give the same state.
 */

/** `held`: the 20 s onDrop hold (live, not connected); `ended`: the 60 s live grace starts. */
export type SessionState = 'open' | 'held' | 'ended';

export interface ManualIn {
  status: ManualStatus;
  until: Date;
}

/** One of a member's pets in the town; its index in `ActorSnapshot.pets` is its slot (0 = the default pet). */
export interface TownPetSnap {
  petId: string;
  species: string;
  name: string;
  /** PetTint ('base' for the default pet). */
  tint: string;
}

/** One roster member as loaded from the DB (`infra/roster.ts`). */
export interface ActorSnapshot {
  userId: string;
  displayName: string;
  avatarKey: string;
  deskId: string | null;
  /** The default pet first, then the others in the owner's order (at most LIMITS.petsPerOwnerMax). */
  pets: TownPetSnap[];
  linkState: LinkState;
  /** 상태 문구 ('' if none). */
  statusText: string;
  shareActivity: boolean | null;
  showLive: boolean;
  manual: ManualIn | null;
}

/** Today's (office day) work log: visibility fields and whether a task was worked on. Never its text. */
export interface TodayLogSignal {
  log: LogVisibilityFields;
  hasWorkTask: boolean;
}

/** The owner's Claude-derived inputs for today (`loadSignals`). */
export interface ActorSignals {
  report: ActivityInputs['report'];
  todayLog: TodayLogSignal | null;
}

export const NO_SIGNALS: ActorSignals = Object.freeze({ report: null, todayLog: null });

/** Roster members are active users by definition (`loadRoster`). */
const ACTIVE = { active: true } as const;

interface Actor {
  readonly userId: string;
  readonly player: Player;
  /** By slot: `pets[0]` (the default pet) is moved by `follower`, the others copy its pose. */
  pets: Pet[];
  follower: PetFollower;
  readonly walker: Walker;
  snap: ActorSnapshot;
  /** Pet changes made while the office was closed, applied when it opens (P5: no after-hours tell). */
  petsPending: boolean;
  signals: ActorSignals;
  session: SessionState | null;
  /** Business-time ms when the session ended (start of the live grace). */
  endedAt: number | null;
  resolved: ResolvedActivity;
  projected: ColleagueProjection;
  /** The tile allocated while shown (null while hidden). */
  spot: AllocatedSpot | null;
  /** Positioned at least once (room creation places everyone). */
  placed: boolean;
}

export interface DirectorOptions {
  world: OfficeWorld;
  state: OfficeState;
  /** APP_TIMEZONE: the office day of every town rule. */
  timeZone: string;
  /** TOWN_IGNORE_OFFICE_HOURS (development/e2e only). */
  ignoreOfficeHours?: boolean;
  /** Called with a short message and tile data only (never user ids or text). */
  warn?: (msg: string, data: Record<string, unknown>) => void;
  /**
   * How far `logPulse` moves per sparkle, 1..255 (mod 256). The room passes a random step so the synced
   * value never counts log writes; injected so the director itself stays deterministic. Default: 1.
   */
  pulseStep?: () => number;
  /** A pet entered or left the state (the room adds it to, or removes it from, the owner's StateView). */
  onPetAdded?: (ownerId: string, pet: Pet) => void;
  onPetRemoved?: (ownerId: string, pet: Pet) => void;
}

export interface ActorView {
  userId: string;
  x: number;
  y: number;
  dir: number;
  anim: number;
  shown: boolean;
  online: boolean;
  activity: number;
  source: number;
  until: number;
  note: number;
  groupId: string;
  statusText: string;
  logPulse: number;
  spot: Spot | null;
  pet: { x: number; y: number; dir: number; anim: number; indicator: number };
}

export interface DirectorSnapshot {
  officeOpen: boolean;
  actors: ActorView[];
}

/**
 * The pet-bubble hooks of the NudgeScheduler, all answered by the director: do-not-disturb is the
 * owner's resolved focus/meeting and office hours force quiet. Colleagues never see that a bubble is up
 * (`Pet.indicator` stays `None`): bubbles start only while the owner's tab is visible, so a shared `…`
 * would reveal the owner's attention (ADR 0004 D2).
 */
export function bubbleHooks(director: Director): {
  pet(userId: string, petId?: string | null): Pet | null;
  pets(userId: string): readonly Pet[];
  doNotDisturb(userId: string): boolean;
  officeOpen(): boolean;
} {
  return {
    pet: (userId, petId) => director.petFor(userId, petId ?? null),
    pets: (userId) => director.petsOf(userId),
    doNotDisturb: (userId) => director.resolved(userId)?.dnd ?? true,
    officeOpen: () => director.officeOpen,
  };
}

const HIDDEN_RESOLVED: ResolvedActivity = Object.freeze({
  shown: false,
  note: 'none',
  activity: 'none',
  source: 'none',
  until: null,
  groupKey: null,
  dnd: false,
});

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const tileKey = (p: Point): string => `${p.x},${p.y}`;

/** Assigns only when the value differs, so unchanged inputs produce no schema writes. */
function set<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  if (obj[key] !== value) obj[key] = value;
}

export class Director {
  private readonly actors = new Map<string, Actor>();
  private order: Actor[] | null = null;
  private holidays: ReadonlySet<string> = new Set();
  private open = false;
  /** Desk seats and meeting chairs: people sit there. */
  private readonly seatTiles: ReadonlySet<string>;

  constructor(private readonly opts: DirectorOptions) {
    const seats = new Set<string>();
    for (const d of opts.world.desks) seats.add(tileKey({ x: d.seatX, y: d.seatY }));
    for (const s of opts.world.spots.meetingSeats) seats.add(tileKey(s));
    this.seatTiles = seats;
  }

  // -------------------------------------------------------------------------------------------
  // inputs

  get officeOpen(): boolean {
    return this.open;
  }

  get size(): number {
    return this.actors.size;
  }

  has(userId: string): boolean {
    return this.actors.has(userId);
  }

  /** User ids in the director's fixed order (desk order, desk-less last, then user id). */
  ids(): string[] {
    return this.ordered().map((a) => a.userId);
  }

  setHolidays(holidays: ReadonlySet<string>): void {
    this.holidays = holidays;
  }

  /**
   * Creates the actor when absent; otherwise applies the snapshot to the existing `Player` and pets
   * **in place** (a connected owner's StateView holds those very `Pet`s, so a kept pet is never replaced).
   * Pet additions, changes and removals wait while the office is closed.
   */
  upsertActor(snap: ActorSnapshot): { created: boolean; linkChanged: boolean } {
    const existing = this.actors.get(snap.userId);
    if (existing) {
      const linkChanged = existing.snap.linkState !== snap.linkState;
      if (existing.snap.deskId !== snap.deskId) this.order = null;
      existing.snap = { ...snap };
      this.applyIdentity(existing);
      if (this.open) this.reconcilePets(existing);
      else existing.petsPending = true;
      return { created: false, linkChanged };
    }
    const { world, state } = this.opts;
    const player = new Player({
      id: snap.userId,
      name: snap.displayName,
      avatar: snap.avatarKey,
      deskId: snap.deskId ?? '',
    });
    const pets = this.petsFor(snap).map((p, slot) => this.newPet(snap, p, slot));
    const lead = pets[0]!;
    const actor: Actor = {
      userId: snap.userId,
      player,
      pets,
      follower: new PetFollower(lead, world, { linked: snap.linkState !== 'not_linked' }),
      petsPending: false,
      walker: new Walker(world),
      snap: { ...snap },
      signals: NO_SIGNALS,
      session: null,
      endedAt: null,
      resolved: HIDDEN_RESOLVED,
      projected: NEUTRAL_PROJECTION,
      spot: null,
      placed: false,
    };
    this.actors.set(snap.userId, actor);
    this.order = null;
    state.players.set(snap.userId, player);
    for (const pet of pets) state.pets.set(pet.petId, pet);
    return { created: true, linkChanged: false };
  }

  removeActor(userId: string): boolean {
    const a = this.actors.get(userId);
    if (!a) return false;
    this.actors.delete(userId);
    this.order = null;
    this.opts.state.players.delete(userId);
    for (const pet of a.pets) {
      this.opts.state.pets.delete(pet.petId);
      this.opts.onPetRemoved?.(userId, pet);
    }
    return true;
  }

  setSession(userId: string, s: SessionState, now: Date): void {
    const a = this.actors.get(userId);
    if (!a) return;
    a.session = s;
    a.endedAt = s === 'ended' ? now.getTime() : null;
  }

  /** The owner's own status (status:set); null = automatic. */
  setManual(userId: string, manual: ManualIn | null): void {
    const a = this.actors.get(userId);
    if (a) a.snap = { ...a.snap, manual };
  }

  setStatusText(userId: string, statusText: string): void {
    const a = this.actors.get(userId);
    if (a) a.snap = { ...a.snap, statusText };
  }

  /** Pet link state (link_state_changed); true when the actor exists. */
  setLinkState(userId: string, linkState: LinkState): boolean {
    const a = this.actors.get(userId);
    if (!a) return false;
    a.snap = { ...a.snap, linkState };
    this.applyIdentity(a);
    return true;
  }

  setSignals(userId: string, signals: ActorSignals): void {
    const a = this.actors.get(userId);
    if (a) a.signals = signals;
  }

  /**
   * A work-log write by the owner's Claude sparkles (`logPulse`) only when the office is open, the
   * owner is shown and shares activity, and the log is colleague-visible. Owner edits never sparkle.
   */
  noteLogWrite(userId: string, by: 'claude' | 'user'): boolean {
    const a = this.actors.get(userId);
    if (!a || by !== 'claude' || !this.open || !a.projected.shown) return false;
    if (!canShareActivity(a.snap, ACTIVE)) return false;
    const today = a.signals.todayLog;
    if (!today || !canViewLog(ANY_COLLEAGUE, today.log, ACTIVE)) return false;
    // Only a change matters to the client; a random non-zero step keeps the value from counting writes.
    const step = Math.min(255, Math.max(1, Math.trunc(this.opts.pulseStep?.() ?? 1)));
    a.player.logPulse = (a.player.logPulse + step) & 0xff;
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // outputs

  resolved(userId: string): ResolvedActivity | null {
    return this.actors.get(userId)?.resolved ?? null;
  }

  projected(userId: string): ColleagueProjection | null {
    return this.actors.get(userId)?.projected ?? null;
  }

  /** The owner's default pet (slot 0). */
  pet(userId: string): Pet | null {
    return this.actors.get(userId)?.pets[0] ?? null;
  }

  /** Every pet of the owner, by slot. */
  petsOf(userId: string): readonly Pet[] {
    return this.actors.get(userId)?.pets ?? [];
  }

  /** The owner's pet `petId`, or the default pet when it is null or not in the town (yet). */
  petFor(userId: string, petId: string | null): Pet | null {
    const pets = this.actors.get(userId)?.pets;
    if (!pets) return null;
    return (petId ? pets.find((p) => p.petId === petId) : undefined) ?? pets[0] ?? null;
  }

  player(userId: string): Player | null {
    return this.actors.get(userId)?.player ?? null;
  }

  snapshot(): DirectorSnapshot {
    return {
      officeOpen: this.open,
      actors: this.ordered().map((a) => {
        const p = a.player;
        const pet = a.pets[0]!;
        return {
          userId: a.userId,
          x: p.x,
          y: p.y,
          dir: p.dir,
          anim: p.anim,
          shown: p.shown,
          online: p.online,
          activity: p.activity,
          source: p.source,
          until: p.until,
          note: p.note,
          groupId: p.groupId,
          statusText: p.statusText,
          logPulse: p.logPulse,
          spot: a.spot ? { x: a.spot.x, y: a.spot.y, facing: a.spot.facing } : null,
          pet: { x: pet.x, y: pet.y, dir: pet.dir, anim: pet.anim, indicator: pet.indicator },
        };
      }),
    };
  }

  // -------------------------------------------------------------------------------------------
  // evaluation (1 Hz, and right after status:set or a DB event)

  /** `snap`: place everyone directly at their spot (room creation and resync). */
  evaluate(now: Date, nowMs: number, opts: { snap?: boolean } = {}): void {
    const { world, state, timeZone } = this.opts;
    const open = isOfficeOpen(now, timeZone, this.holidays, this.opts.ignoreOfficeHours ?? false);
    this.open = open;
    set(state, 'officeOpen', open);

    const actors = this.ordered();
    const nowT = now.getTime();
    for (const a of actors) {
      const share = canShareActivity(a.snap, ACTIVE);
      const showLive = canShowLive(a.snap);
      const today = a.signals.todayLog;
      a.resolved = resolveActivity({
        now,
        live: showLive && this.isLive(a, nowT),
        manual: a.snap.manual,
        share,
        report: a.signals.report,
        todayLog: today
          ? { colleagueVisible: canViewLog(ANY_COLLEAGUE, today.log, ACTIVE), hasWorkTask: today.hasWorkTask }
          : null,
      });
      a.projected = projectForColleagues(a.resolved, {
        officeOpen: open,
        connected: showLive && a.session === 'open',
        share,
        statusText: a.snap.statusText,
      });
    }

    const groups = groupPeople(
      actors.map((a) => ({
        userId: a.userId,
        deskId: a.snap.deskId,
        activity: a.projected.activity,
        shown: a.projected.shown,
        key: a.projected.groupKey,
      })),
      {
        periodKey: localDateKey(now, timeZone),
        deskOrder: DESK_IDS,
        meetingSeats: world.spots.meetingSeats.length,
      },
    );
    const groupOf = new Map<string, ActivityGroup>();
    for (const g of groups) for (const id of g.members) groupOf.set(id, g);

    const placed = allocateSpots(
      world,
      world.spots,
      actors
        .filter((a) => a.projected.shown)
        .map((a) => ({
          userId: a.userId,
          deskId: a.snap.deskId,
          intent: this.intentOf(a, groupOf.get(a.userId)),
          current: a.spot,
        })),
    );

    let movers = 0;
    for (const a of actors) {
      if (open && a.petsPending) this.reconcilePets(a);
      const wasShown = a.player.shown;
      this.writeFields(a, groupOf.get(a.userId)?.id ?? '');
      a.follower.setAsleep(!open);
      // Shared with everyone, so never `Dots`: a bubble's onset would reveal the owner's tab visibility.
      for (const pet of a.pets) set(pet, 'indicator', Indicator.None);

      const spot = placed.get(a.userId) ?? null;
      if (!a.projected.shown || !spot) {
        if (wasShown && a.walker.walking) a.walker.stop();
        if (wasShown && a.player.anim === Anim.Walk) set(a.player, 'anim', Anim.Idle);
        a.spot = null;
        if (!a.placed) this.park(a, nowMs);
        else {
          // After hours nobody keeps the spot or pose of their last shown state (no "who was where at closing").
          if (!open) this.parkPlayer(a);
          if (opts.snap) this.snapPerch(a, nowMs);
        }
        continue;
      }
      if (opts.snap || !a.placed || !wasShown) {
        this.placeAt(a, spot, nowMs);
        continue;
      }
      if (a.spot && a.spot.x === spot.x && a.spot.y === spot.y && a.spot.facing === spot.facing) {
        a.spot = spot;
        continue;
      }
      a.spot = spot;
      const start = a.walker.walkTo(a.player, spot, nowMs + movers * TOWN_TIMING.moveStaggerMs);
      if (start === 'walk') movers++;
      else if (start === 'arrived') this.settle(a);
      else {
        this.opts.warn?.('no path to the director spot; placing directly', {
          from: { x: a.player.x, y: a.player.y },
          to: { x: spot.x, y: spot.y },
        });
        this.placeAt(a, spot, nowMs);
      }
    }
    for (const a of actors) this.copyLeadPose(a);
  }

  /** Advances walkers and pets (the room's 50 ms fast tick). */
  step(nowMs: number): void {
    for (const a of this.ordered()) {
      const p = a.player;
      const s = a.walker.step(nowMs, p);
      if (s) {
        const dir = dirBetween(s.from, s.to, p.dir as Dir);
        set(p, 'dir', dir);
        set(p, 'x', s.to.x);
        set(p, 'y', s.to.y);
        set(p, 'anim', Anim.Walk);
        a.follower.ownerMoved(s.from, s.to, dir, nowMs);
        if (s.arrived) this.settle(a);
      }
      a.follower.update(nowMs, p, p.dir as Dir, this.perchOf(a));
      this.copyLeadPose(a);
    }
  }

  // -------------------------------------------------------------------------------------------
  // internals

  private ordered(): Actor[] {
    if (!this.order) {
      const rank = (a: Actor): number => {
        const i = a.snap.deskId === null ? -1 : (DESK_IDS as readonly string[]).indexOf(a.snap.deskId);
        return i < 0 ? DESK_IDS.length : i;
      };
      this.order = [...this.actors.values()].sort((a, b) => rank(a) - rank(b) || cmp(a.userId, b.userId));
    }
    return this.order;
  }

  private isLive(a: Actor, nowT: number): boolean {
    if (a.session === 'open' || a.session === 'held') return true;
    return a.session === 'ended' && a.endedAt !== null && nowT - a.endedAt < TOWN_TIMING.liveGraceMs;
  }

  private intentOf(a: Actor, g: ActivityGroup | undefined): SpotIntent {
    if (g?.gather) {
      if (g.family === 'meeting') return { kind: 'meeting' };
      if (g.hostId !== null && g.hostId !== a.userId) {
        const hostDesk = this.actors.get(g.hostId)?.snap.deskId ?? null;
        if (hostDesk) return { kind: 'visit', hostDeskId: hostDesk };
      }
    }
    if (a.projected.activity === 'break') return { kind: 'break' };
    return a.snap.deskId ? { kind: 'desk' } : { kind: 'guest' };
  }

  private writeFields(a: Actor, groupId: string): void {
    const p = a.player;
    const v = a.projected;
    set(p, 'shown', v.shown);
    set(p, 'online', v.online);
    set(p, 'activity', activityCode(v.activity));
    set(p, 'source', sourceCode(v.source));
    set(p, 'until', v.until ? v.until.getTime() : 0);
    set(p, 'note', plateNoteCode(v.note));
    set(p, 'groupId', groupId);
    set(p, 'statusText', v.statusText);
    // Closed phase: no pulse value survives the night.
    if (!this.open) set(p, 'logPulse', 0);
  }

  private applyIdentity(a: Actor): void {
    const { player: p, snap } = a;
    set(p, 'name', snap.displayName);
    set(p, 'avatar', snap.avatarKey);
    set(p, 'deskId', snap.deskId ?? '');
    // Link state is per person: every pet wakes and sleeps together.
    for (const pet of a.pets) set(pet, 'linkState', linkStateToCode(snap.linkState));
    a.follower.setLinked(snap.linkState !== 'not_linked');
  }

  /** The snapshot's pets, capped, never empty (a profile always has its default pet; this is a fallback). */
  private petsFor(snap: ActorSnapshot): TownPetSnap[] {
    const pets = snap.pets.slice(0, LIMITS.petsPerOwnerMax);
    return pets.length > 0
      ? pets
      : [{ petId: `default:${snap.userId}`, species: 'cat', name: '펫', tint: 'base' }];
  }

  private newPet(snap: ActorSnapshot, p: TownPetSnap, slot: number): Pet {
    return new Pet({
      petId: p.petId,
      ownerId: snap.userId,
      slot,
      species: p.species,
      tint: p.tint,
      name: p.name,
      linkState: linkStateToCode(snap.linkState),
    });
  }

  /**
   * Brings the owner's pets in line with the snapshot: kept pets change in place, new ones appear where the
   * default pet is, removed ones leave. A new default pet (only after data repair) takes over the follower.
   */
  private reconcilePets(a: Actor): void {
    a.petsPending = false;
    const { state, world } = this.opts;
    const lead = a.pets[0]!;
    const kept = new Map(a.pets.map((p) => [p.petId, p]));
    const next = this.petsFor(a.snap).map((want, slot) => {
      const pet = kept.get(want.petId);
      if (pet) {
        kept.delete(want.petId);
        set(pet, 'slot', slot);
        set(pet, 'species', want.species);
        set(pet, 'tint', want.tint);
        set(pet, 'name', want.name);
        return pet;
      }
      const born = this.newPet(a.snap, want, slot);
      born.x = lead.x;
      born.y = lead.y;
      born.dir = lead.dir;
      born.anim = lead.anim;
      state.pets.set(born.petId, born);
      this.opts.onPetAdded?.(a.userId, born);
      return born;
    });
    for (const gone of kept.values()) {
      state.pets.delete(gone.petId);
      this.opts.onPetRemoved?.(a.userId, gone);
    }
    a.pets = next;
    if (next[0] !== lead) {
      a.follower = new PetFollower(next[0]!, world, { linked: a.snap.linkState !== 'not_linked' });
      a.follower.setAsleep(!this.open);
    }
  }

  /** The pets after the default one sit on its tile with its pose; the client fans them out by slot. */
  private copyLeadPose(a: Actor): void {
    const lead = a.pets[0]!;
    for (let i = 1; i < a.pets.length; i++) {
      const pet = a.pets[i]!;
      set(pet, 'x', lead.x);
      set(pet, 'y', lead.y);
      set(pet, 'dir', lead.dir);
      set(pet, 'anim', lead.anim);
    }
  }

  /** The perch of a hidden owner's pet (only for a desk on this map; desk-less pets are hidden by the client). */
  private perchOf(a: Actor): PerchTarget | null {
    if (a.projected.shown || !a.snap.deskId || !this.opts.world.deskById(a.snap.deskId)) return null;
    const s = this.opts.world.spots.perch(a.snap.deskId);
    return { x: s.x, y: s.y, dir: facingToDir(s.facing) };
  }

  /** Puts a shown person straight onto their spot (appearing, creation, resync, or no path). */
  private placeAt(a: Actor, spot: AllocatedSpot, nowMs: number): void {
    const p = a.player;
    const dir = facingToDir(spot.facing);
    a.walker.stop();
    a.spot = spot;
    a.placed = true;
    set(p, 'x', spot.x);
    set(p, 'y', spot.y);
    set(p, 'dir', dir);
    set(p, 'anim', this.restAnim(spot));
    a.follower.placeNear(spot, dir, nowMs);
  }

  /** A hidden person stays out of sight at their seat (or the entrance); the pet rests on the desk. */
  private park(a: Actor, nowMs: number): void {
    const at = this.parkPlayer(a);
    const perch = this.perchOf(a);
    if (perch) a.follower.perchAt(perch, nowMs);
    else a.follower.placeNear(at, facingToDir(at.facing), nowMs);
  }

  /**
   * The person half of `park`: their seat (or the first guest spot, or the entrance), facing the desk's way,
   * `Idle`. `set` writes only changes, so calling it again for a parked person costs no schema writes.
   */
  private parkPlayer(a: Actor): Spot {
    const { world } = this.opts;
    const desk = a.snap.deskId ? world.deskById(a.snap.deskId) : null;
    const guest = world.spots.guestSpots[0];
    const at: Spot = desk
      ? { x: desk.seatX, y: desk.seatY, facing: desk.facing }
      : (guest ?? { x: world.spawn.tileRect.x, y: world.spawn.tileRect.y, facing: 'up' });
    const p = a.player;
    a.walker.stop();
    a.placed = true;
    set(p, 'x', at.x);
    set(p, 'y', at.y);
    set(p, 'dir', facingToDir(at.facing));
    set(p, 'anim', Anim.Idle);
    return at;
  }

  /** Resync: a hidden owner's pet lands on its perch at once (people stay where they were hidden). */
  private snapPerch(a: Actor, nowMs: number): void {
    const perch = this.perchOf(a);
    if (perch) a.follower.perchAt(perch, nowMs);
  }

  /** Arrived (or already there): face the spot's way and sit on a seat or chair. */
  private settle(a: Actor): void {
    const spot = a.spot;
    const p = a.player;
    if (!spot || p.x !== spot.x || p.y !== spot.y) {
      set(p, 'anim', Anim.Idle);
      return;
    }
    set(p, 'dir', facingToDir(spot.facing));
    set(p, 'anim', this.restAnim(spot));
  }

  private restAnim(spot: Point): Anim {
    return this.seatTiles.has(tileKey(spot)) ? Anim.Sit : Anim.Idle;
  }
}
