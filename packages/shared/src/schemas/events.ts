import * as z from 'zod';
import { LINK_STATES, VISIBILITIES } from '../constants';

/** Payloads sent on the `enu_den_events` NOTIFY channel (must stay well under 8000 bytes). */
export const townEvent = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('nudges_changed'), user_id: z.string() }),
  z.object({ v: z.literal(1), type: z.literal('todos_changed'), user_id: z.string() }),
  z.object({ v: z.literal(1), type: z.literal('profile_changed'), user_id: z.string() }),
  z.object({
    v: z.literal(1),
    type: z.literal('link_state_changed'),
    user_id: z.string(),
    state: z.enum(LINK_STATES),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('work_log_changed'),
    user_id: z.string(),
    log_id: z.string(),
    visibility: z.enum(VISIBILITIES),
    created: z.boolean(),
    /** Who wrote: the owner's Claude (`post_work_log`) or the owner on the web (PATCH/DELETE). */
    by: z.enum(['claude', 'user']),
  }),
  /** The owner's `activity_reports` row for today changed (post_activity, or sharing turned off). */
  z.object({ v: z.literal(1), type: z.literal('activity_changed'), user_id: z.string() }),
  z.object({ v: z.literal(1), type: z.literal('user_deactivated'), user_id: z.string() }),
  z.object({ v: z.literal(1), type: z.literal('desks_changed') }),
]);
export type TownEvent = z.infer<typeof townEvent>;

export function parseTownEvent(payload: string): TownEvent | null {
  try {
    const r = townEvent.safeParse(JSON.parse(payload));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
