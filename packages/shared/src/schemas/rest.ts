import * as z from 'zod';
import {
  BODY_TYPES,
  DESK_IDS,
  HAIR_COLORS,
  HAIR_STYLES,
  LIMITS,
  OUTFIT_COLORS,
  PET_EXTRA_TINTS,
  PET_REPLY_ROUTES,
  PET_SPECIES,
  PET_TINTS,
  SKIN_TONES,
  TASK_STATUSES,
  TEAM_IDS,
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
    team: z.enum(TEAM_IDS).nullable(),
    role_note: z.string().max(80).nullable(),
    status_text: z.string().max(LIMITS.statusTextMax).nullable(),
    avatar: avatarPresetSchema,
    pet_species: z.enum(PET_SPECIES),
    pet_name: z.string().min(1).max(LIMITS.petNameMax),
    default_log_visibility: z.enum(VISIBILITIES),
    default_chat_summary_visibility: z.enum(VISIBILITIES),
    share_dms_with_my_claude: z.boolean(),
    /** 활동 공유: Claude-derived activity may be shown to colleagues. `false` deletes today's report. */
    share_activity: z.boolean(),
    /** 접속 표시: having the town open may draw me and my online dot. */
    show_live: z.boolean(),
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
  /** Explicit choice required (the wizard preselects nothing); `true` records the activity_sharing consent. */
  share_activity: z.boolean(),
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
  snooze_minutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
});
export type NudgeAction = z.infer<typeof nudgeAction>;

/**
 * Pets (docs/design/messenger-spec.md §4). Raw strings may be up to twice the limit: the server normalizes, then
 * rejects anything still over the limit (never cuts).
 */
const petName = z
  .string()
  .min(1)
  .max(LIMITS.petNameMax * 2);
const petRoleInstructions = z
  .string()
  .max(LIMITS.petRoleInstructionsMax * 2)
  .nullable();

export const petCreate = z
  .object({
    name: petName,
    species: z.enum(PET_SPECIES),
    /** Extra pets never use the `base` look, which is reserved for each person's default pet. */
    tint: z.enum(PET_EXTRA_TINTS),
    role_instructions: petRoleInstructions.default(null),
    reply_route: z.enum(PET_REPLY_ROUTES).default('both'),
    /** null: follow my profile default. */
    default_visibility: z.enum(VISIBILITIES).nullable().default(null),
  })
  .strict();
export type PetCreate = z.infer<typeof petCreate>;

export const petPatch = z
  .object({
    name: petName,
    species: z.enum(PET_SPECIES),
    tint: z.enum(PET_TINTS),
    role_instructions: petRoleInstructions,
    reply_route: z.enum(PET_REPLY_ROUTES),
    default_visibility: z.enum(VISIBILITIES).nullable(),
    sort_order: z.number().int().min(0).max(99),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' });
export type PetPatch = z.infer<typeof petPatch>;

export const petMessageSend = z
  .object({
    text: z
      .string()
      .min(1)
      .max(LIMITS.petMessageMax * 2),
    client_msg_id: z.string().min(8).max(64),
    /** Omitted: the pet's default, else my profile default. */
    visibility: z.enum(VISIBILITIES).optional(),
  })
  .strict();
export type PetMessageSend = z.infer<typeof petMessageSend>;

export const petMessagePatch = z.object({ visibility: z.enum(VISIBILITIES) }).strict();
export type PetMessagePatch = z.infer<typeof petMessagePatch>;

export const petRead = z.object({ last_message_id: z.uuid() }).strict();
export type PetRead = z.infer<typeof petRead>;

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
      team: z.enum(TEAM_IDS).optional(),
      /** 직위, e.g. 과장 / 대리 / 사원 / 대표이사. */
      title: z.string().max(60).optional(),
      /** Short role description, e.g. 'SQA·V&V·형상 감사'. */
      role: z.string().max(80).optional(),
    }),
  ),
});
export type Roster = z.infer<typeof rosterSchema>;

/** Body of the development-only sign-in endpoint (`/api/auth/dev/login`, never enabled in production). */
export const devLoginBody = z.object({
  email: z.email(),
  oauth_query: z.string().optional(),
});
