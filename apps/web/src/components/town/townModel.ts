/**
 * Pure view models for the town overlays (unit-tested; no React/DOM). Every roster member is always
 * in the realtime state, so nothing here asks "does a Player exist": it reads `shown` (the avatar is
 * drawn), `online` (connected now) and `note` (a hidden member's plate), exactly as projected.
 */
import { ActivityCode, PlateNote, SourceCode, type StatusSetMsg } from '@enu/protocol';
import {
  MANUAL_STATUSES,
  TEAMS,
  type ManualDuration,
  type ManualStatus,
  type ManualStatusDto,
  type PersonDto,
} from '@enu/shared';
import { activityIcon, deskRank, displayForm, hasLabel, noteLabel } from '@/game/logic/presence';
import type { EffectName } from '@/game/spriteSpec';
import { ko } from '@/i18n/ko';
import type { PlayerSnap } from '@/realtime/types';

/** `접속 N명`: Players with `online` (0 after hours). Never the roster size or "shown". */
export function onlineCount(players: Iterable<PlayerSnap>): number {
  let n = 0;
  for (const p of players) if (p.online) n++;
  return n;
}

/* ------------------------------------------------------------------ team rail */

export interface RailRow {
  person: PersonDto;
  player: PlayerSnap | null;
  isMe: boolean;
  online: boolean;
  shown: boolean;
  /** Display form (§5.3), '' when nothing is known. */
  form: string;
  icon: EffectName | null;
  statusText: string;
}

export interface RailGroup {
  teamId: string | null;
  label: string;
  rows: RailRow[];
}

/** Rail rows grouped in TEAMS order (no team last), each group in desk order (no desk last), then name. */
export function railGroups(
  people: readonly PersonDto[],
  players: ReadonlyMap<string, PlayerSnap>,
  myUserId: string,
  timeZone: string,
): RailGroup[] {
  const groups: RailGroup[] = TEAMS.map((t) => ({ teamId: t.id as string, label: t.label as string, rows: [] }));
  const none: RailGroup = { teamId: null, label: ko.townUi.people.noTeam, rows: [] };
  for (const person of people) {
    const player = players.get(person.userId) ?? null;
    const row: RailRow = {
      person,
      player,
      isMe: person.userId === myUserId,
      online: player?.online === true,
      shown: player?.shown === true,
      form: player ? displayForm(player, timeZone) : '',
      icon: player && player.note === PlateNote.None ? activityIcon(player.activity) : null,
      statusText: player?.statusText ?? '',
    };
    (groups.find((g) => g.teamId === person.team) ?? none).rows.push(row);
  }
  const all = [...groups, none].filter((g) => g.rows.length > 0);
  for (const g of all) {
    g.rows.sort(
      (a, b) =>
        deskRank(a.person.deskId) - deskRank(b.person.deskId) ||
        a.person.displayName.localeCompare(b.person.displayName, 'ko'),
    );
  }
  return all;
}

/* ------------------------------------------------------------------ avatar / desk menu */

export interface MenuState {
  /** Header line under name · team · title: the display form (`부재` alone for absent). */
  form: string;
  online: boolean;
  /** `손 흔들기 (모두에게 보여요)`: both drawn and the office open. */
  canWave: boolean;
  /** `부르기`: the target is connected now (the server checks the same). */
  canPing: boolean;
  /** `이 사람 보기`: the target is drawn. */
  canView: boolean;
  /** Why the social items are disabled, or null. */
  hint: string | null;
}

export function menuState(
  target: PlayerSnap | null | undefined,
  me: PlayerSnap | null | undefined,
  officeOpen: boolean | null,
  timeZone: string,
): MenuState {
  const shown = target?.shown === true;
  const online = target?.online === true;
  const canWave = officeOpen === true && shown && me?.shown === true;
  const canView = shown;
  let hint: string | null = null;
  if (!shown) hint = ko.townUi.menu.offlineAction;
  else if (!online) hint = ko.townUi.menu.pingNeedsOnline;
  return {
    form: target ? displayForm(target, timeZone) : '',
    online,
    canWave,
    canPing: online,
    canView,
    hint,
  };
}

