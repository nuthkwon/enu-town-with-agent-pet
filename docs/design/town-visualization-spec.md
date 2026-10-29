# ENU Town as a visualization of teams at work: final spec

Status: accepted design (2026-10-29). Written by a design panel (three independent designs plus a lead draft, a judge
synthesis and a review pass; see "Review resolutions" at the end) against the repo at `84f90e4`.
Candidates referenced below: **T** (truthfulness and privacy first), **A** (liveliness first), **Le** (smallest change
first) and **L** (lead draft). ADR 0004 records the binding decisions; this document is the implementation contract.

**Owner intent:** "사용자가 직접 키를 통해 움직이는 것이 아닙니다. 팀들이 업무를 하고 상호작용하는 것을 시각화하기 위함입니다."
Nobody steers an avatar. A server-side **director** places all roster members from their own signals:
- the owner's own status choice;
- the owner having the town open (unless the owner turned `접속 표시` off);
- the owner's own Claude: accepted calendar blocks place the avatar; a "now" report (new MCP tool) and today's work
  log only **label** an avatar or desk plate, they never draw a person who is not otherwise shown.

Viewers watch, click people, chat and DM. Interactions appear only when they are human-initiated and public (wave,
room chat), or when each person's own Claude independently reported the same meeting or work item (mutual
corroboration).

**Base and grafts.** The spec starts from **T**, which has the best truthfulness and privacy core and pure-function
architecture. It takes the following from the other candidates:
- from **Le**: the smallest-change mechanics (keep `Player`, keep pet bubble fields, spots derived from the existing
  map, no new free text, a state counter instead of a new FX message);
- from **A**: "meetings gather by default", "one in-room meeting", the shared projection being neutral after hours,
  sleeping pets, explicit-choice consent, the overview crop and the docked team list;
- from **L**: overview fit, and the same menus on avatars and desks.

---

## 0. Decisions and conflict resolution

| # | Topic | Candidates | **Decision** | Why |
|---|---|---|---|---|
| D1 | Who appears | T: live or Claude signal; A: manual, block or live (visible tab within 30 min); Le: live, or "seen today", or any log; L: live, or MCP write within 90 min | **§2.2 is normative.** In short: **shown** = office open ∧ (manual non-`away` status ∨ (¬manual `away` ∧ ¬(share ∧ calendar `away` block) ∧ ((share ∧ current meeting/focus block) ∨ (live ∧ `show_live`)))). A fresh `now` report or today's log never draws an avatar; it only labels a shown avatar or the desk plate | Truthful (each case has a source). An avatar appears only through the owner's own act (a status, opening the town) or their accepted calendar, never through Claude's judgement of recent work, private logs, tab focus or MCP call times |
| D2 | Tab visibility as a presence signal | A: yes; T/Le: no | **No.** It drives owner-only pet timing only | Attention tracking is 근로자 감시 |
| D3 | Free text from Claude on the map (headline / label) | T: 40-char headline; A/L: 24-char label; Le: none | **None.** The new tool takes enums, times and opaque refs only. "What they're doing" stays the existing work log (verbatim, `canViewLog`) | Smallest. No new PII/URL surface. Verbatim rule trivially kept |
| D4 | Sharing levels | T: off/basic/detailed, default basic; A: off/schedule/full, default off; Le: boolean, default on | **One owner choice `share_activity`**: `null` = not chosen = off, `true`, `false`. An **explicit** choice is required in the re-consent step (nothing preselected) | Mirrors the existing `default_chat_summary_visibility` null semantics. Consent in an employment relationship must be explicit. No detail level exists to gate because D3 removed the text |
| D5 | Grouping (who is with whom) | T: mutual and all `detailed`; A: mutual, meetings at `schedule`; Le: co-locate anyone in a meeting; L: Claude names a colleague | **Mutual corroboration only.** Every member has sharing on and their own Claude reported the same ref. **Meetings need ≥ 3 members** (server-enforced). Same-work groups need ≥ 2 and are gathered only when ≤ 3 and every member is shown; larger or partly hidden groups are linked, not gathered | Le misdraws unrelated meetings as one. L lets A's Claude make claims about B. The minimum of 3 stops 1:1s (면담) from ever being drawn as a pair |
| D6 | Two meetings at once | T: both share the table; A: the largest gets the room | **The largest group (tie: smallest group id) sits at the table.** Other groups stay at their desks with a dotted link | One physical table. Avoids implying one big meeting |
| D7 | Arrival and leaving | A: door walk for the first arrival; Le: walk in and out; T: sparkle in place | **Sparkle in place, no door walks.** The pet perches at the desk while the owner is hidden | Opening a tab is not entering the building |
| D8 | After hours | T: per-client StateView, self only; A: everyone absent in shared state; Le: online people still shown | **Shared state is neutral for everyone** (`officeOpen=false`, all hidden, pets asleep). Not even the viewer's own avatar is drawn | One projection for all. No "who stays late". No collection-level view filtering |
| D9 | Pet bubble privacy plumbing | T: new `PetBubble` collection | **Keep the existing `.view()` fields on `Pet`.** `pets` stays unfiltered and each client's view contains only its own pet (already true today) | D8 removes the need for collection filtering, so there is less churn |
| D10 | Naming | T: `Avatar`; A: `Person` | **Keep `Player`/`players`** with a doc comment ("roster member, not a connected player") | No churn in web or tests |
| D11 | Map spots | T/A: a new `spots` object layer (map hash changes) | **Derive spots from existing tiles and zones** (Le). No map regeneration | Lower risk |
| D12 | Pet triggers | T: `eligible` and `back_at_desk`; A: `glance` and `block_end`; Le: keep `idle`, re-armed on settle | **Remove `idle`. Add `eligible`** (first showing of a nudge whose `show_after` passed) **and `glance`** (tab visible again after ≥ 10 min hidden). DND defers `eligible` until a meeting or focus ends, which gives "block end" for free | No director-to-scheduler coupling |
| D13 | Help flag, hand-off flights, ticker, task-done pop, team counts | A/Le: various | **Not in v1** (open questions 4–6) | Could read as performance signals or history. Smallest |
| D14 | DM / work request visual | A/Le: a paper plane for the 2 participants only; L: public visit walk | **Participant-only paper plane, drawn client-side from `dm:msg`** | No relationship metadata leaks to third parties |
| D15 | Nearby chat and `user_presence` | T/A: drop now; Le: keep until retention | **Drop now.** Delete the nearby rows, drop `chat_message_recipients`, `user_presence` and `chat_messages.zone_id` | The feature is meaningless without steering. Data minimization |
| D16 | New tool vs. extending `post_work_log` | L: extend; others: new tool | **New 5th tool `post_activity`** | Clean "now and schedule" semantics, independent of log-edit skips |
| D17 | Ref hashing | T/A: HMAC with a new env secret | **HMAC-SHA256 with a key derived via HKDF from the existing `BETTER_AUTH_SECRET`**, salted with the office day (`APP_TIMEZONE`), 32 hex characters | No new config. Unlinkable across days. Not a secret against whoever holds `BETTER_AUTH_SECRET` (low-entropy refs can be brute-forced), and the notice says so (§8.1) |
| D18 | Camera | T: fit with 1.5 allowed; A: crop the balcony to 1.5; Le: integer only | **Overview of rows 4–21 (704×576 px).** Zoom steps {1, 1.5, 2, 3, 4}. Never auto-follow | 1.5× in a maximized 1080p browser (free area ≈ 1600×894 ≥ 1056×864). Rows 0–3 (balcony, window wall) and 22 (entrance wall) hold no spot |
| D19 | Break | T: none; A/Le: manual break goes to the pantry | **Manual `break` only, to a pantry spot** | Owner-declared, so truthful. Gives the pantry meaning |
| D20 | `work_mode` (재택/외근 badges) | T: yes | **No.** Calendar `away` covers 외근/휴가/반차 as "부재"; remote workers sit at their virtual desk | Smallest. Never shows a reason |
| D21 | Looking without being seen | review | **Reciprocal by default, persistent opt-out.** New owner setting `show_live` (`접속 표시`, default on). Off: opening the town never draws me or my online dot; only a status I set or my accepted calendar does | Someone on leave can check the town without appearing, without a daily `자리 비움` that itself draws a plate note |

### Principles (binding for every section)
- **P1 Every visible state has a source**, and the source is shown (labels in §5.3). Only exception: `부재` shows
  neither a source nor an end time.
- **P2 Position means work state, not physical location.** No random walks, invented breaks or fake typing on absent
  people. There is no "where" field (`zoneId` is deleted).
- **P3 Each person's state comes only from their own sources.** Links between people exist only through mutual corroboration (D5).
- **P4 Current state only.** ENU Town stores no presence or activity timeline: `activity_reports` holds the current
  day only, audit rows carry no activity metadata, logs carry no per-user connection lines, and colleague-facing
  REST carries no status or activity timestamps. Admins have no extra view.
- **P5 Office hours only** (business days 08:30–19:30, `kr_holidays`). **The office day is `APP_TIMEZONE`**
  (default Asia/Seoul) for every town rule: office hours, `period_key`, ref salt, block validation, manual-status
  expiry, purge and client `~HH:MM` formatting. Owner time zones are not used by the town.
- **P6 The owner wins.** Manual status beats Claude. Turning sharing off deletes today's Claude activity immediately.
- **P7 Everyone sees the same projection**, the owner included.
- **P8 One place decides what colleagues see:** `packages/domain/src/visibility.ts` (`projectForColleagues`, §3.2).
  `resolveActivity` computes the owner's state; the projection decides what of it is shown.

---

## 1. Presence model

### 1.1 Roster and actors
- **Roster** = `user.status='active'` ∧ a `profiles` row ∧ `profiles.onboarding_completed_at IS NOT NULL`. It is loaded
  when the room is created, on `profile_changed` / `desks_changed` / `user_deactivated`, and on the 5-minute resync.
- **Every roster member is an actor**: one `Player` and one `Pet` in `state` (14 entries), whether or not anyone is
  connected. Connections (sessions) are tracked separately and only feed the `live` and `connected` inputs.
- **Actors are created only by `loadRoster`** and are **mutated in place, never replaced** (the owner's `StateView`
  holds the `Pet` instance; §6.6). A user outside the roster never becomes an actor.
- **People without a desk** have no plate. They are drawn only while `shown`, on a guest spot (the `world.spawn`
  tiles, §2.3), and their pet is hidden while they are hidden.

### 1.2 Signals
Evaluated by `resolveActivity` (§2). Only these inputs exist:

