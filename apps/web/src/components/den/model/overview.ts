import { ActivityCode, PlateNote } from '@enu/protocol';
import {
  TASK_STATUSES,
  TEAMS,
  teamLabel,
  type OverviewMemberDto,
  type TaskStatus,
  type TeamId,
  type WorkLogChange,
} from '@enu/shared';
import { groupsOf, type GroupView } from '@/game/logic/presence';
import { ko } from '@/i18n/ko';
import type { PlayerSnap } from '@/realtime/types';

/**
 * Pure view models of the work overview (ADR 0007). Teams always come in the fixed TEAMS order and people in the
 * server's order (team, desk, name): nothing is ranked. A team appears only when one of its people has a visible log
 * today, so no list shows who has none.
 */

const t = ko.den.overview;

/** One change as a plain line (Claude's text verbatim; ENU Den adds only the frame). */
export function changeLabel(c: WorkLogChange): string {
  switch (c.type) {
    case 'summary':
      return t.change.summary(c.text);
    case 'task_status':
      return t.change.taskStatus(c.title, ko.taskStatus[c.from], ko.taskStatus[c.to]);
    case 'task_added':
      return t.change.taskAdded(c.title, ko.taskStatus[c.status]);
    case 'blocker_added':
      return t.change.blocker(c.text);
  }
}

export interface TeamGroup<T> {
  team: TeamId | null;
  label: string;
  items: T[];
}

/** Groups items by team in TEAMS order (no team last), keeping each team's items in the given order. */
export function byTeam<T extends { team: TeamId | null }>(items: readonly T[]): TeamGroup<T>[] {
  const order: (TeamId | null)[] = [...TEAMS.map((x) => x.id), null];
  const out: TeamGroup<T>[] = [];
  for (const team of order) {
    const list = items.filter((i) => i.team === team);
    if (list.length > 0) out.push({ team, label: team ? teamLabel(team) : t.noTeam, items: list });
  }
  return out;
}

export type StatusCounts = Record<TaskStatus, number>;

/** Tasks per status for each team with a visible log today (team order; no ranking, no per-person split). */
export function teamTotals(
  members: readonly OverviewMemberDto[],
): { team: TeamId | null; label: string; counts: StatusCounts }[] {
  return byTeam(members).map((g) => {
    const counts = Object.fromEntries(TASK_STATUSES.map((st) => [st, 0])) as StatusCounts;
    for (const m of g.items) for (const task of m.tasks) counts[task.status]++;
    return { team: g.team, label: g.label, counts };
  });
}

export interface BlockerItem {
  userId: string;
  authorName: string;
  text: string;
}

/** Today's blockers of company logs, by team (teams without any are left out). */
export function blockersByTeam(members: readonly OverviewMemberDto[]): TeamGroup<BlockerItem>[] {
  return byTeam(members)
    .map((g) => ({
      ...g,
      items: g.items.flatMap((m) =>
        m.blockers.map((text) => ({ userId: m.userId, authorName: m.authorName, text })),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

export interface LiveTownSummary {
  meetings: GroupView[];
  meeting: number;
  focus: number;
  away: number;
  absent: number;
  online: number;
}

/**
 * "Town now" from the live roster, exactly as the town draws it: meetings under way (groups of the meeting family)
 * and how many plates read meeting, focus, away or absent, and how many people are online. Null after hours (the
 * shared state is neutral then) and before the first state arrives.
 */
export function liveTownSummary(
  roster: readonly PlayerSnap[],
  officeOpen: boolean | null,
): LiveTownSummary | null {
  if (officeOpen !== true) return null;
  const sum: LiveTownSummary = {
    meetings: groupsOf(roster).filter((g) => g.family === 'meeting'),
    meeting: 0,
    focus: 0,
    away: 0,
    absent: 0,
    online: 0,
  };
  for (const p of roster) {
    if (p.online) sum.online++;
    if (p.note === PlateNote.Away) sum.away++;
    else if (p.note === PlateNote.Absent) sum.absent++;
    else if (p.activity === ActivityCode.Meeting) sum.meeting++;
    else if (p.activity === ActivityCode.Focus) sum.focus++;
  }
  return sum;
}
