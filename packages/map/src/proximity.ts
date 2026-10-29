import { LIMITS, type ZoneId } from '@enu/shared';

export interface ProximityPlayer {
  id: string;
  /** Tile coordinates (fractional values allowed). */
  x: number;
  y: number;
  /** Zone the player is in (`world.zoneAt(x, y)?.zoneId`), if any. */
  zoneId?: string | null;
}

/**
 * Zones that isolate conversation: everyone inside is one group regardless of distance,
 * nobody outside hears inside and vice versa.
 */
export const ISOLATED_ZONE_IDS: readonly ZoneId[] = ['meeting'];

export interface ProximityOptions {
  /** Euclidean radius in tiles (default `LIMITS.nearbyRadiusTiles`). */
  radius?: number;
  /** Isolated (meeting-like) zone ids (default `ISOLATED_ZONE_IDS`). */
  zones?: readonly string[];
}

function isolatedZone(p: ProximityPlayer, zones: readonly string[]): string | null {
  return p.zoneId && zones.includes(p.zoneId) ? p.zoneId : null;
}

function within(a: ProximityPlayer, b: ProximityPlayer, radius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= radius * radius;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Partitions players into conversation groups (singletons included; filter `g.length > 1` if needed).
 * Players in the same isolated zone form one group; everyone else is grouped by connected components
 * of "within `radius`" (so A-B-C chains join). Ids are sorted inside a group and groups by first id.
 * Duplicate ids are ignored after their first occurrence.
 */
export function computeProximityGroups(
  players: readonly ProximityPlayer[],
  options: ProximityOptions = {},
): string[][] {
  const radius = options.radius ?? LIMITS.nearbyRadiusTiles;
  const zones = options.zones ?? ISOLATED_ZONE_IDS;

  const seen = new Set<string>();
  const list = players.filter((p) => !seen.has(p.id) && seen.add(p.id));
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] ?? r;
    let c = i;
    while (parent[c] !== r) {
      const next = parent[c] ?? r;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const zoneOf = list.map((p) => isolatedZone(p, zones));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const zi = zoneOf[i];
      const zj = zoneOf[j];
      const a = list[i];
      const b = list[j];
      if (!a || !b) continue;
      if (zi !== null || zj !== null) {
        if (zi === zj) union(i, j);
      } else if (within(a, b, radius)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, string[]>();
  list.forEach((p, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(p.id);
    else groups.set(r, [p.id]);
  });
  return [...groups.values()].map((g) => g.sort(byId)).sort((a, b) => byId(a[0] ?? '', b[0] ?? ''));
}

/**
 * Who hears a nearby-chat message from `sender` (sender excluded, input order kept):
 * - sender inside an isolated zone: exactly the other players in that zone (any distance);
 * - otherwise: players within `radius` who are not inside an isolated zone.
 */
export function nearbyRecipients(
  sender: ProximityPlayer,
  players: readonly ProximityPlayer[],
  radius: number = LIMITS.nearbyRadiusTiles,
  zones: readonly string[] = ISOLATED_ZONE_IDS,
): string[] {
  const senderZone = isolatedZone(sender, zones);
  const out: string[] = [];
  const seen = new Set<string>([sender.id]);
  for (const p of players) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const zone = isolatedZone(p, zones);
    const hears = senderZone !== null ? zone === senderZone : zone === null && within(sender, p, radius);
    if (hears) out.push(p.id);
  }
  return out;
}