| Signal | Source | Gate | Effect |
|---|---|---|---|
| Manual status (not expired) | owner, `status:set` | none (owner's own act) | draws (`away`: hides) |
| Live | a session exists (including the 20 s `onDrop` hold), or < 60 s since the session ended | `canShowLive` (`show_live`, default on; D21) | draws |
| Calendar `meeting` / `focus` / `away` block covering now | owner's Claude → `post_activity.schedule` | `canShareActivity` | draws (`away`: hides) |
| Fresh `now` report (`now < until`) | owner's Claude → `post_activity.now`: **the kind of work the owner's own Claude judged from recent work traces** (documents, commits, PRs, reviews) | `canShareActivity` | **label only** |
| Today's log is colleague-visible and has a task with status `done`, `in_progress` or `blocked` | owner's Claude → `post_work_log` | `canShareActivity` ∧ `canViewLog(ANY_COLLEAGUE, …)` | **label only** |

**Never used by ENU Town:**
- tab visibility
- keyboard or mouse input
- e-mail, commit or MCP call timestamps (ENU Town never receives them; only the owner's Claude sees the owner's
  tools, and it sends a `now` *kind*, which is disclosed as "Claude 보고" in the legend and the notice)
- link state
- private logs
- planned-only logs

A label never makes someone appear, so a `now: null` at the next check-in only removes a label; it never makes a
person vanish. The skill's "기록할 업무 활동이 적음" log has no tasks, so a sick day where Claude still ran draws no label.

### 1.3 Hidden people (desk plates)
| `note` | When | Plate text (ko) |
|---|---|---|
| `away` | manual `away` | `자리 비움 · ~15:00`, plus the owner's own 상태 문구 if set |
| `absent` | calendar `away` block covering now (beats live; see D1) | `부재` only (no end time, no source, never a reason) |
| `none`, with a label | a fresh `now` or today's log, owner not otherwise shown | icon + `<activity ko> · <source ko>` (+ `~HH:MM` for `now`) |
| `none` | no signal | name only (no "미접속" shaming) |

### 1.4 Arrival, leaving, off-hours
- **Hidden → shown:** the avatar is placed at its target spot. The client plays the existing sparkle and a 600 ms
  scale-in next to the perched pet.
- **Shown → hidden:** sparkle-out where the avatar stands. The pet flies to its desk perch.
- No door walks. Nothing is recorded.
- **Closed phase** (`!isOfficeOpen`):
  - `state.officeOpen=false`;
  - every `Player` is written to `NEUTRAL_PROJECTION` (`shown=false`, `online=false`, `activity=0`, `source=0`,
    `until=0`, `note=0`, `groupId=''`, `statusText=''`); `logPulse` is not bumped;
  - pets sleep at their desks (`Anim.Sleep`), every `Pet.indicator` is `None`, and pet bubbles are off for everyone,
    owners included (forced quiet, §5.7);
  - the client shows a night tint and the banner `근무 시간이 아니에요 · 요정들도 쉬는 중 (평일 08:30–19:30에만 동료 상태가 보여요)`;
  - room chat and DMs keep working, but no chat bubbles are drawn over avatars.
- Dev and e2e only: `TOWN_IGNORE_OFFICE_HOURS=true` (realtime env). The env schema refuses it in production, like
  `NUDGE_IGNORE_QUIET_HOURS`.

---

## 2. Activity model, precedence and pure functions

### 2.1 Shared constants (`packages/shared/src/constants.ts`)
```ts
export const NOW_KINDS = ['work', 'docs', 'review', 'collab'] as const;          // Claude "now"
export type NowKind = (typeof NOW_KINDS)[number];
export const SCHEDULE_KINDS = ['meeting', 'focus', 'away'] as const;               // Claude calendar blocks
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export const MANUAL_STATUSES = ['available', 'focus', 'meeting', 'break', 'away'] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];
export const MANUAL_DURATIONS = ['30m', '1h', '2h', 'today'] as const;
export type ManualDuration = (typeof MANUAL_DURATIONS)[number];
/** scheme:id, e.g. gcal:<iCalUID>, jira:ENU-123, github:owner/repo#45, drive:<fileId>.
 *  The id part is any printable ASCII except space ([!-~]), so iCalUIDs with + = { } pass. */
export const WORK_REF_PATTERN = /^[A-Za-z][A-Za-z0-9-]{1,15}:[!-~]{1,180}$/;
export const TOWN_TIMING = {
  directorTickMs: 1_000, liveGraceMs: 60_000, moveStaggerMs: 350,
  meetingGroupMin: 3, workGroupGatherMax: 3,
} as const;
// LIMITS additions
scheduleBlocksMax: 16, scheduleBlockMaxHours: 10, nowDefaultMin: 90, nowMaxMin: 120,
// LIMITS removal: nearbyRadiusTiles
// MCP_TOOL_NAMES.postActivity = 'post_activity'
// INSTRUCTIONS_VERSION = '2026-11-02.1'; PRIVACY_NOTICE_VERSION = '2026-11'
// CHAT_KINDS stays ['dm','room','nearby'] for reading the pg enum; add WRITABLE_CHAT_KINDS = ['dm','room']
// NUDGE_POLICY: delete idleMs, add glanceHiddenMs: 600_000 (the only copy; PolicyTiming.glanceHiddenMs defaults to it)
```
All town "today" logic uses `APP_TIMEZONE` (P5); there is no per-owner time zone in this feature.

### 2.2 Precedence (normative; first match wins)
Row 1 is applied by `projectForColleagues` (§3.2); rows 2–10 by `resolveActivity`.

| # | Condition | shown | note | activity | source | until | groupKey |
|---|---|---|---|---|---|---|---|
| 1 | `!officeOpen` | `NEUTRAL_PROJECTION` for everyone | | | | | |
| 2 | manual `away` | no | away | none | manual | manual.until | – |
| 3 | manual `available`/`focus`/`meeting`/`break` | yes | none | = status | manual | manual.until | meeting key if status=`meeting` ∧ share ∧ current meeting block has a ref |
| 4 | share ∧ current block `away` | no | absent | none | calendar | block.end (owner-internal; the projection writes 0 and source None) | – |
| 5 | share ∧ current block `meeting` | yes | none | meeting | calendar | block.end | meeting key if `refHash` |
| 6 | share ∧ current block `focus` | yes | none | focus | calendar | block.end | – |
| 7 | share ∧ `now` fresh | **= live** (label only) | none | `now.kind` | claude | now.until | work key if `refHash` |
| 8 | share ∧ log colleague-visible ∧ `hasWorkTask` | **= live** (label only) | none | today | work_log | – | – |
| 9 | live | yes | none | none | town | – | – |
| 10 | otherwise | no | none | none | none | – | – |

- `share = canShareActivity(...)` and `live = canShowLive(...) ∧ (session exists ∨ now − sessionEndedAt < liveGraceMs)`
  are computed by the Director through `visibility.ts`. "Session exists" includes the 20 s `onDrop` hold;
  `sessionEndedAt` is when the session is removed (consented leave, or hold expiry).
- Rows 7–8 with `live=false` give a hidden person with a plate label (§1.3); with `live=true` they label the avatar.
- `currentBlock`: blocks with `start ≤ now < end`. Rank `away > meeting > focus`; ties go to the earliest start, then the earliest end.
- `dnd = activity ∈ {focus, meeting}` (pet bubbles only).
- `online`, `until` masking, `statusText` and office hours are projection rules (§3.2), not precedence rows.
- **Manual status never outlives the office day** (`APP_TIMEZONE`). `manualStatusUntil` handles this:
  - `30m`/`1h`/`2h` → now + d, capped at the next office-day midnight;
  - `today` → today's `WORK_HOURS.end`; if that has passed, now + 1 h, capped at midnight.
  - Default `1h`. `auto` clears `manual_status` and `manual_status_until` only (상태 문구 stays).

### 2.3 Pure functions
`packages/domain/src/activity.ts` (new, re-exported):
```ts
export type ActivityName = 'none'|'available'|'focus'|'meeting'|'break'|'work'|'docs'|'review'|'collab'|'today';
export type ActivitySource = 'none'|'manual'|'calendar'|'claude'|'work_log'|'town';
export type PlateNoteName = 'none'|'away'|'absent';
export interface ScheduleBlockIn { start: Date; end: Date; kind: ScheduleKind; refHash: string | null }
export interface NowIn { kind: NowKind; refHash: string | null; until: Date }
export interface ActivityInputs {
  now: Date;
  live: boolean;                                                 // already gated by canShowLive() (§2.2)
  manual: { status: ManualStatus; until: Date } | null;          // expired => ignored
  share: boolean;                                                // from canShareActivity()
  report: { now: NowIn | null; schedule: readonly ScheduleBlockIn[] } | null;  // today's row (office day) only
  todayLog: { colleagueVisible: boolean; hasWorkTask: boolean } | null;
}
export interface ResolvedActivity {
  shown: boolean; note: PlateNoteName; activity: ActivityName; source: ActivitySource;
  until: Date | null; groupKey: { family: 'meeting' | 'work'; hash: string } | null; dnd: boolean;
}
export function resolveActivity(i: ActivityInputs): ResolvedActivity;   // rows 2–10; never reads the clock
export function currentBlock(blocks: readonly ScheduleBlockIn[], now: Date): ScheduleBlockIn | null;
export function isOfficeOpen(now: Date, timeZone: string, holidays: ReadonlySet<string>, ignore?: boolean): boolean;
export function manualStatusUntil(now: Date, timeZone: string, d: ManualDuration): Date;
export function hasWorkTask(tasks: readonly { status: string }[]): boolean;    // done|in_progress|blocked
```

`packages/domain/src/groups.ts` (new):
```ts
export interface GroupMember { userId: string; deskId: string | null; activity: ActivityName; shown: boolean;
  key: ColleagueProjection['groupKey'] }                            // the projected key (§3.2)
export interface ActivityGroup { id: string; family: 'meeting' | 'work'; members: readonly string[];
  hostId: string | null; gather: boolean }
export function groupPeople(people: readonly GroupMember[],
  o: { periodKey: string; deskOrder: readonly string[]; meetingSeats: number }): ActivityGroup[];
```
`groupPeople` rules:
1. Bucket people by `family + hash`. A meeting bucket is a group when it has ≥ `meetingGroupMin` (3) members; a work bucket when it has ≥ 2.
2. Members are sorted by desk order (people without a desk last), then userId.
3. `id = 'g' + fnv1a32(periodKey|family|members).toString(36)`. The id is opaque, stable within the day and contains no hash material.
4. `gather` for meetings is true only for the largest meeting group (tie: smallest id), and only if its size ≤ `meetingSeats`.
5. `gather` for work groups is true iff size ≤ `workGroupGatherMax` (3), every member is `shown`, and a host exists.
   The host is the only member whose activity is not `review` and who has a desk; otherwise it is the first member
   with a desk. Reviewers visit authors. Groups that do not gather are drawn as dotted links between the members'
   avatars or desk plates.
6. Output is sorted by id.
7. Each group's `until` (for the chip `~HH:MM`) is the latest `until` among its members; the client derives it from
   the members' `Player.until`.

`packages/domain/src/hash.ts`: `fnv1a32(s: string): number` (about 10 lines, no crypto).

`packages/map/src/spots.ts` (new, pure; spatial only):
```ts
export interface Spot { x: number; y: number; facing: Facing }
export interface OfficeSpots { meetingSeats: readonly Spot[]; breakSpots: readonly Spot[]; guestSpots: readonly Spot[];
  visitorTiles(deskId: string): readonly Spot[]; perch(deskId: string): Spot }
export type SpotIntent = { kind: 'desk' } | { kind: 'meeting' } | { kind: 'visit'; hostDeskId: string }
  | { kind: 'break' } | { kind: 'guest' };
export function buildSpots(map: TiledMap, world: OfficeWorld): OfficeSpots;
export function allocateSpots(world: OfficeWorld, spots: OfficeSpots,
  req: readonly { userId: string; deskId: string | null; intent: SpotIntent; current: Spot | null }[],
): Map<string, Spot & { fallback: boolean }>;
```

How `buildSpots` derives each spot list from the existing map:
- **Meeting seats:** `furniture` tiles named `meeting_chair` inside the `meeting` zone, each facing its 4-adjacent `meeting_table`, in (y, x) order. On today's map that is 12 seats: (3–6, 18) facing down, (2, 19–20) facing right, (7, 19–20) facing left, (3–6, 21) facing up.
- **Break spots:** walkable `pantry` tiles in (y, x) order, facing down.
- **Guest spots:** the walkable tiles of `world.spawn.tileRect` (today (10–11, 21)), facing up. There is no second
  definition: `chooseSpawn` is deleted and the spawn rect stays only as the validator's reachability origin.
- **Visitor tiles:** the walkable W, E and N/S neighbours of the seat that are not a seat or a chair, facing the seat. Checked: every desk, including R1, has ≥ 1.
- **Pet perch** (`perch(deskId)`): the desk-surface tile the seat faces (seat + facing), with the seat's facing. Pets
  fly, so a blocked tile is fine; the seat stays free for the owner.

`allocateSpots` rules:
- It is deterministic (processing order: desk, meeting, visit, break, guest, then userId).
- Current holders keep their spot.
- No two people get the same tile.
- Meeting, visit or break overflow falls back to the person's own desk (`fallback: true`).
- A person with no desk whose request overflows (break or guest) gets the nearest free walkable tile by BFS from the
  guest spots (fixed neighbour order up, right, down, left), facing up (`fallback: true`). Allocation is total.

`OfficeWorld` gains `readonly spots: OfficeSpots`, filled by `loadOfficeWorld`.

---

## 3. Interaction visualization and privacy matrix

### 3.1 What is drawn
| Visual | Data | Gate | Seen by |
|---|---|---|---|
| **Meeting gathering**: members walk (staggered 350 ms) to the meeting chairs, with a soft hull under the group and a chip `회의 중 · N명 · ~11:00` (latest member `until`) with team-colour dots | ≥ 3 people whose own Claudes sent a `meeting` block with the same `gcal:<iCalUID>` ref covering now (or a manual `meeting` plus such a block) | every member `canShareActivity`; `gather` | all viewers (office hours) |
| Meeting not gathered (smaller group, second meeting, or group > 12) | same | same | all; drawn at desks with a headset icon and a dotted link between members |
| **Same work item**: visitors stand at the host's desk on a visitor tile, with a short dotted link and the chip `같은 작업` | 2–3 **shown** people with fresh `now` reports carrying the same ref | every member `canShareActivity` | all; otherwise (larger, or someone hidden) a dotted link between avatars or plates |
| Solo meeting / focus / work kinds | own block or `now` | `canShareActivity` | all; icon over the head, or on the plate when hidden (§5.4) |
| **Wave** `손 흔들기` | a human click (`social:wave {toUserId}`) | office open, sender and target shown | all (the menu says `모두에게 보여요`) |
| **Room chat** | human-typed text | — | all; bubble over the sender only if shown |
| **Work-log sparkle** | `work_log_changed {by:'claude'}` where the log is colleague-visible | `by='claude'` ∧ office open ∧ owner shown ∧ `canShareActivity` ∧ `canViewLog(ANY_COLLEAGUE)` | all (via `Player.logPulse`) |
| **DM / work request paper plane** | `dm:msg` (already delivered only to the two people) | — | **the 2 participants only** (client-side) |
| **Ping** `부르기` | a human click | target `online` (server-checked, §6.4) | target only (toast with `DM 열기`) |
| **Pet bubble** | Claude-authored text, verbatim | owner | owner only; others see `…` only while the owner is shown |

**Never visualized:**
- DM, work-request or ping metadata for third parties
- future blocks and block titles
- attendee lists (never collected)
- ref values
- one-sided claims about colleagues (no Claude names a colleague; there is no `with` field)
- 1:1 meetings (the skill omits their refs, and the server requires ≥ 3)
- anything after hours
- history of any kind

### 3.2 `packages/domain/src/visibility.ts` additions (the only visibility decisions)
```ts
/** Viewer that is "any active colleague" (never equals an owner id). */
export const ANY_COLLEAGUE: Viewer = { userId: '' };
/** Claude-derived activity (calendar blocks, now reports, log-derived labels and sparkle) may be shown. */
export function canShareActivity(owner: { shareActivity: boolean | null }, author: AuthorState): boolean;
//   = author.active && owner.shareActivity === true
/** Having the town open may draw the owner and their online dot (D21). */
export function canShowLive(owner: { showLive: boolean }): boolean;          // = owner.showLive
/** Exact work-log timestamps (claudeWrittenAt, updatedAt, userEditedAt) are for the owner only. */
export function canViewLogTimestamps(viewer: Viewer, ownerId: string): boolean;   // = viewer.userId === ownerId

export interface ProjectionCtx {
  officeOpen: boolean;
  connected: boolean;      // socket open now (no grace, no onDrop hold) ∧ canShowLive(owner)
  share: boolean;          // canShareActivity(owner, author)
  statusText: string;      // the owner's 상태 문구 ('' if none)
}
export interface ColleagueProjection {
  shown: boolean; online: boolean; note: PlateNoteName; activity: ActivityName; source: ActivitySource;
  until: Date | null; statusText: string; groupKey: ResolvedActivity['groupKey'];
}
export const NEUTRAL_PROJECTION: ColleagueProjection;
/** The only function that decides what colleagues (and, by P7, the owner) see in shared state. */
export function projectForColleagues(r: ResolvedActivity, c: ProjectionCtx): ColleagueProjection;
```
`projectForColleagues` rules:
1. `!officeOpen` → `NEUTRAL_PROJECTION`.
2. `online = connected ∧ r.shown` (no grace: a ping to an `online` person always reaches an open socket).
3. `note = absent` → `until = null`, `source = 'none'` (never the leave's end time).
4. `statusText` = the owner's text while `r.shown ∨ r.note = away`; otherwise `''`.
5. `groupKey = share ? r.groupKey : null`, so a group can only contain members who all share ("group requires every
   member").
6. Everything else is copied from `r`.

Log-derived signals reuse `canViewLog(ANY_COLLEAGUE, log, author)`. The Director calls `canShareActivity`,
`canShowLive` and `projectForColleagues`; `resolveActivity` and `groupPeople` make no visibility decision of their own.

### 3.3 Privacy matrix
| Data item | Owner | Colleague (office hours) | Anyone after hours | Admin | Owner's Claude | Stored |
|---|---|---|---|---|---|---|
| Shown / hidden, plate note | ✓ (same projection) | ✓ | ✗ (neutral state) | = colleague | `owner_status` only | not stored (computed) |
| Online dot | ✓ | ✓ only if shown, connected (no grace) and `show_live` | ✗ | = colleague | ✗ | not stored (memory) |
| Manual status + until | ✓ | ✓ | ✗ | = colleague | status and until | `profiles` current value; the worker clears it after expiry |
| 상태 문구 (human-typed) | ✓ | ✓ only while shown or `자리 비움` | ✗ | = colleague | ✗ | `profiles` current value until the owner changes it |
| Calendar-derived 회의/집중 + until; 부재 (no until, no source) | ✓ | ✓ if share | ✗ | = colleague | ✓ (own list) | `activity_reports`, today; purged next day |
| Full list of today's blocks | ✓ (StatusMenu, export) | ✗ | ✗ | ✗ | ✓ | today |
| `now` kind + until (label only) | ✓ | ✓ if share | ✗ | = colleague | ✓ | today |
| Ref values | ✗ (keyed hash only) | ✗ | ✗ | ✗ | `has_ref` only | 32-hex HMAC, today |
| Group membership | ✓ | ✓ if every member shares and refs match | ✗ | = colleague | ✗ (never told who matched) | not stored (derived) |
| Log-derived "오늘" label + sparkle | ✓ | ✓ if log company-visible ∧ share (sparkle: Claude writes only, owner shown) | ✗ | = colleague | n/a | derived |
| Pet `…` indicator | ✓ | ✓ only while the owner is shown | ✗ | = colleague | ✗ | not stored |
| Work log, chat summary | `canViewLog` / `canViewChatSummary` (unchanged) | | | | | 90 d (unchanged) |
| Work-log timestamps (written / edited) | ✓ | ✗ (period dates + `본인 수정` flag only) | ✗ | = colleague | n/a | 90 d (unchanged) |
| Audit `activity.post` / `activity.skipped` | ✗ | ✗ | ✗ | action + time only, **no metadata** | ✗ | `RETENTION_AUDIT_DAYS` (365 d) |
| Room chat | ✓ | ✓ | dock only | = colleague | ✗ | 30 d (unchanged) |
| Wave | ✓ | ✓ | ✗ (disabled) | = colleague | ✗ | not stored |
| Ping, DM, work request (incl. paper plane) | participants | ✗ | participants (DM) | ✗ | DMs only if opted in (unchanged) | unchanged |
| Pet bubble text | ✓ | `…` | ✗ | ✗ | it wrote it | 14 d (unchanged) |
| Presence or activity history | ✗ | ✗ | ✗ | ✗ | ✗ | **none exists** |

---

## 4. Claude / MCP changes

### 4.1 New tool `post_activity` (the fifth tool)
- `WRITE_ANNOTATIONS`. **No `requiresUserInteraction`. No user id, e-mail or colleague field.** It acts only for the token owner (`callerFromAuthInfo`).
- `TOOL_RATE_LIMITS[postActivity] = { max: 20, windowMs: HOUR_MS }`.
- It works at any hour, like `post_work_log`. Realtime decides what is shown.

`packages/shared/src/schemas/mcp.ts`:
```ts
export const WorkRef = z.string().regex(WORK_REF_PATTERN).describe(
  'Stable id copied verbatim from a connected tool, never invented: gcal:<iCalUID>, jira:ENU-123, ' +
  'github:<owner>/<repo>#<n>, drive:<fileId>. Never shown to anyone; ENU Town stores only a keyed daily value and ' +
  "uses it to draw people together when colleagues' own Claudes report the same id.");

export const activityNow = z.object({
  kind: z.enum(NOW_KINDS).describe('work = 개인 업무(구현·분석·디자인) | docs = 문서·설계서 작성 | ' +
    'review = 검토·V&V·코드 리뷰 | collab = 동료와 함께 진행 중인 작업'),
  ref: WorkRef.optional().describe('The one primary work item (ticket, PR, document) of this activity.'),
  until: IsoDateTime.optional().describe('When this stops being current. Default now+90 min; capped at now+120 min.'),
});

export const scheduleBlock = z.object({
  start_at: IsoDateTime,
  end_at: IsoDateTime.describe('After start_at; the block must lie within today\'s office day (Asia/Seoul): ' +
    'end_at may be exactly the next midnight (24:00). Cut longer blocks there.'),
  kind: z.enum(SCHEDULE_KINDS).describe('meeting = accepted work meeting with other people | ' +
    'focus = calendar focus time | away = out of office (외근·출장·휴가·반차·부재중); shown only as 부재, never a reason'),
  ref: WorkRef.optional().describe('meeting only: gcal:<iCalUID> (identical on every attendee\'s calendar). ' +
    'Omit for 1:1 meetings and anything sensitive.'),
});

export const postActivityInput = z.object({
  now: activityNow.nullable().describe("What the owner is doing right now according to their own tools (last 60 min); " +
    'null = nothing clear (clears the previous report). It only labels the owner\'s avatar or desk plate; ' +
    'it never makes the owner appear.'),
  schedule: z.array(scheduleBlock).max(LIMITS.scheduleBlocksMax).optional()
    .describe("ALL of today's work blocks (office date, Asia/Seoul). Replaces the previous list; [] clears it; omit to keep it."),
  source_hint: z.enum(SOURCE_HINTS).default('scheduled_task'),
});
export type PostActivityInput = z.infer<typeof postActivityInput>;

const OwnerStatus = z.object({ status: z.enum(MANUAL_STATUSES), until: IsoDateTime });
export const postActivityOutput = z.object({
  result: z.enum(['stored', 'skipped_sharing_off']),
  period_key: LocalDate,
  now_until: IsoDateTime.nullable(),          // effective (clamped) until
  schedule_blocks: z.number().int(),          // blocks stored for today after this call
  owner_status: OwnerStatus.nullable()
    .describe('A status the owner set by hand; it is shown instead of your report until `until`.'),
});
export type PostActivityOutput = z.infer<typeof postActivityOutput>;

// rejectionReason gains 'unsupported'
export const rejectionReason = z.enum(['pii','url','too_long','empty','invalid_time','daily_limit','unknown_todo','unsupported']);
```

**Validation** is `prepareActivity(input, now, officeTimeZone)` in `packages/domain/src/validation.ts` (called with
`APP_TIMEZONE`). It is pure and
returns `{ prepared, problems }`. **Any problem rejects the whole call and nothing is saved.** The error is
`ToolError('validation_failed', 'activity rejected: nothing was saved. Fix the listed fields and call post_activity
again.', { problems })`, the same pattern as `post_work_log`.

| Check | field | reason | detail |
|---|---|---|---|
| `now.until ≤ now` | `now.until` | `invalid_time` | `until must be in the future` |
| `end_at ≤ start_at` | `schedule[i].end_at` | `invalid_time` | `end_at must be after start_at` |
| not (`start_at ≥` today's office-day 00:00 ∧ `end_at ≤` the next office-day 00:00) | `schedule[i]` | `invalid_time` | `blocks must lie within YYYY-MM-DD (Asia/Seoul); cut blocks at midnight` |
| `meeting`/`focus` longer than 10 h (`away` may span the whole day) | `schedule[i]` | `invalid_time` | `meeting/focus blocks may last at most 10 hours` |
| `ref` on `focus`/`away` | `schedule[i].ref` | `unsupported` | `ref is only for meeting blocks` |
| ref pattern, > 16 blocks, bad ISO | zod | standard `isError` input error | |

**Meaning-preserving normalization only.** No text exists to rewrite.
- `now.until` defaults to now + 90 min and is clamped to ≤ now + 120 min. This is time, not text, following the
  `resolveNudgeTimes` precedent. The effective value is returned in `now_until`.
- Blocks are converted to UTC ISO and sorted by (start, end, kind); exact duplicates are dropped.
- Ref: the scheme is lower-cased. In the service, `refHash = hex(HMAC-SHA256(activityRefKey, periodKey + '\n' + ref))[0..32]`.

**Service** (`packages/mcp-tools/src/services/activity.ts`, `postActivity(db, caller, input, { now, refKey, officeTimeZone })`):
1. `loadOwnerContext` (it gains `shareActivity: boolean | null` and `manualStatus: {status, until} | null`).
2. Fast path: if `!canShareActivity(owner, {active:true})`, return `skipped_sharing_off` and **store nothing**.
   Audit `activity.skipped` with **no metadata**.
3. `prepareActivity(input, now, officeTimeZone)`; throw on problems.
4. In one transaction:
   - **`SELECT share_activity FROM profiles WHERE user_id = $1 FOR UPDATE`**. If it is not `true`, roll back and
     return `skipped_sharing_off` (audit as in step 2). This closes the race with `PATCH share_activity=false`, which
     updates the same row (taking the same lock) and deletes today's report in its own transaction (§7.4);
   - upsert `activity_reports (user_id, period_key = localDateKey(now, officeTimeZone))`; `now_*` is always replaced
     (`null` clears); `schedule` is replaced only when sent; set `source = SOURCE_HINT_TO_SOURCE[...]`, `oauth_client_id`;
   - `notifyTown(tx, { v: 1, type: 'activity_changed', user_id })`;
   - `recordLinkWrite`;
   - `audit({ action: 'activity.post' })` with **no metadata** (no kind, no counts, no refs).
5. Return the output.

`status:set` (realtime) is **not** audited. Neither is `show_live`.

`activitySummaryKo`:
- `오늘(YYYY-MM-DD) 활동을 반영했어요: 지금 '<kind ko>'(HH:MM까지), 일정 블록 N개. 동료에게는 근무 시간에만 보여요.`
- For `skipped_sharing_off`: `주인이 활동 공유를 켜지 않아 저장하지 않았어요. 오류가 아니니 다시 보내지 마세요.`
- With an owner status, it adds: `주인이 직접 '<status ko>'(~HH:MM)로 설정해 두어 그동안은 주인 설정이 보여요.`

`McpDeps` gains `activityRefKey: Uint8Array` and `officeTimeZone: string` (= `APP_TIMEZONE`).
`apps/web/src/app/api/mcp/route.ts` derives the key once:
`new Uint8Array(hkdfSync('sha256', BETTER_AUTH_SECRET, 'enu-town', 'activity-ref/v1', 32))` (`hkdfSync` returns an
`ArrayBuffer`). Test harnesses pass a fixed key and `'Asia/Seoul'`.

### 4.2 `get_my_context`
`CONTEXT_SECTIONS` gains `'activity'`. The section is omitted when `skip=true`.
```ts
activity: z.object({
  sharing: z.boolean().describe('false (off or not chosen yet): do not call post_activity.'),
  now: z.object({ kind: z.enum(NOW_KINDS), has_ref: z.boolean(), until: IsoDateTime }).nullable(),
  schedule: z.array(z.object({ start_at: IsoDateTime, end_at: IsoDateTime, kind: z.enum(SCHEDULE_KINDS),
    has_ref: z.boolean() })),                      // today's stored list; refs are never echoed
  owner_status: OwnerStatus.nullable(),
}).optional(),
```
- `contextSummaryKo` adds `활동 공유 꺼짐: post_activity를 호출하지 마세요.`, or
  `활동 공유 켜짐: 오늘 일정 블록 N개, 지금 활동 '<kind>'(HH:MM까지).`, plus the owner-status sentence above.
- `shrinkContext` pops `activity.schedule` items last.

**Descriptions** (`packages/mcp-tools/src/descriptions.ts`):
- `SERVER_INSTRUCTIONS` gains: "ENU Town is a live visualization: nobody steers avatars. After get_my_context, if
  activity.sharing is true, call post_activity with today's work calendar blocks and what the owner is doing now.
  Never guess presence or attendance, never name colleagues; people are drawn together only when their own Claudes
  report the same ref."
- `TOOL_TITLES.postActivity = "Post the owner's current activity and today's schedule"`.
- `TOOL_DESCRIPTIONS.postActivity` covers:
  - what each kind looks like (meeting/focus blocks place the avatar; `now` only labels it or the desk plate);
  - `now` replaced on every call, `schedule` replaced when sent;
  - "today" is the office date (Asia/Seoul), returned as `period_key`;
  - the 90/120-minute rule;
  - refs hashed, matched only against colleagues' own reports, with meetings needing ≥ 3 people;
  - whole-call rejection with problems;
  - `skipped_sharing_off` semantics;
  - `owner_status` wins;
  - the 16-block and 20-per-hour limits.

### 4.3 Check-in skill (`claude/plugins/enu-town/skills/enu-town-checkin/SKILL.md`)
- **Description:** add `활동(post_activity)`.
- **Intro, new sentence:** `ENU Town 아바타는 사람이 조작하지 않는다. 사용자 본인 상태, 타운 접속, 네가 보낸 일정으로 ENU Town이 자리를 정하고, 네가 보낸 '지금 하는 일'과 업무 로그는 이름표로만 붙는다.`
- **Call order:** `get_my_context` → `post_work_log` → **`post_activity`** → `upsert_todos` → `post_pet_nudges`.
- **New section "5. post_activity"** (the old 5–7 become 6–8):
```md
## 5. post_activity — 지금 하는 일과 오늘 일정 (동료에게 사무실 지도로 보임)

- `activity.sharing`이 `false`면 이 단계를 **건너뛴다**.
- **출퇴근·자리 여부를 추측하지 않는다.** 메일 발송 시각·커밋 시각·접속 흔적으로 "자리에 있다/없다"를 판단하지 않는다.
- `schedule`: 오늘(현지 날짜) 캘린더에서 사용자가 **수락했거나 주최한 업무 일정만**, 매번 **오늘 전체**를 보낸다.
  거절·미정·미응답, 알림용 종일 일정은 뺀다. 오늘 일정이 모두 없어졌으면 `[]`.
  - 다른 사람과 하는 회의 → `kind: "meeting"`. 참석자가 **나 포함 3명 이상**인 회의만 `ref: "gcal:<iCalUID>"`
    (eventId가 아니라 모든 참석자에게 같은 iCalUID). **1:1 일정은 `ref` 없이** 보낸다.
  - 캘린더 '방해 금지 시간(Focus time)' → `kind: "focus"`
  - 외근·출장·휴가·반차·부재중 → `kind: "away"`(사유는 어디에도 쓰지 않는다)
  - 개인 일정(병원·가족 등)과 인사 관련 일정(면담·평가·채용·징계)은 **아예 보내지 않는다**.
  - 자정을 넘는 일정은 오늘 24:00까지로 자른다(`end_at`이 정확히 다음 날 00:00이어도 된다). 날짜 기준은 회사 시간대(Asia/Seoul)다.
- `now`: 최근 60분 안의 **실제 업무 흔적**(문서 수정, 커밋·PR, 리뷰 코멘트, Claude와의 업무 대화)이 분명할 때만.
  불분명하면 `null`. `now`는 아바타를 자리에 앉히지 않고 이미 보이는 아바타나 자리 표시판에 '지금 하는 일'만 붙인다.
  - `kind`: 구현·분석·디자인 `work` / 문서·설계서 작성 `docs` / 검토·V&V·코드 리뷰 `review` / 동료와 함께 진행 `collab`
  - `ref`: 그 업무의 대표 항목 ID를 **도구가 준 그대로** 하나만(`jira:ENU-123`, `github:enu/hmi#42`, `drive:<fileId>`).
    지어내지 않는다.
  - `until`: 보통 생략(90분).
- 동료 이름·이메일은 어떤 필드에도 쓰지 않는다. 함께 있는 모습은 ENU Town이 각자의 Claude가 보낸 `ref`로만 만든다.
- `owner_status`가 있으면 사용자가 직접 정한 상태다. 덮어쓰려 하지 말고 평소처럼 보낸다.
- 결과가 `skipped_sharing_off`면 다시 시도하지 않는다. 거부되면 `problems`에 맞게 고쳐 **한 번만** 다시 보낸다.
```
- **Section 3 (공개 기준), new line:** `아바타 위치는 실제 위치가 아니라 업무 상태다. 출퇴근·근태 기록이 아니며 성과 평가에 쓰이지 않는다.`
- **Section 2:** the calendar bullet adds `(수락 여부, 참석자 수, Focus time·부재중 여부까지 확인)`.
- **Final line:** `ENU Town 체크인 완료: 업무 로그 1건, 활동 1건(일정 블록 N개), 할 일 N건, 펫 메시지 N건`.
- `references/tool-guide.md` gets one `post_activity` example: a 3-person meeting with a ref, a 1:1 without one, an away block and `now: review jira:ENU-301`.
- `references/redaction-rules.ko.md` gets the 1:1, 면담 and personal-event omission rules.
- `enu-town-setup` and the plugin `README.md`: "네 가지 도구" becomes "다섯 가지", plus one line about `/me > 설정 > 활동 공유`.

---

## 5. Viewer UX

### 5.1 Removed
- WASD and arrow keys, floor click-to-move, the move marker, `LocalMover` prediction, the camera following your own
  avatar, `옆으로 가기` (`move:to-user`), the `move:unreachable` toast and the `ui:text-focus` plumbing.
- The pinged toast's `가기` becomes `DM 열기`.
- The 근처 chat tab and the 함께 들은 근처 대화 history tab.
- Zone-driven auto status: the meeting zone forcing 회의 중, and 탕비실/발코니 as status text.
- Any "where" display: `Player.zoneId`, the ProfileCard 위치 row and `ko.townUi.profile.zone` (P2; `activity` replaces them).
- `WorldScene.zoomBias` and `chooseZoom` (the top-bar `−`/`+` buttons stay and step through the zoom list).

### 5.2 Camera (office 22×23 tiles = 704×736 px; overview rect = rows 4–21 = `OVERVIEW_RECT = {x:0,y:128,w:704,h:576}`)
- `fitZoom(freeW, freeH)` returns the largest z in `[1, 1.5, 2, 3, 4]` with `704z ≤ freeW ∧ 576z ≤ freeH` (minimum 1),
  centred on the overview rect. The free area is the canvas minus the docked team rail (320 px, when docked) and the
  top-bar band (56 px). Examples (`fitZoom` arguments are the free area):
  - 1600×894 (maximized 1080p browser: viewport ≈ 1920×950, rail docked) → 1.5;
  - 1120×844 (1440×900 viewport, rail docked) → 1;
  - 2240×1360 → 2;
  - 1366×712 → 1.
- 1.5 is the only fractional zoom and is used only at fit. Name tags and bubbles are already drawn by the
  screen-space overlay camera, so text stays crisp.
- **Wheel**, the top-bar `−`/`+` buttons (`camera:zoom {delta: ±1}`) and the keys `+`/`-` step through the zoom list
  (wheel: around the cursor; buttons and keys: around the view centre). **Drag:** pans when zoomed past fit.
- **Keys** work only while the canvas has focus. Keys never move avatars.
- `Esc`, `0`, `전체 보기` and `camera:zoom {delta: 0}` reset to fit.
- **`이 사람 보기`, or a second click on the same avatar within 300 ms:** zoom `max(2, fit)` centred on the person,
  with a 2 s pulse ring. The camera then stays put. **It never auto-follows.**

### 5.3 Click targets and menus
| Click | Opens |
|---|---|
| A colleague's avatar (first click), a colleague's desk plate (shown or hidden), or a team-rail row | `AvatarContextMenu` |
| Own avatar or own desk | `StatusMenu` (with `내 펫` and `내 업무 로그` links) |
| Own pet or bubble | `MyPetPanel` / bubble actions (unchanged) |
| A meeting chip or group link | a small group popover: kind, `~HH:MM`, members with team dots, and each member's `지금 하는 일` link |
| Floor | nothing |

The first click on an avatar opens its menu; a second click on the same avatar within 300 ms closes the menu and
runs `이 사람 보기`. Desk clicks are resolved by desk id → roster member, never by "is a Player present".

**Labels** (`ko.townUi.activity`, `ko.townUi.source`, `ko.townUi.note`; shared by WP-E's UI and WP-F's notice and legend):

| Code | ko | Code | ko |
|---|---|---|---|
| `ActivityCode.None` | (no label; show the source only) | `SourceCode.None` | (nothing) |
| `Available` | 대화 가능 | `Manual` | 직접 설정 |
| `Focus` | 집중 모드 | `Calendar` | 캘린더 일정 |
| `Meeting` | 회의 중 | `Claude` | Claude 보고 |
| `Break` | 휴식 | `WorkLog` | 업무 로그 |
| `Work` | 개인 업무 | `Town` | 타운 접속 |
| `Docs` | 문서 작성 | `PlateNote.Away` | 자리 비움 |
| `Review` | 검토 중 | `PlateNote.Absent` | 부재 |
| `Collab` | 협업 중 | group chips | `회의 중 · N명 · ~HH:MM`, `같은 작업` |
| `Today` | 오늘 업무 기록 | | |

The display form is `<activity> · <source>` (e.g. `검토 중 · Claude 보고`, `집중 모드 · 직접 설정`), plus ` · ~HH:MM`
when `until > 0`. Times are formatted with `formatLocalHm(…, MeDto.officeTimeZone)` (P5).

`AvatarContextMenu`:
- **Header:** name · team · title, then the display form (`부재` alone for `note=absent`).
- **Items:** 프로필 · **지금 하는 일** (the WorkLogPanel starts with a "지금" card from the Player fields, then the
  existing log) · 지난 대화 (DM · 전체 · Claude 요약) · 업무 요청 (unchanged; DM draft, never auto-sent) · DM 보내기 ·
  ─ · `손 흔들기 (모두에게 보여요)` (enabled when both are shown and the office is open) · `부르기` (enabled when the
  target is `online`) · `이 사람 보기` (enabled when the target is shown).
- `offlineAction` hint (ko) becomes `지금 화면에 없어서 할 수 없어요`.

**Hover tooltip:** `이름 · 팀` / the display form / 상태 문구 (if any) / `● 접속 중` (if `online`).

**Team rail:** the existing `PeopleDirectory` gains a `docked` prop.
- At ≥ 1280 px it is a right rail; below that it is a sheet.
- Rows are grouped in `TEAMS` order, then desk order. Each row shows an activity dot, name, the display form, and an
  online dot only when `online`.
- Hover pulses the avatar (when shown); click opens the menu.
- It is the accessible mirror of the canvas (`role="list"`, live text). It shows no team counts.
- **Counts:** the top-bar people button and the rail header show `접속 N명`, where N = Players with `online=true`
  (0 after hours). Nothing counts roster size or "shown".

**Legend** (`?` button, `ko.townUi.legend`):
- `아바타는 사람이 조작하지 않아요. 본인이 정한 상태, 타운 접속, 본인 Claude가 보낸 캘린더 일정으로 ENU Town이 자리를 정해요.`
- `'Claude 보고'는 본인 Claude가 최근 업무 흔적(문서·커밋·PR·리뷰)을 보고 판단한 지금 하는 일의 종류예요. 이름표나 자리 표시판에만 붙고, 이것만으로 아바타가 나타나지는 않아요.`
- `자리에 보이는 것은 출근·근태를 뜻하지 않아요. 아바타가 없으면 지금 알려진 활동이 없다는 뜻일 뿐이에요.`
- `타운을 열면 보통 내 아바타도 보여요(서로 보기). 설정 > 접속 표시를 끄면 타운을 열어도 보이지 않아요.`
- `회의 테이블에 함께 있는 모습은 세 명 이상이 각자의 Claude로 같은 일정을 보고했을 때만, 동료 자리 옆에 선 모습은 두 사람의 Claude가 같은 작업을 보고했을 때만 보여요.`
- `근무 시간(평일 08:30–19:30) 밖에는 누구의 상태도 보이지 않아요.`

### 5.4 Readability
- **Team colour:** a 2 px ground ring under each avatar plus the plate border.
- **Name tags:** someone at their own desk shows only the desk plate (no floating tag); someone away from their desk shows a floating tag.
- **Activity icons:** 16 px, screen space, over the head when shown and on the desk plate when hidden. They come from
  a new third effects row with **fixed frame indices** (both `packages/sprites/src/spec.ts` and the copy in
  `apps/web/src/game/spriteSpec.ts`; `EFFECT_ROWS` becomes 3): `headset: 16` (meeting), `focus: 17`, `cup: 18`
  (break), `laptop: 19` (work), `magnifier: 20` (review), `link: 21` (collab), `clipboard: 22` (today), `plane: 23`
  (DM). Docs uses the existing `note: 14`.
- **Idle cosmetics** (client-side, shown avatars only, they claim nothing): the existing breathing bounce and pet hover. No "typing" on hidden people.
- **Own avatar:** the gold star and yellow name (existing `isMe`).
- **Own hidden state** (StatusMenu line, office hours only):
  - `note=away`/`absent`: `지금 동료에게 '<note ko>'로 보여요. 상태를 바꾸면 자리에 표시돼요.`
  - `note=none` with a label: `지금 동료에게는 자리 표시판에 '<display form>'로만 보여요.`
  - `note=none` without a label: `지금 동료에게는 이름만 보여요. 상태를 정하면 자리에 표시돼요.`

### 5.5 Status (`StatusMenu`)
- **Options:** `자동 (일정·Claude·업무 기록 기준)` · `대화 가능` · `집중 모드` · `회의 중` · `휴식` · `자리 비움`.
- **Duration:** `30분` · `1시간` (default) · `2시간` · `오늘 근무 끝까지`. It is hidden for 자동.
- **상태 문구:** human-typed, 80 characters (unchanged; also editable in `/me`). It does not expire; `자동` keeps it.
  Colleagues see it only while I am shown or `자리 비움`.
- **Read-only list "오늘 Claude가 보낸 일정"** (time range + kind) from `MeDto.activityToday`, plus a link
  `활동 공유·접속 표시 설정 → /me`.
- The top-bar chip shows `내 상태: 집중 ~11:00`.

### 5.6 Chat and DM
- ChatDock: `전체` + the DM drawer. The bubble over the sender appears only while the sender is shown.
- Work requests are unchanged.
- The participant-only paper plane on `dm:msg` goes from the sender's avatar or desk to the recipient's.

### 5.7 Pet bubbles (owner-only, privacy unchanged)
- **Triggers, in priority order:** `due` > `urgent` > `join` (8 s, unchanged) > **`eligible`** (the best nudge with
  `shownCount = 0` whose `show_after` passed) > **`glance`** (the tab becomes visible after being hidden for at least
  `PolicyTiming.glanceHiddenMs`, default `NUDGE_POLICY.glanceHiddenMs` = 10 min; fires once per return and shows the
  best live nudge, i.e. one with `shownCount < maxShows`). `due`/`urgent` are unchanged.
- `eligible` and `glance` are subject to `minIntervalMin`, the daily cap, quiet hours and DND.
- `max_shows` keeps its meaning (a nudge can be shown again by `glance` until `max_shows`), so the `post_pet_nudges`
  description and the skill need no change.
- **Forced quiet while the office is closed:** `OwnerPresence` gains `officeOpen`; `selectBubble` returns
  `{show:false, reason:'quiet'}` when it is false, whatever the owner's `quiet_start`/`quiet_end`.
- **Indicator:** `Pet.indicator` is shared state, so `indicator = Dots` only while a bubble is active **and** the
  owner's projection is `shown`; otherwise `None`. `BubblePresenter.show` sets it through a hook
  `indicatorAllowed(userId)`, and `Director.evaluate` re-derives it on every change of `shown` (so a bubble that started
  while shown loses its `…` when the owner becomes hidden).
- **Removed:** the `idle` trigger, `NUDGE_POLICY.idleMs`, `PolicyTiming.idleMs`, `SchedulerFlags.idleArmed`,
  `OwnerPresence.lastActivityAt` and `NudgeScheduler.noteActivity`.
- **DND hook:** `director.resolved(userId).dnd` (focus or meeting). No zones.
- **Pet position:** pets of hidden owners perch on `spots.perch(deskId)`, so the owner still sees bubbles while
  hidden; colleagues see a perched pet with no `…`.
- **Tab visibility** (`presence` C2S) stays owner-only (bubble gating and `glance`) and is never shown.

---

## 6. Realtime architecture

### 6.1 Components (`apps/realtime/src`)
| File | Role |
|---|---|
| `director/Director.ts` (new) | Owns `Actor { userId, deskId, player, pet, follower, inputs, resolved, projected, spot, walker }`. API: `upsertActor(snap)` (mutates an existing actor's `Player`/`Pet` in place; creates one only when absent), `removeActor(id)`, `setSession(id, s: 'open' \| 'held' \| 'ended', now)` (`held` = the 20 s `onDrop` hold: live but not connected; `ended` starts the 60 s grace), `setManual(id, m)`, `setSignals(id, s)`, `noteLogWrite(id, by)`, `evaluate(now, nowMs)`, `step(nowMs)`, `resolved(id)`, `projected(id)`, `pet(id)`, `snapshot()`. No I/O, no clock reads, no `Math.random`. |
| `director/Walker.ts` (new) | Path follower: `findPath(world, from, to, {maxNodes: 6000})`, one tile per `STEP_MS` (160 ms), with `startAtMs` for the stagger. Re-paths from the current tile when the target changes. If no path exists, it teleports and logs a warning. |
| `director/codes.ts` (new) | Maps domain names to protocol codes (`ActivityCode`, `SourceCode`, `PlateNote`). |
| `infra/roster.ts` (new) | `loadRoster(db)` (all roster snapshots: profile, desk, manual status, `share_activity`, `show_live`, link state); `loadSignals(db, userIds, now)` (the `activity_reports` rows with `period_key = localDateKey(now, APP_TIMEZONE)` and log flags `{colleagueVisible, hasWorkTask}`; never log text). |
| `infra/profiles.ts` | `UserSnapshot` gains `manualStatus`, `manualStatusUntil`, `shareActivity`, `showLive`, `onboardingCompletedAt` and `noticeAccepted` (same rule as `MeDto.noticeAccepted`: a non-withdrawn `service` consent for the current `PRIVACY_NOTICE_VERSION`). |
| `auth/verifyTicket.ts` | After the existing checks, throws `TicketError('notice_required')` unless `onboardingCompletedAt` is set and `noticeAccepted`. The web client maps the `notice_required` join error to `/welcome`. |
| `rooms/OfficeRoom.ts` | Auth (ticket + protocol check in `onAuth`), sessions, messages (§6.4), DbEvents → director, `setInterval(evaluate, 1000)`, `fastTick` → `director.step` + `scheduler.expire`. |
| `pet/NudgeScheduler.ts` | Hooks: `pet: (id) => director.pet(id)`, `doNotDisturb: (id) => director.resolved(id)?.dnd ?? true`, `officeOpen: () => state.officeOpen`, `indicatorAllowed: (id) => director.projected(id)?.shown ?? false`. `glance` bookkeeping in `setPresence`. |
| `world/PetFollower.ts` | Gains `setAsleep(asleep)` (`!linked ∨ !officeOpen` → `Anim.Sleep`) and perch mode (`update(nowMs, spots.perch(deskId))` while the owner is hidden). |

### 6.2 `Director.evaluate(now, nowMs)` (1 Hz; also called right after `status:set` and DB events)
1. `open = isOfficeOpen(now, APP_TIMEZONE, holidays, env.TOWN_IGNORE_OFFICE_HOURS)`. Set `state.officeOpen`.
2. If `localDateKey(now, APP_TIMEZONE)` changed since the last load, the room reloads all signals (async) and keeps the old ones until they arrive.
3. For each actor in fixed order (index in `DESK_IDS`, desk-less last, then `userId`):
   - `share = canShareActivity(...)`, `showLive = canShowLive(...)`;
   - `todayLog.colleagueVisible = canViewLog(ANY_COLLEAGUE, ...)`;
   - `resolved = resolveActivity({ ..., live: showLive ∧ (session ≠ none ∨ now − endedAt < liveGraceMs) })`;
   - `projected = projectForColleagues(resolved, { officeOpen: open, connected: showLive ∧ session = 'open', share, statusText })`.
4. `groups = groupPeople(...)` over the projected keys and `shown`, with `meetingSeats = spots.meetingSeats.length`.
5. Intents (shown actors only):
   - gathered meeting member → `meeting`;
   - gathered work-group visitor → `visit(hostDeskId)`;
   - `break` → `break`;
   - shown with a desk → `desk`;
   - shown without a desk → `guest`.
   Then `allocateSpots`.
6. Write Player fields from `projected` **only when changed**: `shown`, `online`, `activity`, `source`, `until`
   (epoch ms or 0), `note`, `groupId`, `statusText`. Re-derive `pet.indicator` (§5.7).
7. Motion:

| Previous | Next | Motion |
|---|---|---|
| hidden | shown | set x/y/dir to the spot; `anim = Sit` (seat or chair) or `Idle`; `follower.placeNear` |
| shown | shown, spot changed | the k-th mover in this evaluation starts walking at `nowMs + k·350 ms` |
| shown | hidden | no move. The pet switches to `spots.perch(deskId)` (no desk: the client hides the pet) |
| room create / resync | — | snap everyone |

`Director.step(nowMs)` (50 ms `fastTick`):
- Advance walkers: `anim = Walk`, `dir = dirBetween`, `follower.ownerMoved`.
- On the last tile: `anim = Sit`/`Idle`, `dir = spot.facing`.
- `follower.update` for every actor (perch for hidden ones).

### 6.3 State schema (`packages/protocol/src/state.ts`)
```ts
/** A roster member (NOT a connected player): placed by the server director; nobody steers it. */
export const Player = schema({
  id: t.string(), name: t.string(), avatar: t.string(), deskId: t.string().default(''),
  x: t.uint16().default(0), y: t.uint16().default(0), dir: t.uint8().default(0), anim: t.uint8().default(0),
  statusText: t.string().default(''),     // human-typed 상태 문구 (only while shown or note=away)
  shown: t.boolean().default(false),      // NEW: avatar drawn
  online: t.boolean().default(false),     // NEW: connected (no grace) ∧ show_live ∧ shown ∧ officeOpen
  activity: t.uint8().default(0),         // NEW: ActivityCode (also the plate label while hidden)
  source: t.uint8().default(0),           // NEW: SourceCode (None for note=absent)
  until: t.float64().default(0),          // NEW: epoch ms, 0 = none (always 0 for note=absent)
  note: t.uint8().default(0),             // NEW: PlateNote (hidden people)
  groupId: t.string().default(''),        // NEW: opaque 'g…', '' = none; family inferred from activity==Meeting
  logPulse: t.uint8().default(0),         // NEW: +1 (wrapping) per Claude log write while shown in office hours
}, 'Player');                             // `status` and `zoneId` REMOVED
// Pet: unchanged (bubble* stay .view(); each client's StateView holds only its own pet). `indicator` is shared, so
// only §5.7's rule may set it to Dots.
export const OfficeState = schema({ players: t.map(Player), pets: t.map(Pet), mapId: t.string(), mapHash: t.string(),
  officeOpen: t.boolean().default(false) /* NEW */ }, 'OfficeState');
```
`packages/protocol/src/constants.ts`:
```ts
export const ActivityCode = { None: 0, Available: 1, Focus: 2, Meeting: 3, Break: 4, Work: 5, Docs: 6, Review: 7,
  Collab: 8, Today: 9 } as const;
export const SourceCode = { None: 0, Manual: 1, Calendar: 2, Claude: 3, WorkLog: 4, Town: 5 } as const;
export const PlateNote = { None: 0, Away: 1, Absent: 2 } as const;
export const PROTOCOL_VERSION = 2;
// CloseCodes gains ProtocolMismatch: 4111 (its own ko text, `ko.townUi.protocolMismatch`, and the same guarded reload
// as MapMismatch).
// DELETE: Status, STATUS_LABEL_KO (Korean labels move to apps/web/src/i18n/ko.ts). Keep STEP_MS (walker + client
// interpolation + pet cadence). Anim unchanged (Idle, Walk, Sit, Sleep).
```

### 6.4 Messages (`packages/protocol/src/messages.ts`)
| | Before | After |
|---|---|---|
| C2S `step`, `face` | grid movement | **deleted** (the `'*'` handler answers `UNKNOWN_MESSAGE`) |
| S2C `move:correct` | prediction fix-up | **deleted** |
| join options | `{ mapHash }` | `{ mapHash, protocol: PROTOCOL_VERSION }`. **`onAuth`** checks `protocol` before the ticket: missing or different → `throw new ServerError(CloseCodes.ProtocolMismatch, 'protocol_mismatch')`. New clients map 4111 to a guarded reload with `ko.townUi.protocolMismatch` (`ENU Town이 새 버전으로 바뀌었어요. 새로고침할게요.`). Old cached clients end in their existing `failed` state (manual reload); they never see the map-changed text |
| C2S `presence` | `{visible, uiBusy}` | unchanged (pet gating + `glance` only) |
| C2S `status:set` | `{ status: 0..3, text? }` | `{ status: z.enum(['auto', ...MANUAL_STATUSES]), duration: z.enum(MANUAL_DURATIONS).optional(), text: z.string().max(LIMITS.statusTextMax).optional() }` |
| C2S `chat:send` | `{ channel, text, clientMsgId }` | `{ text, clientMsgId }` (an extra `channel` key is stripped; nearby no longer exists) |
| C2S `social:wave` | `{}` → nearby | `{ toUserId: z.string().min(1).max(64) }` |
| S2C `emote` | `{ fromUserId, kind }` | `{ fromUserId, toUserId, kind: 'wave' }` broadcast to all clients |
| S2C `chat:msg` | `kind: 'nearby'\|'room'`, `zoneId` | `kind: 'room'`; `zoneId` deleted |
| S2C `error` | codes | adds `'NOT_SHOWN'` (a wave to or from someone hidden, or the office closed). `social:ping` answers only `NOT_ONLINE` or `RATE_LIMITED` |
| others | `dm:*`, `social:ping`/`pinged`, `pet:bubble-seen`, `notice`, `chat:ack` | unchanged |

Handlers:
- **`status:set`**:
  1. Rate limit 5/10 s (existing).
  2. `until = manualStatusUntil(now, APP_TIMEZONE, duration ?? '1h')`.
  3. Await `UPDATE profiles SET manual_status, manual_status_until[, status_text]` (`auto` sets `manual_status` and
     `manual_status_until` to NULL and leaves `status_text` alone; `text`, when sent, is written for any status).
     On failure, reply `INTERNAL` and change nothing.
  4. `director.setManual`, then `evaluate`.
  5. No NOTIFY and no audit. Writers of these columns: `status:set` (applies in memory directly), the worker purge
     (clears only expired values, which every reader already ignores, so no NOTIFY is needed), and
     `PATCH /me/profile` for `status_text` (already emits `profile_changed`).
- **`social:wave`**: `perWindow(3, 10 s)` plus a new per-target `KeyedLimiter` (1 per 10 s); then the open/shown checks; then broadcast.
- **`social:ping`**: the server gate is `director.projected(toUserId)?.online === true` (connected now, `show_live`,
  shown, office open) and `toUserId ≠ sender`. Every failure, including an unknown id, answers the same
  `NOT_ONLINE`, so a crafted ping cannot tell a hidden-but-connected person from a disconnected one. Rate limits run
  after this check and are unchanged. The client disables `부르기` unless `online`.
- **`ClientLimits`**: delete `step`, `stepFlood` and `face`; add `waveTarget`.

### 6.5 DB events (`handleTownEvent`)
| Event | Action |
|---|---|
| `activity_changed {user_id}` (new) | `loadSignals([id])`, then `director.setSignals`, then `evaluate` |
| `work_log_changed {user_id, by}` | `loadSignals([id])`, `evaluate`, then `noteLogWrite(id, by)`, which bumps `logPulse` only if `by = 'claude'` ∧ office open ∧ the owner's projection is `shown` ∧ `canShareActivity` ∧ the log is colleague-visible and not deleted. Owner `PATCH`/`DELETE` (`by = 'user'`) never sparkles. The owner's existing `notice` is unchanged |
| `profile_changed` | Reload the snapshot (name, avatar, desk, pet, manual status, `share_activity`, `show_live`) and apply it **in place**; `scheduler.reload` if connected |
| `link_state_changed` | Pet link state for any actor (not only connected ones); scheduler as today |
| `desks_changed` | `loadRoster`; existing actors are **mutated in place** (desk, plate, spot), new roster members get a new actor, actors that left the roster are removed. A `Player`/`Pet` instance is never swapped, so a connected owner's `client.view` keeps working |
| `user_deactivated` | Kick, `removeActor`, delete from `players` and `pets` |
| `nudges_changed`, `todos_changed` | unchanged |
| resync (5 min, LISTEN reconnect) | `loadRoster` + `loadSignals(all)` + `loadHolidays` |

### 6.6 Lifecycle
- **`onCreate`**: load the map and `world.spots`, holidays, roster and signals; create all actors (snap).
  `patchRate` 50 → 100 ms (no prediction to hide).
- **`onAuth`** (static, matchmake only): the protocol check (§6.4), then `verifyTicket` (now also refusing
  `notice_required`).
- **`onJoin`**:
  1. Look up the actor. If it is missing (e.g. onboarding finished seconds ago), `await` one `loadRoster`; if it is
     still missing, `client.leave(CloseCodes.Forbidden)`. **No actor is ever created here.**
  2. Upsert the session; `director.setSession(id, 'open', now)` and `evaluate`.
  3. `client.view.add(director.pet(id))` (the same instance for the actor's whole life).
  4. `scheduler.join` and the unread counts (unchanged).
- **`onLeave`**: `director.setSession(id, 'ended', now)`. The 60 s grace is measured from this moment and lives in the
  `live` input (§2.2). **Nothing is persisted** (`savePresence` is gone).
- **`onDrop`**: `setSession(id, 'held', now)` (still live, not connected); **`onReconnect`**: `'open'`; hold expiry:
  `'ended'`. The 20 s seat hold is unchanged; `noteActivity` is removed.
- **Logging:** join, leave, replace and drop lines carry **no `userId`** (at most `{ sessions: n }`). Per-user
  lines remain only for errors. This keeps logs from becoming a connection history (§8.1).

### 6.7 Timings
| What | Value |
|---|---|
| Director evaluate | 1 000 ms, plus immediately on status or DB events |
| Walk cadence | `STEP_MS` 160 ms/tile (desk to meeting table ≈ 20 tiles ≈ 3.2 s) |
| Move stagger | 350 ms per mover in one evaluation |
| Live grace | 60 s after the session ends (consented leave or `onDrop` hold expiry) |
| `now` validity | default 90 min, maximum 120 min |
| Glance | tab hidden for at least `NUDGE_POLICY.glanceHiddenMs` (10 min), then visible |
| Resync | 5 min (existing) |
| Office open | `WORK_HOURS` 08:30–19:30 on business days, `APP_TIMEZONE` |

### 6.8 Determinism and testability
- Every decision is a pure function of `(inputs, now)`: `resolveActivity`, `projectForColleagues`, `currentBlock`,
  `groupPeople`, `manualStatusUntil`, `isOfficeOpen` (domain), and `buildSpots`, `allocateSpots`, `findPath` (map;
  fixed neighbour order).
- The Director is a thin binder. It takes `now: Date` (business time) and `nowMs` (monotonic) as arguments and
  iterates in sorted order.
- Same roster, rows and clock give the same `snapshot()`: positions, fields and group ids.
- ESLint bans clocks and randomness in `packages/domain/src/**` and `apps/realtime/src/director/**`:
  `no-restricted-properties` for `Math.random`, `Date.now` and `performance.now`, and `no-restricted-syntax` for
  `NewExpression[callee.name='Date'][arguments.length=0]` (argument-less `new Date()`).
- Unchanged inputs must produce **zero** schema writes (asserted).

---

## 7. Database, NOTIFY, worker, REST

### 7.1 Migration `packages/db/migrations/0002_town_visualization.sql`
**Recipe:**
1. Change the Drizzle schema (list below), **including** the `chat_messages_no_nearby_chk` CHECK, so the snapshot
   matches the database.
2. `pnpm db:generate --name town_visualization`. Drizzle emits every `ADD`/`DROP` itself; nothing is hand-repeated.
3. Insert one hand-written statement **at the top** of the generated file:
   `DELETE FROM "chat_messages" WHERE "kind" = 'nearby';--> statement-breakpoint` (it must run before the CHECK is added, and it also removes
   the dependent `chat_message_recipients` rows via the existing cascade before that table is dropped).
4. `pnpm db:generate` again must report no changes.

It must stay PG 16 compatible. The expected content (statement order inside Drizzle's output may differ, except that
the `DELETE` comes first):
```sql
DELETE FROM "chat_messages" WHERE "kind" = 'nearby';                          -- hand-inserted, first statement
ALTER TABLE "profiles" ADD COLUMN "share_activity" boolean;                    -- NULL = not chosen = off
ALTER TABLE "profiles" ADD COLUMN "show_live" boolean DEFAULT true NOT NULL;   -- 접속 표시 (D21)
ALTER TABLE "profiles" ADD COLUMN "manual_status" text;
ALTER TABLE "profiles" ADD COLUMN "manual_status_until" timestamp with time zone;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_manual_status_chk"
  CHECK ("manual_status" IS NULL OR "manual_status" IN ('available','focus','meeting','break','away'));
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_manual_status_pair_chk"
  CHECK (("manual_status" IS NULL) = ("manual_status_until" IS NULL));

CREATE TABLE "activity_reports" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "period_key" date NOT NULL,                                -- office date (APP_TIMEZONE)
  "now_kind" text,
  "now_ref_hash" char(32),
  "now_until" timestamp with time zone,
  "schedule" jsonb DEFAULT '[]'::jsonb NOT NULL,             -- [{start_at,end_at,kind,ref_hash|null}]
  "source" text NOT NULL,
  "oauth_client_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "activity_reports_pk" PRIMARY KEY ("user_id","period_key"),
  CONSTRAINT "activity_now_kind_chk" CHECK ("now_kind" IS NULL OR "now_kind" IN ('work','docs','review','collab')),
  CONSTRAINT "activity_now_pair_chk" CHECK (("now_kind" IS NULL) = ("now_until" IS NULL)),
  CONSTRAINT "activity_now_ref_chk" CHECK ("now_ref_hash" IS NULL OR "now_kind" IS NOT NULL),
  CONSTRAINT "activity_schedule_chk" CHECK (jsonb_typeof("schedule") = 'array' AND jsonb_array_length("schedule") <= 16),
  CONSTRAINT "activity_source_chk" CHECK ("source" IN ('cowork_scheduled','claude_interactive','claude_code'))
);
CREATE INDEX "activity_reports_period_idx" ON "activity_reports" ("period_key");

ALTER TABLE "privacy_consents" DROP CONSTRAINT "privacy_consents_scope_chk";
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_scope_chk"
  CHECK ("scope" IN ('service','claude_chat_summary','activity_sharing'));

-- generated by Drizzle from the schema change (nearby chat and stored positions are gone: data minimization)
DROP TABLE "chat_message_recipients";
ALTER TABLE "chat_messages" DROP COLUMN "zone_id";
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_no_nearby_chk" CHECK ("kind" <> 'nearby');
DROP TABLE "user_presence";
-- the pg enum value chat_kind 'nearby' stays (dropping enum values is not transactional); the CHECK blocks writes.
```
Drizzle (`packages/db/src/schema/app.ts`):
- add `activityReports` and the `ScheduleBlockRow` type;
- add the new `profiles` columns (`share_activity`, `show_live`, `manual_status`, `manual_status_until`) and checks;
- remove `userPresence`, `chatMessageRecipients` and `chatMessages.zoneId`;
- declare `chat_messages_no_nearby_chk`;
- update the `privacy_consents` check.

`packages/db/test/migrate.int.test.ts` applies only up to `0001` by copying `migrations/` to a temp directory whose
`meta/_journal.json` keeps only the first two entries, then running the migrator on that copy. It then seeds a
`nearby` message with `chat_message_recipients` rows, a `room` message with a `zone_id`, and a `user_presence` row,
and runs the migrator on the real folder (applying `0002`). It asserts that the nearby rows are gone, the room
message survives, the dropped tables and column are gone, and the new CHECKs reject bad rows.

`seed/dev.ts`:
- seeded users get `share_activity = true`, `show_live = true` and a consent row for `activity_sharing`;
- the notice version becomes `2026-11`;
- the nearby demo message is removed.

### 7.2 NOTIFY (`packages/shared/src/schemas/events.ts`)
```ts
z.object({ v: z.literal(1), type: z.literal('activity_changed'), user_id: z.string() }),
// work_log_changed gains a required actor field:
z.object({ v: z.literal(1), type: z.literal('work_log_changed'), user_id: z.string(), /* existing fields */
  by: z.enum(['claude', 'user']) }),
```
Emitters:
- `activity_changed`: `post_activity`; `PATCH /api/v1/me/profile` when `share_activity` changes (also `profile_changed`).
- `work_log_changed`: `post_work_log` sends `by: 'claude'`; the owner's `PATCH`/`DELETE` in
  `apps/web/src/server/queries/logs.ts` send `by: 'user'`. All emitters ship in WP-B together.
- `profile_changed`: also when `show_live` changes.

### 7.3 Worker (`apps/worker/src/jobs/retention-purge.ts`, 03:17; no new job)
- `DELETE FROM activity_reports WHERE period_key < localDateKey(now, APP_TIMEZONE)`: yesterday's and older reports.
  Writers and readers use the same `APP_TIMEZONE` day (P5), so the purge can never delete a live row.
- `UPDATE profiles SET manual_status = NULL, manual_status_until = NULL WHERE manual_status_until < now()`. The worker
  is the second writer of these columns; it touches only expired values, which every reader already ignores, so it
  sends no NOTIFY. `status_text` is not touched.
- The chat purge uses `kind = 'room'` only (nearby is gone; the recipients cascade is removed).
- The result reports `activityReports` and `clearedManual` counts.
- Correctness never depends on the purge: realtime and MCP read only today's `period_key` and unexpired values.
- No presence or attendance job exists, and none may be added (ADR 0004).

### 7.4 REST (`apps/web`, shapes in `packages/shared/src/schemas/{rest,dto}.ts`)
- **`POST /api/v1/me/onboarding`**: `onboardingSubmit` gains `share_activity: z.boolean()` (required; the wizard
  step has nothing preselected). Writes `profiles.share_activity`; `true` also inserts
  `privacy_consents(scope='activity_sharing')`.
- **`PATCH /api/v1/me/profile`**: `profilePatch` gains `share_activity: z.boolean()` and `show_live: z.boolean()`.
  - `share_activity: true`: insert the consent row (or clear `withdrawn_at`).
  - `share_activity: false`, in **one transaction**: `UPDATE profiles SET share_activity = false` (this row lock is
    what `post_activity`'s `FOR UPDATE` waits on, §4.1), set `withdrawn_at`, **delete today's `activity_reports`
    row**, and NOTIFY `profile_changed` + `activity_changed`.
  - `show_live`: update the column and NOTIFY `profile_changed`.
- **`GET /api/v1/me`**: `MeDto` gains `shareActivity: boolean | null`, `showLive: boolean`,
  `officeTimeZone: string` (= `APP_TIMEZONE`, for client time formatting),
  `manualStatus: { status: ManualStatus; until: string } | null` and
  `activityToday: { now: { kind: NowKind; until: string } | null; schedule: { startAt: string; endAt: string; kind: ScheduleKind; hasRef: boolean }[] } | null`.
  `MeDto` keeps the owner's own `statusText` and `lastWorkLogAt`.
- **Colleague-facing DTOs** (`/api/v1/people`, `/api/v1/users/:id/card`, log lists):
  - `PersonDto` **drops `statusText` and `lastWorkLogAt`**. 상태 문구 reaches colleagues only through realtime state
    (office hours, §3.2);
  - `WorkLogDto.claudeWrittenAt`, `updatedAt` and `userEditedAt` become `string | null` and are `null` unless
    `canViewLogTimestamps(viewer, ownerId)`; colleagues keep `periodStart`/`periodEnd` and the `editedByUser` flag
    (`provenanceLabel` "… · 본인 수정" is unchanged);
  - `ProfileCardDto.stale` is unchanged (a day-granular link state, already public by ADR).
- **`/api/v1/me/export`** adds the owner's `activity_reports` rows (with `has_ref` instead of the hashes), the manual
  status and `show_live`. Its chat rows drop `zoneId` (`server/queries/export.ts`).
- **`/api/v1/users/:id/chat-history`**: `KINDS = ['dm','room']`; `kind=nearby` returns 400. `ChatItemDto.kind`
  becomes `'dm' | 'room'` and `ChatItemDto.zoneId` is deleted (`packages/shared/src/schemas/dto.ts`,
  `apps/web/src/server/dto.ts` `toChatItemDto`).
- No other endpoint changes. Colleagues see activity only through realtime state, so there is no activity REST for others.

### 7.5 Deploy and rollback (the migration is destructive)
`compose.yaml` runs `migrate` while the old `web`/`realtime`/`worker` containers may still be up, and the old code
reads `user_presence`, `chat_message_recipients` and `zone_id`. The release runbook (`docs/admin-runbook.ko.md`) is:
1. `docker compose stop web realtime worker` (the town is briefly offline).
2. Back up the database (`pg_dump -Fc`), and keep the dump with the release.
3. `docker compose run --rm migrate` with the new image.
4. `docker compose up -d`.

**Rollback** after step 3 means restoring the step-2 dump together with the old images; rolling back the images
alone is not possible because `0002` drops tables. The runbook states this explicitly.

---

## 8. Privacy notice and docs

### 8.1 `docs/privacy-notice.ko.md` and `ko.privacy` (`/privacy`): version **2026-11** (forces re-acceptance)
The welcome / re-consent wizard adds a step **"활동 공유"**:
- two explicit buttons, `공유하기` / `공유하지 않기`, with nothing preselected;
- a preview line under each: `동료에게 이렇게 보여요: 회의 중 ~11:00 (캘린더 일정)` / `직접 상태를 정했거나 타운을 열어 두었을 때만 보여요`;
- one line under both (reciprocity, D21): `타운을 열면 보통 내 아바타도 자리에 보여요(서로 보기). 설정 > 접속 표시를 끄면 타운을 열어도 보이지 않아요.`

**Single source of the Korean text:** `ko.privacy` (WP-E) holds the notice text below; WP-F copies it verbatim into
`docs/privacy-notice.ko.md` after WP-E lands (§12).

**수집 항목**, new and changed rows:

| 항목 | 출처 | 공개 범위 | 보존 |
|---|---|---|---|
| 지금 상태(회의·집중·부재)와 끝나는 시각(부재는 끝나는 시각 없음) | **본인의 Claude**(캘린더), 활동 공유를 켠 경우에만 | 사내, **근무 시간(평일 08:30–19:30)에만, 실시간으로만** | 당일만(다음 날 새벽 삭제), 이력 없음 |
| 지금 하는 일의 종류(개인 업무·문서·검토·협업)와 끝나는 시각 | **본인의 Claude가 최근 업무 흔적(문서·커밋·PR·리뷰)을 보고 판단한 활동**, 활동 공유를 켠 경우에만. 이름표에만 붙고 아바타를 나타나게 하지 않음 | 사내, 근무 시간에만, 실시간으로만 | 당일만, 이력 없음 |
| 오늘 업무 일정의 시각과 종류(제목·참석자·장소·사유 없음) | 본인의 Claude | 목록은 본인만, 동료에게는 '지금 상태'만 | 당일만 |
| 업무 항목·일정 식별자(티켓·PR·캘린더 일정 ID) | 본인의 Claude | **표시하지 않음.** 식별자를 그대로 저장하지 않고 하루 단위 키로 변환한 값만 저장하며(운영자도 내용 대신 일치 여부만 사용), 각자의 Claude가 같은 항목을 보고했을 때 '함께 하는 일'로 묶는 데만 사용 | 당일만 |
| 내 상태(대화 가능·집중·회의 중·휴식·자리 비움) | 본인 입력 | 사내, 근무 시간에만 | 현재 값만(만료 후 삭제) |
| 상태 문구 | 본인 입력 | 사내, 근무 시간에 내가 보이거나 '자리 비움'일 때만 | 본인이 바꿀 때까지 현재 값만 |
| 타운 접속 여부 | 시스템 | 사내, 근무 시간에만(설정 > 접속 표시를 끄면 표시 안 함) | **저장하지 않음**(서버 로그에도 사용자별 접속 기록을 남기지 않음) |

- In the existing table, change `타운 채팅(근처·전체·DM)` to `타운 채팅(전체·DM)`, and replace the row
  `접속 위치·상태, 감사 기록(내용 제외) | 시스템 | 관리자(감사), 사내(접속 상태)` with
  `감사 기록(도구 호출 시각, 내용·활동 정보 제외) | 시스템 | 관리자(감사)`. The new rows above replace 접속 위치·상태.
- Retention table: add `활동 보고 | 당일(다음 날 새벽 삭제)`; change `근처·전체 채팅` to `전체 채팅`.
- **데이터 흐름** section (and `ko.privacy` section 6): add `내가 직접 정한 상태(owner_status)와 오늘 저장된 내 활동·일정은 내 Claude가 다음 체크인 때 읽을 수 있도록 내 Claude에게만 전달됩니다.`

**New section "화면이 뜻하는 것과 뜻하지 않는 것":**
- 아바타는 사람이 조작하지 않습니다. 본인이 정한 상태, 타운 접속, 본인 Claude가 보낸 캘린더 일정으로 ENU Town이 자리에 앉히거나 회의 테이블·동료 자리·탕비실로 옮깁니다. 본인 Claude의 '지금 하는 일'과 오늘 업무 기록은 이름표나 자리 표시판에만 붙습니다.
- **아바타의 위치와 움직임은 실제 위치가 아니라 업무 상태를 나타냅니다.** 자리에 보이는 것은 출근·근무 시간을 뜻하지 않으며, 아바타가 없다는 것은 '지금 알려진 활동이 없다'는 뜻일 뿐입니다.
- 함께 있는 모습은 각자의 Claude가 같은 일정(3명 이상)이나 같은 작업을 **각각** 보고했고 모두 활동 공유를 켠 경우에만 보입니다. 1:1 일정은 묶지 않습니다. 다른 사람의 Claude는 내 아바타를 움직일 수 없습니다.
- ENU Town은 키보드·마우스 사용이나 화면을 보고 있는지를 측정하지 않고, 메일·커밋 시각을 받지 않습니다. 활동 공유를 켜면 **본인의 Claude가 최근 업무 흔적을 보고 판단한 '지금 하는 일'의 종류**만 받아 'Claude 보고'로 표시합니다.
- 타운을 열면 보통 내 아바타도 보입니다(서로 보기). 설정 > 접속 표시를 끄면 타운을 열어도 나와 접속 표시가 보이지 않습니다.
- 근무 시간 외·주말·공휴일에는 누구의 상태도 다른 사람에게 보내지 않습니다.
- DM·업무 요청·부르기는 누가 누구에게 보냈는지도 다른 사람에게 표시하지 않습니다.
- **근태 확인·성과 평가·징계 자료로 사용하지 않습니다.** 접속·위치·상태의 이력은 저장하지 않으므로 관리자도 조회할 수 없습니다. 감사 기록에는 도구 호출 시각만 남고 활동 내용은 남지 않습니다.

**권리 / 처리 정지:** `/me > 설정 > 활동 공유`에서 언제든 끌 수 있고, 끄면 오늘 보고된 활동이 즉시 삭제됩니다. `/me > 설정 > 접속 표시`를 끄면 타운을 열어도 표시되지 않습니다. '자리 비움'으로 언제든 화면에서 빠질 수 있습니다.

**Review banner** (keep, and extend):
- 근로자 감시 설비 해당 여부 확인;
- 30인 미만이라 노사협의회 의무는 없더라도 시행 전 전 직원 설명회·의견 수렴;
- 경영진의 "근태·평가 미사용" 서면 확인 (ADR 0004에 기록).

### 8.2 Other docs
- **New `docs/adr/0004-town-is-a-visualization.md`:**
  - no steering; a server director;
  - P1–P8;
  - `resolveActivity` + `projectForColleagues` are the only source of avatar state; Claude's `now` and the log only label;
  - mutual corroboration (meetings ≥ 3);
  - nothing shown after hours;
  - no presence/activity history and no admin view. Any proposal for these needs a new ADR plus an HR review.
- **`docs/adr/0003-visibility.md`** addendum: `canShareActivity`, `canShowLive`, `canViewLogTimestamps`,
  `ANY_COLLEAGUE`, and `projectForColleagues` as the single colleague projection (office-hours neutral, `online`
  without grace, `부재` without until/source, 상태 문구 only while shown or away, "grouping requires every member").
- **`docs/adr/0002-pet-text-source.md`** addendum: the new tool carries no free text; on-map text is ENU Town UI text,
  human-typed text, or the existing verbatim work log.
- **`docs/architecture.md`:**
  - realtime box: "director · pets · chat · owner-only pet bubbles";
  - check-in data flow: step `post_activity → activity_reports → activity_changed → director`;
  - the invariants table adds `activity.ts`, `groups.ts`, `canShareActivity`, `projectForColleagues`;
  - the pet data-flow step (line 38, "on join, on idle, or when something is due") becomes "on join, when a nudge
    first becomes eligible, when the owner returns to the tab, or when something is due"; colleagues see `…` only
    while the owner is shown;
  - replace the "Phase 2 seam" (`computeProximityGroups`) with "a future meeting voice room = the gathered meeting group".
- **`CLAUDE.md`:**
  - "the four MCP tools" becomes "the five MCP tools";
  - realtime layout: "director (server-placed avatars), pets, chat, pet bubbles";
  - new rules: "Avatars are never steered; every avatar state comes from `resolveActivity` + `projectForColleagues`
    over real inputs — never fabricate motion or activity." · "No presence/activity history; `activity_reports` is
    current-day only; no activity metadata in audits and no per-user connection lines in logs." · "Colleagues' state
    is shown only during office hours."
- **`docs/employee-onboarding.ko.md`:**
  - replace the `이동 | WASD/방향키 또는 바닥 클릭` row with `보기 | 휠로 확대·축소, 드래그로 화면 옮기기, 사람을 눌러 메뉴`;
  - the `지난 대화 보기` row drops `함께 들은 근처 대화`;
  - add `내 상태` (options + 언제까지), `활동 공유` and `접속 표시`;
  - remove 근처 대화.
- **`docs/admin-runbook.ko.md`:**
  - there is no attendance or presence report, by design (`"언제 왔는지 볼 수 있나요?" → 아니요`);
  - troubleshooting row "someone is shown or not shown": check their manual status, calendar blocks, `share_activity`, `show_live` (a `now` or log only labels);
  - `TOWN_IGNORE_OFFICE_HOURS` is dev/e2e only;
  - the §7.5 release steps (stop → backup → migrate → up) and "rollback = restore the backup with the old images".
- **`docs/runbooks/dev-connector.md`:** "all four tools" becomes "all five tools".
- **`docs/pilot/claude-pilot-checklist.md`:** verify that the claude.ai Google Calendar connector exposes `iCalUID`
  and attendee counts, and that three attendees' Claudes produce the same `gcal:` ref.
- **`README.md`:** "a live map of 606호 showing teams working and interacting; five MCP tools"; the layout row
  `apps/realtime | … 이동, 펫, …` (line 19) becomes `apps/realtime | Colyseus 0.18: 자리 배치(디렉터), 펫, 채팅·DM, 말풍선 표시`.

---

## 9. Test plan

### 9.1 Unit (`pnpm test`)
- **`packages/domain/test/activity.test.ts`**:
  - a table-driven test with one row per precedence row 2–10;
  - combinations:
    - manual beats blocks;
    - `away` block beats live;
    - meeting > focus > now > log > live;
    - a fresh `now` or a qualifying log with `live=false` gives `shown=false`, `note=none` and the label; with
      `live=true` it gives `shown=true` and the label;
    - `share=false` ignores every Claude input, including the log;
    - an expired manual status is ignored;
    - `now` at `until` is not fresh;
    - a planned-only log gives no label;
    - a private or deleted log gives no label;
  - truthfulness properties by exhaustive enumeration over small domains:
    - `shown ⇒` a manual non-away status, a current meeting/focus block with share, or live;
    - `source='claude' ⇒ now < until`;
    - `groupKey ≠ null ⇒ share`;
  - `manualStatusUntil` for every duration, the midnight cap and `today` after 19:30 (all in `APP_TIMEZONE`);
  - `isOfficeOpen` at 08:29, 08:30, 19:29 and 19:30, on a weekend, a holiday and with `ignore`.
- **`packages/domain/test/groups.test.ts`**:
  - a meeting needs 3 (2 matching gives no group);
  - mutual only;
  - different families do not merge;
  - the largest meeting gathers (ties by id);
  - a group larger than `meetingSeats` does not gather;
  - work host rule (the reviewer visits; desk order);
  - work groups larger than 3, or with a hidden member, are linked but not gathered;
  - a member with a `null` (unshared) key never joins a group;
  - ids are stable within a day and differ across days;
  - a shuffled input gives the same output.
- **`packages/domain/test/validation.test.ts`**: `prepareActivity`, covering every rejection row of §4.1, the
  `until` default and clamp, sort and dedupe, the whole-day `away` (`00:00`–next `00:00` is accepted), a block ending
  exactly at the next midnight (accepted), a block starting before today's midnight or ending after the next one
  (rejected), and midnight edges in Asia/Seoul. `WORK_REF_PATTERN` accepts an iCalUID with `+ = { }` and rejects
  spaces and > 180 characters.
- **`packages/domain/test/visibility.test.ts`**:
  - `canShareActivity` (null, false, true × active/inactive author), `canShowLive`, `canViewLogTimestamps`, and
    `ANY_COLLEAGUE` with `canViewLog`;
  - `projectForColleagues`: `!officeOpen ⇒ NEUTRAL_PROJECTION` for every input; `note=absent ⇒ until=null ∧
    source='none'`; `online` is false for a shown person who is only within the grace or the `onDrop` hold, and for
    a hidden connected person; `statusText` is '' unless shown or `away`; `share=false ⇒ groupKey=null`.
- **`packages/domain/test/nudge-policy.test.ts`**: `idle` is gone; the order `due > urgent > join > eligible >
  glance`; `eligible` fires only for `shownCount = 0` after `join`, and respects the interval and DND; `glance` needs
  ≥ `glanceHiddenMs` hidden, fires once, and may pick a nudge with `0 < shownCount < maxShows`; `officeOpen=false`
  gives `quiet` even with no quiet hours configured.
- **`packages/protocol/test/state.test.ts`**: the new fields encode and decode; `Pet.bubble*` stays `.view()`-only.
- **`packages/map/test/spots.test.ts`**: on the generated 606 map:
  - 12 meeting seats with the facings in §2.3;
  - break spots in the pantry, facing down;
  - guest spots equal the walkable `world.spawn` tiles;
  - ≥ 1 visitor tile per desk, including R1; `perch(deskId)` is the faced desk-surface tile for all 14 desks;
  - every spot reachable from every seat;
  - `allocateSpots` is deterministic, has no duplicates, keeps current holders and falls back on overflow (13 in a
    meeting, 20 on a break, 6 desk-less guests: all placed, overflow by BFS).
  - `pnpm map:check` asserts the same.
- **`packages/sprites/test/sprites.test.ts`**: the effects sheet has 3 rows and the new icon names at indices 16–23.
- **`apps/realtime/test/Walker.test.ts`**: cadence, stagger start, retarget mid-walk, teleport when unreachable, arrival anim and facing.
- **`apps/realtime/test/Director.test.ts`** (fake `now`/`nowMs`, real 606 world):
  - snap at create;
  - hidden→shown places directly;
  - a 10:00 meeting block for 3 matching users walks them to chairs and 11:00 walks them back;
  - 2 matching users stay at their desks with a headset;
  - a review/work pair stands on the visitor tile;
  - a manual break goes to the pantry;
  - closed phase → `NEUTRAL_PROJECTION` for all, pets asleep, every `indicator = None`;
  - live grace: 59 s shown, 61 s hidden, measured from `setSession('ended')`; `held` is live but not `online`;
  - `show_live=false`: connected with no other signal → hidden and not `online`;
  - a calendar `away` block → `Player.until = 0`, `source = None`;
  - a fresh `now` without live → hidden with the plate label;
  - `indicator` is `Dots` only while the owner is shown and drops to `None` when the owner becomes hidden mid-bubble;
  - `noteLogWrite(id, 'user')` and a write at fake 20:00 do not bump `logPulse`;
  - `upsertActor` on an existing id keeps the same `Player` and `Pet` instances;
  - unchanged inputs give zero writes;
  - same inputs give the same snapshot.
- **`apps/realtime/test/NudgeScheduler.test.ts`**: the DND, `officeOpen` and `indicatorAllowed` hooks come from the director; `glance` bookkeeping.
- **`apps/realtime/test/BubblePresenter.test.ts`**: `indicatorAllowed=false` keeps `indicator=None` while the bubble
  fields are set; the `trigger: 'idle'` case (line 96) uses `'glance'`.
- **`apps/web/src/game/logic/camera.test.ts`**: `fitZoom` (1600×894 → 1.5, 1120×844 → 1, 2240×1360 → 2, 1366×712 → 1),
  cursor-anchored zoom, button steps, pan clamp.
- **`apps/web/src/realtime/RealtimeSession.test.ts`**: no `sendStep`/`sendFace`; `wave(toUserId)`; room-only chat; `protocol` in the join options; 4111 → guarded reload; the `notice_required` join error → `/welcome`; the new Player fields reach `PlayerSnap` (and `status`/`zoneId` do not).
- **`apps/web/src/components/town/*.test.ts`**: the §5.3 label table; team-rail ordering; the StatusMenu payload;
  the menu, rail, plate, ProfileCard and `접속 N명` count use `Player.online`/`shown`/`note` and never "a Player
  exists" (a roster member who is not online gets no dot, a disabled `부르기` and the new `offlineAction` text).
- **`packages/mcp-tools/test/tools-list.test.ts`**: five tools, none with `requiresUserInteraction`, no input property named `user_id`, `email` or `with` in any schema.

### 9.2 Integration (`pnpm test:int`, Postgres `_test`)
- **`packages/mcp-tools/test/activity.int.test.ts`**:
  - `stored` writes the row and NOTIFY `activity_changed` in the same transaction (LISTEN);
  - `schedule` omitted keeps the stored list; `[]` clears it;
  - `now: null` clears;
  - `share_activity` null or false → `skipped_sharing_off` and **no row**;
  - a rejection saves nothing;
  - the raw ref is not present anywhere in the table (text search), and hashes differ across days;
  - `owner_status` is returned;
  - the rate limit refuses the 21st call;
  - the `activity.post` and `activity.skipped` audit rows have empty metadata (no `now_kind`, no counts, no refs);
  - **share-off race:** with a held `PATCH share_activity=false` transaction (row locked, not yet committed), a
    concurrent `post_activity` blocks, then returns `skipped_sharing_off` after the commit; no row exists for today,
    and turning sharing back on the same day shows no report;
  - `period_key` is the `APP_TIMEZONE` date even when the owner's `profiles.timezone` differs.
- **`packages/mcp-tools/test/context.int.test.ts`**: the `activity` section (`sharing`, `now`, `schedule` with `has_ref`, `owner_status`); it is omitted when `skip`; the Korean summary line.
- **Roster pickup in int tests:** users created in the DB after the room exists are picked up by a helper
  `syncRoster(h)` in `test/helpers/server.ts`, which awaits the server room's `resyncAll()`. Tests never rely on a
  join creating an actor.
- **`apps/realtime/test/director.int.test.ts`** (real room, `OffsetClock`, replaces `movement.int.test.ts`):
  - with **no client connected**, a user with a company-visible log containing an `in_progress` task is hidden with
    `activity=Today` (plate label), a zero-task log gives no label, and the same user becomes `shown` with the label
    once connected;
  - 3 seeded reports with the same meeting ref put 3 players on meeting chairs at block start;
  - `status:set away` hides immediately and persists across a room restart; `auto` clears it and keeps 상태 문구;
  - `activity_changed`; `work_log_changed {by:'claude'}` bumps `logPulse` only when the log is company-visible, the
    owner shares and is shown in office hours; `{by:'user'}` and a fake-20:00 write never bump it;
  - **`desks_changed` during an active bubble:** the owner still decodes `bubbleText` afterwards (same `Pet` instance);
  - `user_deactivated` removes the actor;
  - `step` → `UNKNOWN_MESSAGE`;
  - a join without `protocol` fails in matchmaking with 4111.
- **`apps/realtime/test/privacy.int.test.ts`** (real clients decoding their state):
  - B's decoded `pets[A]` has empty `bubble*`, and A's bubble text bytes never appear in B's patches;
  - B never decodes `pets[A].indicator = Dots` while A is hidden (calendar `away`, manual `away` or `show_live=false`)
    or at fake 20:00, even while A's own client shows a bubble;
  - at fake 20:00 every Player is `NEUTRAL_PROJECTION` for both clients, and A's due nudge shows no bubble (forced quiet);
  - a calendar `away` block for A → B decodes `until=0`, `source=None`;
  - **ping parity:** a ping to a hidden-but-connected user, to a disconnected user, to an unknown id and to a user in
    the 60 s grace all answer the identical `NOT_ONLINE` payload;
  - a wave to a hidden target → `NOT_SHOWN`;
  - a DM produces no message at a third client.
- **`apps/realtime/test/auth.int.test.ts`** (updated): a ticket for a user without onboarding, or without a
  `2026-11` service consent, is refused with `notice_required`; the `players.size === 1` assertion (line 115) becomes
  "14 roster actors, 1 session"; the `step` after reconnect (line 140) and the presence-restore test (lines 144–155)
  are deleted; spawn assertions become "the actor keeps its director spot".
- **`apps/realtime/test/events.int.test.ts`** (updated): players exist for all roster members regardless of
  connections; assertions on "player appears on join / disappears on leave" become `shown`/`online` assertions.
- **`apps/realtime/test/chat.int.test.ts`**: the nearby cases are removed; room and DM kept.
- **`apps/worker/test/retention-purge.int.test.ts`**: yesterday's `activity_reports` purged, today's kept (at 00:30
  and 23:30 `APP_TIMEZONE`); expired manual statuses cleared with `status_text` untouched; nearby gone.
- **`packages/db/test/migrate.int.test.ts`** (new): the truncated-journal procedure of §7.1 (seed nearby rows,
  recipients, a zoned room message and `user_presence` under `0001`, then apply `0002`).
- **`apps/web/test/api.int.test.ts`**:
  - `PATCH share_activity=false` deletes today's report and emits both events; `PATCH show_live` emits `profile_changed`;
  - onboarding requires `share_activity`;
  - the export contains `activityReports` without hashes, and chat rows without `zoneId`;
  - `chat-history kind=nearby` → 400 (the nearby cases at lines 469–521 are replaced by this one);
  - as a colleague, `/api/v1/people` and `/api/v1/users/:id/card` contain no `statusText`/`lastWorkLogAt`, and
    `latestLog.claudeWrittenAt`/`updatedAt`/`userEditedAt` are `null` while `editedByUser` is kept; the owner still
    gets them through `/api/v1/me` and their own log views;
  - the log `PATCH`/`DELETE` routes emit `work_log_changed` with `by: 'user'`.

### 9.3 E2E (`pnpm test:e2e`, realtime with `TOWN_IGNORE_OFFICE_HOURS=true` and `NUDGE_IGNORE_QUIET_HOURS=true`)
- **`apps/e2e/tests/claude-flow.spec.ts`** (extended):
  - the tool list now has 5 names;
  - L1b's and L2a's Claudes call `post_activity` with `now: {kind:'work', ref:'jira:ENU-301'}` and `{kind:'review', ref:'jira:ENU-301'}`;
  - L1b and L2a have the town open (so they are shown); within 5 s a third browser (L3a) sees L2a standing on a
    visitor tile of L1b (debug hook `playerTile(id)`), both with the same `groupId`, and the team rail shows
    `검토 중 · Claude 보고` (§5.3 labels).
- **`apps/e2e/tests/visualization.spec.ts`** (new):
  - WASD, arrow keys and floor clicks send no `step` or `face` message (a `framesent` spy that ignores legitimate
    frames such as `presence`) and change no tile;
  - no `옆으로 가기`; no 근처 tab;
  - with a realistic maximized-1080p viewport of **1920×950** (rail docked), `zoom() === 1.5` and every desk plate is
    inside the canvas; at the config default 1440×900, `zoom() === 1`;
  - a roster member who has not opened the town has no online dot and a disabled `부르기`;
  - setting `집중 모드 · 30분` is visible to a second browser as `집중 모드 · 직접 설정`; `자동` clears it;
  - `자리 비움` hides the avatar and the plate reads `자리 비움 · ~HH:MM`;
  - a wave is visible to a third browser.
- **`apps/e2e/tests/privacy.spec.ts`** (new): the owner turns `활동 공유` off in `/me`, and within 2 s the colleague
  no longer sees the Claude-derived activity; the owner turns `접속 표시` off, reloads `/town`, and the colleague sees
  only the name on the owner's plate.
- **Policy:** `pnpm check:policy` is unchanged and must pass (no LLM dependencies); `pnpm lint` includes the
  clock/randomness ban of §6.8.

---

## 10. Things to delete or rename

**Protocol (`packages/protocol`)**
- Delete:
  - `C2S.step`, `C2S.face`, `MSG.step`, `MSG.face`, `MSG.moveCorrect`;
  - `StepMsg`, `MoveCorrectMsg`;
  - `ChatMsg.zoneId`, `chatSend.channel`;
  - `Status`, `STATUS_LABEL_KO`;
  - `Player.status`, `Player.zoneId`.
- Change: `wave` and `EmoteMsg` gain `toUserId`; `ChatMsg.kind` becomes `'room'`.
- Add: `ActivityCode`, `SourceCode`, `PlateNote`, `PROTOCOL_VERSION`, `CloseCodes.ProtocolMismatch = 4111`.

**Shared / domain**
- Delete:
  - `LIMITS.nearbyRadiusTiles`, `NUDGE_POLICY.idleMs`;
  - `Trigger 'idle'`, `PolicyTiming.idleMs`, `SchedulerFlags.idleArmed`, `OwnerPresence.lastActivityAt`.
- Add:
  - `glanceArmed`, `NUDGE_POLICY.glanceHiddenMs` + `PolicyTiming.glanceHiddenMs`, `OwnerPresence.officeOpen`,
    `eligible`/`glance` triggers;
  - `activity.ts`, `groups.ts`, `hash.ts`, `prepareActivity`, `canShareActivity`, `canShowLive`,
    `canViewLogTimestamps`, `projectForColleagues`, `NEUTRAL_PROJECTION`, `ANY_COLLEAGUE`.
- Change (`packages/shared/src/schemas/dto.ts`): `PersonDto` drops `statusText`/`lastWorkLogAt`; `WorkLogDto`
  timestamps become nullable; `ChatItemDto.kind` becomes `'dm' | 'room'` and `ChatItemDto.zoneId` is deleted (also the
  `kind=nearby` line of the doc comment); `MeDto` gains the §7.4 fields.
- Change (`packages/shared/src/schemas/events.ts`): `work_log_changed.by`.

**Map**
- Delete `src/proximity.ts` (`nearbyRecipients`, `computeProximityGroups`, `ISOLATED_ZONE_IDS`), its export and `test/proximity.test.ts`.
- Add `spots.ts` and `OfficeWorld.spots`. `world.spawn` / `OFFICE_606_SPAWN` stay as the single definition of the
  guest spots and the validator's reachability origin.

**Realtime**
- `OfficeRoom` deletes:
  - `handleStep`, the `face` handler, `relocate`, `refreshZone`, `applyStatus`, `restAnim`;
  - `proximityList`, `nearbyOf`, `tileNextTo`, the nearby branch of `handleChat`;
  - `ISOLATED_ZONES`, `AUTO_TEXT_ZONES`, `WALK_SETTLE_MS`, the spawn logic;
  - `Session.player/pet/follower/baseStatus/customStatusText/lastStepAt`.
- `world/Movement.ts`: delete `createStepGate`, `STEP_MIN_INTERVAL_MS`, `STEP_BURST`, `chooseSpawn`, `SpawnPoint`, `SpawnInput`. Keep `stepTarget`, `dirBetween`, `manhattan`, `samePoint`, `opposite`, `adjacentWalkable`.
- Delete `infra/presence.ts`.
- `rooms/limits.ts`: delete `step`, `stepFlood`, `face`.
- `NudgeScheduler.noteActivity`: delete.
- `ChatService`: delete the nearby path and the recipients write.
- `BubblePresenter`: the unconditional `pet.indicator = Indicator.Dots` (line 97) goes through `indicatorAllowed`.
- `OfficeRoom` logging: drop `userId` from the `player joined` (line 294) and `player left` (line 349) lines.
- Tests:
  - delete `test/movement.int.test.ts` and the step-gate/spawn cases in `test/Movement.test.ts`;
  - `test/helpers/server.ts`: remove `userPresence` and `walk()` (lines 200–208); `makeUser`'s `at` option is
    deleted; add `syncRoster(h)`;
  - `test/auth.int.test.ts`, `test/events.int.test.ts`, `test/chat.int.test.ts`, `test/BubblePresenter.test.ts`:
    updated as listed in §9.

**DB**
- Drop `user_presence`, `chat_message_recipients`, `chat_messages.zone_id`.
- Delete the Drizzle exports `userPresence`, `chatMessageRecipients`.
- Remove the nearby seed.

**Web**
- Delete `game/logic/movement.ts` + `movement.test.ts`; `direction.ts` `keyToDir` and its test case
  (`direction.test.ts`, "maps WASD and arrows", line 78).
- **"Online" semantics everywhere.** All 14 actors are always in state, so `getPlayer(id) !== undefined` and
  `roster.length` no longer mean anything. Switch each to `Player.shown` / `Player.online` / `note`:
  - `WorldScene.refreshPlates` (lines 199–208): plates read `shown`/`note`/`activity` (hidden label, §1.3);
  - `WorldScene.onFloorClick` (lines 436–457): a desk click resolves desk → roster member and opens the menu
    (StatusMenu for my own desk), whether or not that member is shown; the floor itself does nothing;
  - `AvatarContextMenu.tsx:24`: `online = player?.online === true`; `offlineAction` text per §5.3;
  - `PeopleDirectory`: the `live` map, `offlineDot` and the count use `online`; the status label uses the §5.3 table;
  - `ProfileCard`: the status dot uses `online`; the status line comes from the Player fields; delete the 위치 row
    (line 42, `zoneLabel`) and `ko.townUi.profile.zone`;
  - `TownShell.tsx:252`: `접속 N명` counts `online` Players (not `roster.length`);
  - `NameTag.setStatus`: driven by `activity`/`source`, not the deleted `status`.
- `RealtimeSession`: delete `zoneId` and `status` from `PlayerSnap` (lines 118–120) and from
  `ROSTER_PLAYER_FIELDS` (line 179); add the new Player fields; map 4111 and `notice_required` (§9.1).
- `WorldScene`: delete `bindInput` keys and floor click-to-move, `walkTo`, `walkToUser`, `showMarker`/`marker`, `onCorrect`, `mover`, `keysDown`, `textFocused`, `allowsMovementKeys`, the follow-me logic and the `myTile` debug hook (replaced by `playerTile(id)`, `zoom()`).
- `EventBus`: delete `move:to-user`, `move:unreachable`, `ui:text-focus`.
- `RealtimeSession`: delete `sendStep`, `sendFace`, `move:correct`.
- `camera.ts`: delete `chooseZoom`, `TARGET_VIEW`; `MIN_ZOOM` becomes 1; add `fitZoom` and `OVERVIEW_RECT`.
  `WorldScene`: delete `zoomBias`; `camera:zoom {delta}` steps through the zoom list (`0` = fit).
- Components and server:
  - delete the ChatDock 근처 tab, the PastChatsPanel `nearby` tab, `TownContext` `'nearby'`, the `api.ts` / `chatLogic.ts` nearby kind, `server/queries/chat.ts` `HistoryKind 'nearby'`, the chat-history route nearby;
  - delete the `AvatarContextMenu` walk-to item;
  - `TownShell`: delete the text-focus effect, the unreachable toast and `goTo`.
- `ko.ts`: delete `menu.walkTo`, `townUi.unreachable`, the nearby strings, `toast.goTo`, `townUi.profile.zone`;
  add the §5.3 label table, `townUi.protocolMismatch`, the legend and `접속 표시` strings; rewrite `canvasLabel` to
  `A동 606호 사무실 지도. 사람을 누르면 메뉴가 열려요. 오른쪽 목록에서도 똑같이 볼 수 있어요.`
- `app/(site)/me/SettingsTab`: the `활동 공유` and `접속 표시` toggles.

**Web server (WP-B)**
- `apps/web/src/server/dto.ts`: `toPersonDto` drops `statusText`/`lastWorkLogAt` (lines 80–82); the log DTO uses
  `canViewLogTimestamps`; `toChatItemDto` (lines 203–213) drops `zoneId` and narrows `kind`.
- `server/queries/export.ts` (lines 50, 94): drop `zoneId`.
- `server/queries/logs.ts` (lines 236, 268): `work_log_changed` gains `by: 'user'`.

**Docs:** remove WASD and nearby mentions; replace the Phase 2 seam paragraph; bump both versions.

**Renames:** none (`Player` keeps its name with a new doc comment).

---

## 11. Open questions, each with a recommended default

| # | Question | Recommended default |
|---|---|---|
| 1 | Default for `share_activity` | **Explicit choice at re-consent, nothing preselected** (null = off). Revisit after a 2-week pilot with an anonymous survey, not usage metrics |
| 2 | Does the claude.ai Calendar connector expose `iCalUID` and attendee counts? | **Assume yes; verify in the pilot.** If refs don't match, meetings fall back to "solo at desk with headset", which is truthful and needs no code change |
| 3 | Should a calendar `away` block beat an open town? | **Yes** (protects people on leave). They can set a manual non-away status to appear (§2.2 row 3 beats row 4) |
| 4 | Help-wanted flag from `blockers` | **Not in v1.** It can read as a performance signal; blockers stay readable in the work log |
| 5 | Team hand-off flights (`with_teams` on tasks) | **Not in v1.** Reconsider after the pilot with HR |
| 6 | Today ticker / feed, task-done ✓ pop, team counts | **Not in v1** (history-like or comparative). The log sparkle is the only event FX |
| 7 | Should the viewer's own avatar be drawn after hours? | **No.** The banner explains; it can be added client-only later |
| 8 | Fractional zoom 1.5 shimmer | **Allow it only at fit;** fall back to 1 if the art review objects |
| 9 | Meeting group minimum | **3** (server). If pilots want visible pair meetings, keep 3 and use `collab` with a ticket ref instead |
| 10 | Wall/TV kiosk display | **Not in v1.** It needs a non-person identity that watches without being listed. Separate ADR |
| 11 | Multiple tabs per user | **Keep one session per user** (`SessionReplaced`); viewing is passive anyway |
| 12 | `activity_reports` retention | **Purge at 03:17 the next day.** No owner-facing history beyond today plus export |
| 13 | Show `statusText` on hidden plates | **Only for `away`** (owner-typed and owner-chosen) |
| 14 | Claude Code hooks posting `now` automatically | **Not in this change;** `source_hint: 'claude_code'` already works for interactive use |
| 15 | Default of `show_live` (접속 표시) | **On** (reciprocal "서로 보기", stated in the wizard, legend and notice); revisit with the pilot survey |

---

## 12. Implementation work packages

All packages land on one feature branch. Each package's acceptance is checked per package; the repo-wide gate is
green only after WP-E. **No file is edited by two packages concurrently.** The web server files belong to WP-B and the
web client files to WP-E. `apps/web/src/i18n/ko.ts` belongs to WP-E, with one sequenced exception: WP-A adds any
`ko.errors.*` key that WP-B's server code needs (e.g. `ko.errors.shareActivityRequired`) before WP-B starts, and
WP-E edits the file only after WP-A is merged. Zod failures keep using the existing generic validation error.

**Dependency order:** **WP-A** and **WP-C** start in parallel. **WP-B** needs A. **WP-D** needs A, B and C. **WP-E**
needs A, B, C and D. **WP-F** needs A and can run in parallel with B–E, **except** `docs/privacy-notice.ko.md`,
which WP-F writes after WP-E by copying `ko.privacy` verbatim (the single source of the notice text).

### WP-A: Contracts and pure rules
- **Files:**
  - `packages/shared/src/{constants.ts, schemas/mcp.ts, schemas/events.ts, schemas/rest.ts, schemas/dto.ts, env/index.ts, index.ts}`;
  - `packages/protocol/src/**`, `packages/protocol/test/**`;
  - `packages/domain/src/{activity.ts, groups.ts, hash.ts, visibility.ts, validation.ts, nudge-policy.ts, index.ts}`, `packages/domain/test/**`;
  - `packages/testing/**` (`createTestUser` gains `shareActivity`, `showLive`, `onboarded` and `noticeVersion`
    options, used by WP-B and WP-D);
  - `apps/web/src/i18n/ko.ts`, `ko.errors.*` additions only (see above);
  - `eslint.config.js` (the §6.8 clock/randomness ban).
- **Content:** §2.1 constants (incl. `TOWN_IGNORE_OFFICE_HOURS` in `realtimeEnvSchema`, refused in production);
  §4.1–4.2 zod schemas; §7.2 events; §7.4 DTO/REST shapes; §6.3–6.4 protocol (incl. `CloseCodes.ProtocolMismatch`);
  §2.2–2.3, §3.2, §5.7 domain functions.
- **Acceptance:** all §9.1 domain and protocol tests pass; `resolveActivity`, `projectForColleagues` and
  `groupPeople` reach 100 % branch coverage of the precedence table and projection rules; no `node:` imports in domain.
- **Verify:**
  ```bash
  pnpm --filter @enu/shared typecheck && pnpm --filter @enu/shared test
  pnpm --filter @enu/protocol typecheck && pnpm --filter @enu/protocol test
  pnpm --filter @enu/domain typecheck && pnpm --filter @enu/domain test
  pnpm exec eslint packages/shared packages/protocol packages/domain eslint.config.js && pnpm check:policy
  ```

### WP-B: Data, connector and web server
- **Files:**
  - `packages/db/**` (schema, `migrations/0002_town_visualization.sql` + meta, `seed/dev.ts`, new `test/migrate.int.test.ts` + int config if missing);
  - `packages/mcp-tools/**` (`services/activity.ts`, `services/context.ts`, `owner.ts`, `server.ts`, `descriptions.ts`, `rate-limit.ts`, `index.ts`, tests);
  - `apps/worker/**` (`jobs/retention-purge.ts`, tests);
  - `apps/web/src/server/**` (`queries/{me,profile,onboarding,export,chat,logs,people}.ts`, `dto.ts`);
  - `apps/web/src/app/api/realtime-ticket/route.ts` is unchanged (the consent gate lives in `verifyTicket`, WP-D);
  - `apps/web/src/app/api/**` (incl. `mcp/route.ts` with the HKDF key and `officeTimeZone`, and `v1/users/[id]/chat-history/route.ts`);
  - `apps/web/test/{api,mcp}.int.test.ts` and `apps/web/test/dto.test.ts` (it tests `server/dto.ts`); other
    `apps/web/test/*` files belong to WP-E.
- **Acceptance:**
  - the migration applies cleanly on PG 16 from `0001` with data (§7.1 procedure);
  - `pnpm db:generate` produces no further diff;
  - `post_activity` behaves as in §4.1 (all of §9.2 MCP cases);
  - `get_my_context.activity` is present;
  - five tools, none with `requiresUserInteraction`;
  - the retention purge deletes yesterday's reports;
  - REST as in §7.4 (no colleague-facing `statusText`, `lastWorkLogAt` or log timestamps);
  - every `work_log_changed` emitter sends `by`.
- **Verify:**
  ```bash
  pg_ctlcluster 16 main start
  pnpm --filter @enu/db typecheck && pnpm db:generate && git diff --exit-code packages/db/migrations/meta && pnpm --filter @enu/db test:int
  pnpm --filter @enu/mcp-tools typecheck && pnpm --filter @enu/mcp-tools test && pnpm --filter @enu/mcp-tools test:int
  pnpm --filter @enu/worker typecheck && pnpm --filter @enu/worker test && pnpm --filter @enu/worker test:int
  pnpm exec eslint packages/db packages/mcp-tools apps/worker apps/web/src/server apps/web/src/app/api
  ```
  (`@enu/web` typecheck is checked in WP-E, because client files still reference removed protocol symbols until then.)

### WP-C: World assets (map spots and icons)
- **Files:**
  - `packages/map/src/{spots.ts (new), world.ts, index.ts, validate.ts}`, `packages/map/bin/map-check.ts`;
  - delete `packages/map/src/proximity.ts` and `packages/map/test/proximity.test.ts`; add `packages/map/test/spots.test.ts`;
  - `packages/sprites/src/{spec.ts, effects.ts}`, `packages/sprites/test/**`.
- **Acceptance:**
  - `world.spots` is as in §2.3;
  - `map:check` asserts the spot rules;
  - **map hash unchanged** (no `.tmj` change);
  - the effects sheet gains row 3 with the §5.4 indices (`headset 16, focus 17, cup 18, laptop 19, magnifier 20,
    link 21, clipboard 22, plane 23`) and `sprites:build` succeeds; WP-E mirrors the same indices in
    `apps/web/src/game/spriteSpec.ts`;
  - guest spots come from `world.spawn`; `perch(deskId)` exists for every desk.
- **Verify:**
  ```bash
  pnpm --filter @enu/map typecheck && pnpm --filter @enu/map test && pnpm map:check
  pnpm --filter @enu/sprites typecheck && pnpm --filter @enu/sprites test && pnpm sprites:build
  git diff --exit-code apps/web/public/assets/maps && pnpm exec eslint packages/map packages/sprites
  ```

### WP-D: Realtime director
- **Files:** `apps/realtime/src/**` (new `director/{Director,Walker,codes}.ts`, `infra/roster.ts`; changed
  `auth/verifyTicket.ts`, `rooms/OfficeRoom.ts`, `rooms/limits.ts`, `infra/profiles.ts`, `pet/NudgeScheduler.ts`,
  `pet/BubblePresenter.ts`, `world/PetFollower.ts`, `world/Movement.ts`, `chat/ChatService.ts`; deleted
  `infra/presence.ts`) and `apps/realtime/test/**` (incl. `helpers/server.ts`, `auth.int`, `events.int`).
- **Acceptance:**
  - §6 behaviour;
  - all §9.1 realtime unit tests, plus `director.int`, `privacy.int`, `auth.int` and the updated chat, events and
    nudges integration tests;
  - a room with zero clients still places actors from the DB;
  - no clock reads or `Math.random` in `director/` (lint).
- **Verify:**
  ```bash
  pnpm --filter @enu/realtime typecheck && pnpm --filter @enu/realtime test && pnpm --filter @enu/realtime test:int
  pnpm exec eslint apps/realtime
  ```

### WP-E: Web client and e2e
- **Files:**
  - `apps/web/src/game/**`, `apps/web/src/realtime/**`, `apps/web/src/components/**`;
  - `apps/web/src/app/(auth)/**` (`WelcomeWizard` sharing step + reciprocity line), `apps/web/src/app/(site)/**`
    (`SettingsTab` toggles `활동 공유` and `접속 표시`, `/privacy` via ko);
  - `apps/web/src/i18n/ko.ts` (after WP-A's `ko.errors` additions);
  - `apps/web/test/*` except `api.int`, `mcp.int` and `dto.test` (WP-B);
  - `apps/e2e/**` (specs, `TOWN_IGNORE_OFFICE_HOURS` in the e2e realtime env).
- **Acceptance:**
  - §5 UX: no keyboard or click movement; overview camera; menus, tooltip, team rail, legend, StatusMenu, night
    banner, sparkles, group hull/links, wave arc, participant-only plane;
  - every §10 "online semantics" site uses `online`/`shown`/`note`;
  - `ko.privacy` holds the §8.1 text (the single source WP-F copies);
  - all §9.1 web unit tests and §9.3 e2e pass.
- **Verify:**
  ```bash
  pnpm --filter @enu/web typecheck && pnpm --filter @enu/web test && pnpm --filter @enu/web test:int
  pnpm --filter @enu/e2e typecheck && pnpm test:e2e
  pnpm exec eslint apps/web apps/e2e
  ```

### WP-F: Docs, skill and policy text
- **Files:** `docs/**` (`privacy-notice.ko.md` — after WP-E, `adr/0002`, `adr/0003`, new
  `adr/0004-town-is-a-visualization.md`, `architecture.md`, `employee-onboarding.ko.md`, `admin-runbook.ko.md`
  (incl. §7.5), `runbooks/dev-connector.md`, `pilot/claude-pilot-checklist.md`), `CLAUDE.md`, `README.md`,
  `claude/plugins/enu-town/**` (`SKILL.md`s, `references/*`, plugin `README.md`).
- **Acceptance:**
  - the §8 and §4.3 texts are present;
  - `docs/privacy-notice.ko.md` is copied verbatim from `ko.privacy` (same sections, same order), including the
    data-flow line about `owner_status` and the stored activity going to the owner's Claude;
  - no movement, idle-trigger, nearby or four-tool wording remains (grep below);
  - the version strings match `PRIVACY_NOTICE_VERSION` and `INSTRUCTIONS_VERSION`.
- **Verify:**
  ```bash
  ! grep -RInE 'four (MCP |ENU Town )?tools|이동|on idle|WASD|근처|네 가지 도구' docs CLAUDE.md README.md claude
  grep -q '버전 2026-11' docs/privacy-notice.ko.md && pnpm check:policy
  ```

### Final gate (after WP-E)
```bash
pnpm install && pnpm check:policy && pnpm lint && pnpm typecheck && pnpm test
pnpm sprites:build && pnpm map:check && pnpm db:migrate && pnpm test:int && pnpm test:e2e
```

---

## Appendix: Review resolutions

All 34 review items were checked against the repo at `84f90e4`; every cited file and line matched. None was rejected
outright. Where the review offered alternatives, the smaller or more protective one was chosen, as noted.

| # | Result | Resolution |
|---|---|---|
| 1 | fixed | Both halves. `now` and the log only **label** (rows 7–8 `shown = live`; plate label otherwise, §1.3), and §1.2, the legend and the notice now say plainly that "Claude 보고" is the owner's Claude's judgement from recent work traces. A `now: null` removes a label, never a person |
| 2 | fixed | `indicator = Dots` only while a bubble is active ∧ the owner is shown (`indicatorAllowed` hook + re-derived in `evaluate`); forced quiet while `!officeOpen`; matrix row added (§3.3, §5.7) |
| 3 | fixed | Server gate `projected(id).online`, identical `NOT_ONLINE` for every failure; `online = connected (no grace, no hold) ∧ show_live ∧ shown ∧ officeOpen`; ping-parity test in `privacy.int` |
| 4 | fixed | `activity.post`/`activity.skipped` audited with **no metadata**; `status:set` and `show_live` explicitly not audited; int test (§4.1, §9.2) |
| 5 | fixed | `PersonDto` drops `statusText`/`lastWorkLogAt`; colleague `WorkLogDto` timestamps are `null` via `canViewLogTimestamps` (period dates + `본인 수정` flag kept); 위치 row deleted. `stale` is kept: it is the existing day-granular link state, not a timestamp |
| 6 | fixed | `work_log_changed.by`; `logPulse` bumps only for `by='claude'` ∧ office open ∧ shown ∧ share ∧ colleague-visible; tests at fake 20:00 and for user edits |
| 7 | fixed | The projection writes `until=0`, `source=None` for `absent` (unit, Director and `privacy.int` tests). `resolveActivity` keeps `block.end` internally because it is owner-side truth that never reaches shared state |
| 8 | fixed | New `projectForColleagues` in `visibility.ts` owns office-hours neutrality, `online`, `until` masking, `statusText` and the group-consent rule; `canShowLive`/`canViewLogTimestamps` added; P8 and ADR 0003 updated |
| 9 | fixed | Same change as #1: a log never draws an avatar, so no one is drawn at a desk from a stale log |
| 10 | fixed | `SELECT … FOR UPDATE` on the profile row inside the write transaction; `PATCH` updates the same row in its transaction; race int test |
| 11 | fixed | `verifyTicket` refuses `notice_required` (onboarding + current notice); client maps it to `/welcome`; `onJoin` never creates actors (one roster reload, then `Forbidden`) |
| 12 | fixed | Join/leave/replace/drop log lines carry no `userId`; the notice says logs keep no per-user connection records |
| 13 | fixed | D1 rewritten to match §2.2 and declares §2.2 normative |
| 14 | fixed | Worker named as a second writer (expired values only, no NOTIFY); 상태 문구 does **not** expire (it is shown only while shown or away); `auto` clears `manual_status`/`until` only |
| 15 | fixed | Rule is `start_at ≥ 00:00 ∧ end_at ≤ next 00:00`; midnight edge cases added to `validation.test` |
| 16 | fixed | One constant (`NUDGE_POLICY.glanceHiddenMs` + `PolicyTiming`); order `due > urgent > join > eligible > glance`; `glance` shows the best nudge with `shownCount < maxShows`, so `max_shows` keeps its meaning and its docs need no change |
| 17 | fixed | D5 now says "≥ 2; gathered only when ≤ 3 and all shown" |
| 18 | fixed | Overview tightened to rows 4–21 (576 px); `fitZoom` takes the free area; tests at 1600×894 and 1120×844; e2e uses 1920×950; top-bar `−`/`+` kept as list steps, `zoomBias` deleted. No 1.25 step (smaller) |
| 19 | fixed | P5: the office day is `APP_TIMEZONE` for `period_key`, salt, validation, manual expiry, purge and client formatting (`MeDto.officeTimeZone`) |
| 20 | fixed | Group `until` = latest member `until`; §5.3 label table; effect indices 16–23; total overflow by BFS from guest spots; break facing down; perch = faced desk-surface tile; onDrop hold is live but not connected, grace from session end; first click = menu, second click = zoom; own-hidden texts; counts = `online`; `new Uint8Array(hkdfSync(…))` |
| 21 | fixed | Drizzle generates all DDL (CHECK declared in schema); the `DELETE … 'nearby'` is hand-inserted first; no repeated DROPs; truncated-journal `migrate.int` procedure spelled out (§7.1) |
| 22 | fixed | Runbook (§7.5): stop web/realtime/worker → `pg_dump` → migrate → up; rollback = restore the dump with the old images. Chosen over an additive/destructive split as smaller |
| 23 | fixed | Actors are mutated in place, never replaced; `desks_changed`-during-bubble int test |
| 24 | fixed | Protocol check in `onAuth`; `CloseCodes.ProtocolMismatch = 4111` with its own text and guarded reload; old clients fall to their existing `failed` state instead of the map text |
| 25 | fixed | §10 Web lists every "a Player exists" site and switches it to `online`/`shown`/`note`; desk clicks resolve by desk id; new `offlineAction` text |
| 26 | fixed | `Player.zoneId`, the 위치 row and `ko.townUi.profile.zone` deleted (P2) |
| 27 | fixed | `ChatItemDto.kind: 'dm' \| 'room'`, `zoneId` removed from shared/web DTOs, export and `RealtimeSession` |
| 28 | fixed | `auth.int`, `helpers/server.ts walk()`, `BubblePresenter.test`, `direction.test`, `events.int`, `api.int` nearby cases listed; `syncRoster(h)` → `resyncAll()` for DB-created users |
| 29 | fixed | `architecture.md:38`, `README.md:19`, `dev-connector.md`, exact notice row edits, data-flow line; grep widened to `four (MCP \|ENU Town )?tools\|이동\|on idle\|WASD\|근처\|네 가지 도구` (the onboarding replacement avoids "이동") |
| 30 | fixed | Guest spots derive from `world.spawn`; `chooseSpawn` stays deleted |
| 31 | fixed | `packages/testing` → WP-A; `dto.test.ts` → WP-B; WP-A pre-adds `ko.errors` keys (sequenced, never concurrent); `ko.privacy` is the single notice source and WP-F copies it after WP-E; frame indices fixed in §5.4 |
| 32 | fixed | All listed tests added (§9); ESLint bans `Math.random`, `Date.now`, `performance.now` and argument-less `new Date()`; the e2e spy asserts no `step`/`face` frames |
| 33 | fixed | Ref id part is `[!-~]{1,180}`; notice wording no longer says "암호화" and states operators use only matching; `now_reported_at` dropped |
| 34 | fixed | New persistent `show_live` (`접속 표시`, default on, D21): off means opening the town never draws me or my dot, and my plate shows only my name (no `자리 비움` note needed). Reciprocity is stated in the wizard, legend and notice |
