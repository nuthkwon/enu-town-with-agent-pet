import * as z from 'zod';
import {
  BODY_TYPES,
  DESK_IDS,
  HAIR_COLORS,
  HAIR_STYLES,
  LIMITS,
  OUTFIT_COLORS,
  PET_SPECIES,
  SKIN_TONES,
  TASK_STATUSES,
  VISIBILITIES,
} from '../constants';

export const avatarPresetSchema = z.object({
  body: z.enum(BODY_TYPES),
  hair: z.enum(HAIR_STYLES),
  hairColor: z.enum(HAIR_COLORS),
  outfit: z.enum(OUTFIT_COLORS),
  skin: z.enum(SKIN_TONES),
  wings: z.boolean().default(false),
});

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const profilePatch = z
  .object({
    display_name: z.string().min(1).max(LIMITS.displayNameMax),
    title: z.string().max(60).nullable(),
    status_text: z.string().max(LIMITS.statusTextMax).nullable(),
    avatar: avatarPresetSchema,
    pet_species: z.enum(PET_SPECIES),
    pet_name: z.string().min(1).max(LIMITS.petNameMax),
    default_log_visibility: z.enum(VISIBILITIES),
    default_chat_summary_visibility: z.enum(VISIBILITIES),
    share_dms_with_my_claude: z.boolean(),
    nudges_enabled: z.boolean(),
    nudge_min_interval_min: z.number().int().min(10).max(240),
    max_bubbles_per_day: z.number().int().min(0).max(30),
    quiet_start: hm,
    quiet_end: hm,
  })
  .partial();
export type ProfilePatch = z.infer<typeof profilePatch>;

export const onboardingSubmit = z.object({
  accept_notice_version: z.string().min(1),
  desk_id: z.enum(DESK_IDS).nullable(),
  avatar: avatarPresetSchema,
  pet_species: z.enum(PET_SPECIES),
  pet_name: z.string().min(1).max(LIMITS.petNameMax),
  default_chat_summary_visibility: z.enum(VISIBILITIES),
});
export type OnboardingSubmit = z.infer<typeof onboardingSubmit>;

export const workLogPatch = z
  .object({
    summary: z.string().min(1).max(LIMITS.workLogSummaryMax),
    tasks: z
      .array(
        z.object({
          title: z.string().min(1).max(LIMITS.workLogTaskTitleMax),
          status: z.enum(TASK_STATUSES),
          ref: z.string().max(LIMITS.workLogTaskRefMax).optional(),
        }),
      )
      .max(LIMITS.workLogTasksMax),
    blockers: z.array(z.string().min(1).max(LIMITS.workLogBlockerMax)).max(LIMITS.workLogBlockersMax),
    claude_chat_summary: z.string().max(LIMITS.claudeChatSummaryMax).nullable(),
    visibility: z.enum(VISIBILITIES),
    chat_summary_visibility: z.enum(VISIBILITIES),
  })
  .partial();
export type WorkLogPatch = z.infer<typeof workLogPatch>;

export const todoPatch = z.object({
  status: z.enum(['open', 'done', 'dismissed']).optional(),
  snoozed_until: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type TodoPatch = z.infer<typeof todoPatch>;

export const nudgeAction = z.object({
  action: z.enum(['ack', 'dismiss', 'snooze']),
  snooze_minutes: z.number().int().min(5).max(24 * 60).optional(),
});
export type NudgeAction = z.infer<typeof nudgeAction>;

export const claudeLinkRevoke = z.object({ link_id: z.string().optional() });

export const seatAssign = z.object({ desk_id: z.enum(DESK_IDS), user_id: z.string().nullable() });

/** Seat roster file (`config/seats.local.json`, gitignored; `config/seats.example.json` committed). */
export const rosterSchema = z.object({
  seats: z.array(
    z.object({
      deskId: z.enum(DESK_IDS),
      name: z.string().min(1).max(LIMITS.displayNameMax),
      avatar: avatarPresetSchema,
      pet: z.object({ species: z.enum(PET_SPECIES), name: z.string().min(1).max(LIMITS.petNameMax) }),
    }),
  ),
});
export type Roster = z.infer<typeof rosterSchema>;