/* ------------------------------------------------------------------ my status */

export type StatusChoice = 'auto' | ManualStatus;

export const STATUS_CHOICES: readonly StatusChoice[] = ['auto', ...MANUAL_STATUSES];
export const DEFAULT_DURATION: ManualDuration = '1h';

const ACTIVITY_TO_MANUAL: Partial<Record<number, ManualStatus>> = {
  [ActivityCode.Available]: 'available',
  [ActivityCode.Focus]: 'focus',
  [ActivityCode.Meeting]: 'meeting',
  [ActivityCode.Break]: 'break',
};

/** A manual status that is still in force (expired values are ignored everywhere). */
export function activeManual(manual: ManualStatusDto | null | undefined, now: Date): ManualStatusDto | null {
  if (!manual) return null;
  const until = Date.parse(manual.until);
  return Number.isFinite(until) && until > now.getTime() ? manual : null;
}

/**
 * My current choice: the projection when the office is open (source Manual, or the Away note), otherwise
 * what I last set (MeDto.manualStatus or the value applied in this tab), otherwise `auto`.
 */
export function currentChoice(
  mine: PlayerSnap | null | undefined,
  officeOpen: boolean | null,
  manual: ManualStatusDto | null,
): { choice: StatusChoice; until: number } {
  if (officeOpen === true && mine) {
    if (mine.note === PlateNote.Away) return { choice: 'away', until: mine.until };
    if (mine.source === SourceCode.Manual) {
      const status = ACTIVITY_TO_MANUAL[mine.activity];
      if (status) return { choice: status, until: mine.until };
    }
    return { choice: 'auto', until: 0 };
  }
  if (manual) return { choice: manual.status, until: Date.parse(manual.until) };
  return { choice: 'auto', until: 0 };
}

/** `status:set` payload. `auto` sends no duration; the 상태 문구 is sent only when it changed. */
export function statusPayload(
  choice: StatusChoice,
  duration: ManualDuration,
  text: string,
  previousText: string,
): StatusSetMsg {
  const trimmed = text.trim();
  const msg: StatusSetMsg = choice === 'auto' ? { status: 'auto' } : { status: choice, duration };
  if (trimmed !== previousText.trim()) msg.text = trimmed;
  return msg;
}

/** Short top-bar label: `집중 ~11:00`, `자동`. */
export function statusChipLabel(choice: StatusChoice, until: number, formatHm: (ms: number) => string): string {
  const short = ko.townUi.status.short[choice];
  return choice !== 'auto' && until > 0 ? `${short} ${ko.townUi.until(formatHm(until))}` : short;
}

/**
 * StatusMenu line about how colleagues see me while I am hidden (office hours only; null when shown or
 * closed): the note, the plate label, or my name only.
 */
export function ownHiddenLine(mine: PlayerSnap | null | undefined, officeOpen: boolean | null, timeZone: string): string | null {
  if (officeOpen !== true || !mine || mine.shown) return null;
  if (mine.note !== PlateNote.None) return ko.townUi.status.hiddenNote(noteLabel(mine.note));
  if (hasLabel(mine)) return ko.townUi.status.hiddenLabel(displayForm(mine, timeZone));
  return ko.townUi.status.hiddenName;
}

/* ------------------------------------------------------------------ profile card */

export interface ProfileStatus {
  online: boolean;
  /** Display form, plus the 상태 문구 when the projection carries one. */
  text: string;
}

export function profileStatus(
  player: PlayerSnap | null | undefined,
  officeOpen: boolean | null,
  timeZone: string,
): ProfileStatus {
  if (officeOpen === false) return { online: false, text: ko.townUi.profile.officeClosed };
  const form = player ? displayForm(player, timeZone) : '';
  const parts = [form || ko.townUi.profile.nothingKnown];
  if (player?.statusText) parts.push(player.statusText);
  return { online: player?.online === true, text: parts.join(' · ') };
}
