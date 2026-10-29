import { TOWN_EVENTS_CHANNEL, type TownEvent } from '@enu/shared';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from './client';

/**
 * Publishes a town event. Call it inside the same transaction as the write:
 * Postgres delivers NOTIFY only on commit, so listeners never see uncommitted state.
 */
export async function notifyTown(tx: DbOrTx, event: TownEvent): Promise<void> {
  await tx.execute(sql`select pg_notify(${TOWN_EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
}
