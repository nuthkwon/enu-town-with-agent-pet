import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Cursor } from '../http';

/** Epoch microseconds of a timestamptz column as text (full Postgres precision for cursors). */
export function epochMicros(col: AnyColumn): SQL<string> {
  return sql<string>`floor(extract(epoch from ${col}) * 1000000)::bigint::text`;
}

/** Keyset predicate for DESC order by (timestamp, uuid): rows strictly before the cursor. */
export function beforeMicros(col: AnyColumn, idCol: AnyColumn, c: Cursor | null): SQL | undefined {
  if (!c) return undefined;
  return sql`(floor(extract(epoch from ${col}) * 1000000)::bigint, ${idCol}) < (${c.k}::bigint, ${c.id}::uuid)`;
}

/** Keyset predicate for DESC order by (date, uuid). */
export function beforeDate(dateCol: AnyColumn, idCol: AnyColumn, c: Cursor | null): SQL | undefined {
  if (!c) return undefined;
  return sql`(${dateCol}, ${idCol}) < (${c.k}::date, ${c.id}::uuid)`;
}
