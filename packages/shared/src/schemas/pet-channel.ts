import * as z from 'zod';
import { LIMITS, PET_CHANNEL, PET_REPLY_ROUTES, VISIBILITIES } from '../constants';

/**
 * The Claude Code pet channel (ADR 0006): the local `enu-den-channel` plugin talks to `/api/v1/pet-channel/*` with
 * a bearer token. Shared by the web routes and the plugin so both validate the same shapes.
 */

const IsoDateTime = z.iso.datetime({ offset: true });
const Visibility = z.enum(VISIBILITIES);

/** Pairing codes are 8 Crockford base32 characters, shown as `XXXX-XXXX`. */
export const PAIR_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Upper-cases and drops separators, so `k7qf-3mxp` and `K7QF3MXP` are the same code. */
export function normalizePairCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export const PET_CHANNEL_PLATFORMS = ['darwin', 'linux', 'win32', 'other'] as const;
export type PetChannelPlatform = (typeof PET_CHANNEL_PLATFORMS)[number];

export const petChannelPairInput = z
  .object({
    code: z.string().min(8).max(9),
    label: z.string().min(1).max(40).optional(),
    platform: z.enum(PET_CHANNEL_PLATFORMS),
    plugin_version: z.string().min(1).max(20),
  })
  .strict();
export type PetChannelPairInput = z.infer<typeof petChannelPairInput>;

export const petChannelPairOutput = z.object({
  token: z.string().startsWith(PET_CHANNEL.tokenPrefix),
  token_id: z.string(),
  link_id: z.string(),
  expires_at: IsoDateTime,
  /** Printed by the pairing command so the person sees which account they linked. */
  owner_display_name: z.string(),
});
export type PetChannelPairOutput = z.infer<typeof petChannelPairOutput>;

export const petChannelPollInput = z
  .object({
    wait_s: z.number().int().min(0).max(PET_CHANNEL.pollWaitMaxS).default(PET_CHANNEL.pollWaitMaxS),
    plugin_version: z.string().min(1).max(20),
  })
  .strict();
export type PetChannelPollInput = z.infer<typeof petChannelPollInput>;

export const petChannelPet = z.object({
  pet_id: z.string(),
  name: z.string(),
  is_default: z.boolean(),
  reply_route: z.enum(PET_REPLY_ROUTES),
  default_visibility: Visibility,
  /** The owner's own text to their own Claude; null when none. */
  role_instructions: z.string().nullable(),
});
export type PetChannelPet = z.infer<typeof petChannelPet>;

export const petChannelMessage = z.object({
  message_id: z.string(),
  pet_id: z.string(),
  /** The owner's local time with offset. */
  sent_at: IsoDateTime,
  text: z.string(),
  visibility: Visibility,
  /** Reply parts already stored for this message (a resumed session continues with the next part). */
  replies_so_far: z.number().int().min(0),
});
export type PetChannelMessage = z.infer<typeof petChannelMessage>;

export const petChannelPollOutput = z.object({
  messages: z.array(petChannelMessage).max(PET_CHANNEL.pollBatchMax),
  pets: z.array(petChannelPet),
  token_expires_at: IsoDateTime,
});
export type PetChannelPollOutput = z.infer<typeof petChannelPollOutput>;

export const petChannelReplyInput = z
  .object({
    in_reply_to: z.uuid(),
    part: z.number().int().min(1).max(LIMITS.petRepliesPerMessageMax).default(1),
    text: z
      .string()
      .min(1)
      .max(LIMITS.petReplyMax * 2),
    visibility: Visibility.optional(),
  })
  .strict();
export type PetChannelReplyInput = z.infer<typeof petChannelReplyInput>;

export const petChannelReplyOutput = z.object({
  result: z.enum(['created', 'duplicate', 'skipped_owner_deleted']),
  message_id: z.string().nullable(),
  visibility: Visibility.nullable(),
});
export type PetChannelReplyOutput = z.infer<typeof petChannelReplyOutput>;

/** Tool inputs the plugin shows to Claude (snake_case, no user id). */
export const channelReplyToolInput = z.object({
  pet_id: z.uuid(),
  in_reply_to: z.uuid(),
  text: z.string().min(1).max(LIMITS.petReplyMax),
  visibility: Visibility.optional(),
});
export type ChannelReplyToolInput = z.infer<typeof channelReplyToolInput>;

export const channelStatusToolInput = z.object({});
