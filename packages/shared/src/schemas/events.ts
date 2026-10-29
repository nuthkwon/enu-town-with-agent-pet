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
  /** Something changed in one of the owner's pet rooms (a message, a reply, a hide, a read). Ids only. */
  z.object({
    v: z.literal(1),
    type: z.literal('pet_thread_changed'),
    user_id: z.string(),
    pet_id: z.string(),
  }),
  /** The owner created, edited or deleted a pet. */
  z.object({ v: z.literal(1), type: z.literal('pets_changed'), user_id: z.string() }),
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
