import { sql } from 'drizzle-orm';
import type { DbOrTx } from './client';

/**
 * Serializes concurrent writes of one owner within a scope (to-do cap, nudge daily cap, dedupe, pet cap, pet
 * replies) for the rest of the transaction.
 */
export async function lockOwnerScope(tx: DbOrTx, scope: string, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`enu-den:${scope}:${userId}`}))`);
}
