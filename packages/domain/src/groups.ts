import { TOWN_TIMING } from '@enu/shared';
import type { ActivityName } from './activity';
import { fnv1a32 } from './hash';
import type { ColleagueProjection } from './visibility';

/**
 * Who is drawn together. Only mutual corroboration links people: every member's own Claude reported the
 * same ref, and the projected key is null for anyone who does not share. No Claude can place a colleague.
 */

export interface GroupMember {
  userId: string;
  deskId: string | null;
  activity: ActivityName;
  shown: boolean;
  /** The projected key (projectForColleagues), not the owner-side one. */
  key: ColleagueProjection['groupKey'];
}

export interface ActivityGroup {
  /** Opaque 'g…' id, stable within the office day; contains no hash material. */
  id: string;
  family: 'meeting' | 'work';
  /** Desk order (members without a desk last), then user id. */
  members: readonly string[];
  /** Work groups: the member whose desk the others visit. Always null for meetings. */
  hostId: string | null;
  /** Walk together (meeting table or host desk); otherwise drawn as dotted links between the members. */
  gather: boolean;
}

/** A pair of people working on the same item is a group; a meeting needs three (1:1s are never drawn). */
const WORK_GROUP_MIN = 2;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Reviewers visit authors: the only non-reviewer with a desk hosts, otherwise the first member with a desk. */
function workHost(members: readonly GroupMember[]): GroupMember | null {
  const withDesk = members.filter((m) => m.deskId !== null);
  const authors = withDesk.filter((m) => m.activity !== 'review');
  return (authors.length === 1 ? authors[0] : withDesk[0]) ?? null;
}

export function groupPeople(
  people: readonly GroupMember[],
  o: { periodKey: string; deskOrder: readonly string[]; meetingSeats: number },
): ActivityGroup[] {
  const deskRank = (m: GroupMember) => {
    const i = m.deskId === null ? -1 : o.deskOrder.indexOf(m.deskId);
    return i < 0 ? o.deskOrder.length : i;
  };
  const buckets = new Map<string, { family: 'meeting' | 'work'; members: GroupMember[] }>();
  for (const p of people) {
    if (!p.key) continue;
    const k = `${p.key.family}|${p.key.hash}`;
    const bucket = buckets.get(k) ?? { family: p.key.family, members: [] };
    bucket.members.push(p);
    buckets.set(k, bucket);
  }

  const groups: ActivityGroup[] = [];
  for (const { family, members } of buckets.values()) {
    if (members.length < (family === 'meeting' ? TOWN_TIMING.meetingGroupMin : WORK_GROUP_MIN)) continue;
    members.sort((a, b) => deskRank(a) - deskRank(b) || cmp(a.userId, b.userId));
    const ids = members.map((m) => m.userId);
    const id = `g${fnv1a32([o.periodKey, family, ...ids].join('|')).toString(36)}`;
    if (family === 'meeting') {
      groups.push({ id, family, members: ids, hostId: null, gather: false });
      continue;
    }
    const host = workHost(members);
    const gather =
      host !== null && members.length <= TOWN_TIMING.workGroupGatherMax && members.every((m) => m.shown);
    groups.push({ id, family, members: ids, hostId: host?.userId ?? null, gather });
  }
  groups.sort((a, b) => cmp(a.id, b.id));

  // One physical table: only the largest meeting (tie: smallest id) gathers, and only if it fits.
  let table: ActivityGroup | null = null;
  for (const g of groups) {
    if (g.family === 'meeting' && (!table || g.members.length > table.members.length)) table = g;
  }
  if (table && table.members.length <= o.meetingSeats) table.gather = true;
  return groups;
}
