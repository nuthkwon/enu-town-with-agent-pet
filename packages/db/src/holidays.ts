import { krHolidays } from './schema/app';
import type { DbOrTx } from './client';

/** Loads the holiday calendar as a set of local date keys (YYYY-MM-DD). */
export async function loadHolidays(db: DbOrTx): Promise<Set<string>> {
  const rows = await db.select({ date: krHolidays.date }).from(krHolidays);
  return new Set(rows.map((r) => r.date));
}
