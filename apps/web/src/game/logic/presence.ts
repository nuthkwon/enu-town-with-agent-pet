/**
 * How a roster member's projected state reads on screen (pure; shared by the canvas, menus, the team
 * rail and the legend). Labels follow the spec §5.3 table (`ko.townUi.activity/source/note`); the
 * display form is `<activity> · <source>` plus ` · ~HH:MM` when `until > 0`, and `부재` alone.
 * Times are formatted in the office time zone (MeDto.officeTimeZone, P5).
 */
import { ActivityCode, PlateNote, SourceCode } from '@enu/protocol';
import { DESK_IDS, formatLocalHm } from '@enu/shared';
import { ko } from '@/i18n/ko';
import type { PlayerSnap } from '../../realtime/types';
import type { EffectName } from '../spriteSpec';

/** The Player fields that carry state (everything a label may read). */
export type PresenceFields = Pick<
  PlayerSnap,
  'shown' | 'online' | 'activity' | 'source' | 'until' | 'note' | 'statusText' | 'groupId'
>;

function keyFor<T extends Record<string, number>>(table: T, code: number): keyof T | null {
  for (const k of Object.keys(table) as (keyof T)[]) if (table[k] === code) return k;
  return null;
}

export function activityLabel(code: number): string {
  const k = keyFor(ActivityCode, code);
  return k ? ko.townUi.activity[k] : '';
}

export function sourceLabel(code: number): string {
  const k = keyFor(SourceCode, code);
  return k ? ko.townUi.source[k] : '';
}

export function noteLabel(note: number): string {
  const k = keyFor(PlateNote, note);
  return k ? ko.townUi.note[k] : '';
}

/** `~HH:MM` for an epoch-ms `until` (office time zone), '' when there is none. */
export function untilLabel(until: number, timeZone: string): string {
  if (!(until > 0) || !Number.isFinite(until)) return '';
  return ko.townUi.until(formatLocalHm(new Date(until), timeZone));
}

/** Icon of each activity (effects row 3; Docs reuses `note`; Available reuses the green `check`). */
const ACTIVITY_ICONS: Partial<Record<number, EffectName>> = {
  [ActivityCode.Available]: 'check',
  [ActivityCode.Focus]: 'focus',
  [ActivityCode.Meeting]: 'headset',
  [ActivityCode.Break]: 'cup',
  [ActivityCode.Work]: 'laptop',
  [ActivityCode.Docs]: 'note',
  [ActivityCode.Review]: 'magnifier',
  [ActivityCode.Collab]: 'link',
  [ActivityCode.Today]: 'clipboard',
};

export function activityIcon(code: number): EffectName | null {
  return ACTIVITY_ICONS[code] ?? null;
}

/**
 * One-line state: `검토 중 · Claude 보고 · ~11:00`, `집중 모드 · 직접 설정`, `타운 접속` (no activity:
 * the source only), `자리 비움 · ~15:00`, `부재` (never a source or an end time). '' when nothing is known.
 */
export function displayForm(p: PresenceFields, timeZone: string): string {
  if (p.note === PlateNote.Absent) return noteLabel(PlateNote.Absent);
  const until = untilLabel(p.until, timeZone);
  if (p.note === PlateNote.Away) return [noteLabel(PlateNote.Away), until].filter(Boolean).join(' · ');
  return [activityLabel(p.activity), sourceLabel(p.source), until].filter(Boolean).join(' · ');
}

/** True when the member is drawn with a known activity or note (something to label). */
export function hasLabel(p: PresenceFields): boolean {
  return p.note !== PlateNote.None || p.activity !== ActivityCode.None;
}

/** Desk-plate content of a HIDDEN member (spec §1.3): the name is always the first line. */
export interface HiddenPlate {
  /** Line 2: the note or the activity (with its icon), null = name only. */
  label: { icon: EffectName | null; text: string } | null;
  /** Line 3 (small): the source and `~HH:MM`, or the owner's 상태 문구 on a 자리 비움 plate. */
  detail: string | null;
  /** Nothing known: the plate is drawn quietly (no "미접속" shaming, just the name). */
  quiet: boolean;
}

export function hiddenPlate(p: PresenceFields, timeZone: string): HiddenPlate {
  if (p.note === PlateNote.Absent) {
    return { label: { icon: null, text: noteLabel(PlateNote.Absent) }, detail: null, quiet: false };
  }
  if (p.note === PlateNote.Away) {
    const text = [noteLabel(PlateNote.Away), untilLabel(p.until, timeZone)].filter(Boolean).join(' · ');
    return { label: { icon: null, text }, detail: p.statusText.trim() || null, quiet: false };
  }
  if (p.activity !== ActivityCode.None) {
    const detail = [sourceLabel(p.source), untilLabel(p.until, timeZone)].filter(Boolean).join(' · ');
    return {
      label: { icon: activityIcon(p.activity), text: activityLabel(p.activity) },
      detail: detail || null,
      quiet: false,
    };
  }
  return { label: null, detail: null, quiet: true };
}

/** Desk order (DESK_IDS) for sorting; people without a desk sort last. */
export function deskRank(deskId: string | null | undefined): number {
  const i = deskId ? (DESK_IDS as readonly string[]).indexOf(deskId) : -1;
  return i < 0 ? DESK_IDS.length : i;
}

export interface GroupView {
  id: string;
  family: 'meeting' | 'work';
  /** Members in desk order (people without a desk last), then id. */
  members: PlayerSnap[];
  /** Latest member `until` (epoch ms, 0 = none): the chip's `~HH:MM`. */
  until: number;
}

/**
 * Groups as the server projected them (`Player.groupId`). The family is a meeting when a member's activity
 * is Meeting, otherwise same work. A group needs at least two members on screen data.
 */
export function groupsOf(players: Iterable<PlayerSnap>): GroupView[] {
  const byId = new Map<string, PlayerSnap[]>();
  for (const p of players) {
    if (!p.groupId) continue;
    const list = byId.get(p.groupId);
    if (list) list.push(p);
    else byId.set(p.groupId, [p]);
  }
  const out: GroupView[] = [];
  for (const [id, members] of byId) {
    if (members.length < 2) continue;
    members.sort((a, b) => deskRank(a.deskId) - deskRank(b.deskId) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.push({
      id,
      family: members.some((m) => m.activity === ActivityCode.Meeting) ? 'meeting' : 'work',
      members,
      until: members.reduce((u, m) => Math.max(u, m.until > 0 ? m.until : 0), 0),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** `회의 중 · N명 · ~11:00` or `같은 작업`. */
export function groupChipText(g: GroupView, timeZone: string): string {
  if (g.family === 'work') return ko.townUi.group.workChip;
  const hm = g.until > 0 ? formatLocalHm(new Date(g.until), timeZone) : null;
  return ko.townUi.group.meetingChip(g.members.length, hm);
}
