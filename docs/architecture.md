# ENU Den architecture

```
 employee browser ──HTTPS──┐                ┌── employee's own Claude (claude.ai / Cowork cloud) ── /api/mcp
 (messenger shell + town)  │                │   employee's PC: Claude Code + enu-den-channel plugin
                           ▼                ▼        ── bearer edc_ token ── /api/v1/pet-channel/{poll,replies}
                      Caddy :443  (TLS, strips /colyseus, drops _authToken from logs, skips poll logs)
            /colyseus/* │                           │  /, /api/*, /.well-known/*
                        ▼                           ▼
              realtime :2567  ◄──LISTEN──  Postgres  ◄──►  web :3000
              Colyseus room office-606     enu_den_events   Next 16: messenger pages, Better Auth (Google + OAuth AS),
              director · pets · chat ·                      /api/mcp (MCP tools), /api/v1 REST, pet channel long-poll,
              owner-only bubbles and                        realtime ticket
              owner-only `pet:changed`             ▲
                                            worker (pg-boss cron: nudge expiry, link state, retention, auth cleanup)
```

The web app writes every row. Realtime only pushes to screens and renders the town; it writes nothing new. The worker
only purges.

## Identity

- **Sign-in:** Google only, restricted to `ALLOWED_GOOGLE_HD`. Checks happen at five points:
  - Google's Internal consent screen
  - the verified `hd` claim in Better Auth
  - `validateUserInfo`
  - DB hooks
  - per-request session checks
- **Realtime:** the web app mints a 60-second HS256 ticket (aud `enu-den-realtime`). The Colyseus `onAuth` verifies the ticket on the matchmake request and re-reads the user from the DB; it also reads the client's `PROTOCOL_VERSION`, but a mismatch is refused at the start of `onJoin` with close code 4111, before any state is sent (Colyseus turns an `onAuth` error code into an HTTP status, so 4111 would not reach the client from there). Users who have not finished onboarding or accepted the current privacy notice are refused with `notice_required` and sent to `/welcome`.
- **One room:** realtime creates the persistent `office-606` room itself at boot. Clients may only `join` it (`matchMaker.controller.exposedMethods` leaves out `create` and `joinOrCreate`), and `OfficeRoom.onCreate` refuses a second instance, so nobody can start extra rooms (each would hold its own LISTEN connection and timers forever and split the town).
- **Claude connector:** ENU Den is the OAuth 2.1 authorization server (Better Auth `mcp()` + `cimd()` + `jwt()`). Access tokens are ES256 JWTs with `aud` = `https://<host>/api/mcp`. `resolveMcpCaller` rejects a token in three cases:
  - the user is inactive
  - the user is outside the domain
  - the token was issued before a revocation
    See [ADR 0001](adr/0001-auth-direction.md).

## Data flow of a check-in

1. Cowork runs the employee's scheduled task, which runs the `enu-den-checkin` skill.
2. The skill calls `get_my_context`. Outside work hours this returns `skip` and the skill stops. Its `activity` section tells Claude whether the owner shares activity, what it reported earlier today and any status the owner set by hand. Its `pet_inbox` lists the owner's messages to their pets that the connector may answer (never while `skip`).
3. `post_pet_reply` answers them through `postPetReplies` (`packages/mcp-tools/src/services/pet-replies.ts`), the same core the Claude Code pet channel uses: the first lane to answer wins (`decideReplyAdmission`), replies are verbatim or rejected, never above the question's visibility, and are not audited.
4. `post_work_log` upserts the day's log, keyed by `(user, local date)`. A company write that changes something visible also adds a `work_log_entries` row (what changed) for the work overview ([ADR 0007](adr/0007-work-overview.md)).
5. `post_activity` (only when the owner shares activity) → `activity_reports` (one row per user and office day: the `now` kind and until, today's calendar blocks, refs as keyed daily hashes) → `activity_changed` → the realtime director.
6. `upsert_todos` upserts by `external_ref`.
7. `post_pet_nudges` queues bubble text, which is shown verbatim.
8. Each write commits together with `NOTIFY enu_den_events`.
9. The realtime `DbEvents` listener reloads the owner's signals (activity report, log flags) and pet candidates.
10. `NudgeScheduler` (rules in `packages/domain/src/nudge-policy.ts`) chooses when to show a bubble: on join, when a nudge first becomes eligible, when the owner returns to the tab, or when something is due. It then sets the `.view()` bubble fields on the owner's pet. Only the owner's `StateView` contains their pet; colleagues see no sign of a bubble at all (the shared `indicator` stays 0): bubbles start only while the owner's tab is visible, so a shared "…" would tell colleagues when the owner looks at the town. A delivery row keeps only what the policy reads (no trigger) and survives only until the next 03:17 purge (today's count, the last 12 h of due keys). When the owner's session ends (leave or a replacing tab), any bubble on the long-lived pet is taken down.
11. When a colleague clicks an avatar or a desk plate, the profile card calls `/api/v1/users/:id/card`, which only returns logs that pass `canViewLog`.

## Messenger and pet conversations

The messenger is the `app/(den)` route group. Its layout owns the tab's one realtime session (a second tab takes it
over with 4101), the people directory, the map and my pets, so moving between rooms keeps them. The town is a panel
nobody steers: beside the conversation at 1280 px and wider, a drawer below that, a tab on phones. `/town` stays as
the full-screen view. See [ADR 0005](adr/0005-enu-den-messenger-and-pets.md) and `docs/design/messenger-spec.md`.

A message to one of my pets:

1. The room `POST`s `/api/v1/me/pets/:petId/messages` (`client_msg_id` makes it idempotent). The web app stores the
   row in `pet_messages`, keyed by my local date, and sends `NOTIFY pet_thread_changed` (ids only) in the same
   transaction. Text with PII is refused as company (`pii_public`); the UI offers to send it as 나만 보기.
2. After the commit, `wakeOwner` wakes any pet channel long-poll of mine that is waiting in this web process.
3. **Claude Code channel** ([ADR 0006](adr/0006-claude-code-pet-channel.md)): the `enu-den-channel` plugin on my PC
   polls `/api/v1/pet-channel/poll` with its `edc_` bearer token. Each poll claims up to 10 messages for 10 minutes and
   returns my pets' names and role instructions. The plugin turns them into channel events. My Claude Code answers
   with its `reply` tool → `/api/v1/pet-channel/replies`. This works at any time, because I started it.
4. **Check-in fallback:** the `pet_inbox` section of `get_my_context` and `post_pet_reply` answer during office hours
   only. Both lanes go through `postPetReplies`. The first answer wins (`decideReplyAdmission`) and also closes my
   earlier waiting messages to that pet. A reply is verbatim or rejected, never more visible than its question, and
   not audited.
5. Each reply sends `NOTIFY pet_thread_changed`. Realtime tells only the owner (`pet:changed {petId}`), and the room
   refetches over REST. The companion picks its expression from what happens in that room alone; the expression is
   never sent anywhere.

Colleagues read a pet room only over REST (`/api/v1/users/:id/pets/:petId/thread`), with no push. They get company
messages from the same day, and a reply only while its question is company. `ColleaguePetMessageDto` is
`{id, petId, author, text, dayKey}`: no times, sources, answer or read state. Whether my channel is live is kept only
in the web process's memory (`server/pet-channel/liveness.ts`); only I see it, through
`/api/v1/me/pet-channel/status`. Polls, replies and reads are not audited, and Caddy logs no line for the pet
channel, my pet rooms, the channel status or colleagues' pages and reads (`log_skip`).

## Work overview

[ADR 0007](adr/0007-work-overview.md). Under the town panel the messenger shows a feed of work-log changes; 크게
보기 opens a full-screen popup with the town, the feed and four widgets (team today, task totals by team, town now,
blockers).

1. `postWorkLog` adds a `work_log_entries` row in the write's transaction (company logs, non-empty `workLogDelta`)
   and marks the NOTIFY with `overview: true`. The owner's edit or delete of the log removes its rows.
2. Realtime broadcasts an empty `overview:changed`, only while the office is open; clients fetch
   `/api/v1/overview/feed` and `/api/v1/overview/today` again. It is immediate (3 s throttle) only when the feed dates
   the write anyway (the `logPulse` rule) or the person is shown; other changes go out in a 10-minute batch.
3. Reads join company, undeleted, unedited logs of active authors who accepted the current notice, and project them
   with `projectWorkLogFeed`. No ISO time, sequence or source leaves the server.
4. The nightly purge merges past days into one row per log without a time, so write times exist for the current
   office day only. The routes are skipped in the Caddy access log.
5. "Town now" is computed in the browser from the live roster (office hours only, never stored). Only one Phaser game
   runs: while the popup shows the town, the panel shows a placeholder.

## Town director

Nobody steers an avatar ([ADR 0004](adr/0004-town-is-a-visualization.md)). The room keeps one `Player` and that person's pets (keyed by pet id, the default pet in slot 0; protocol 3) per roster member (active, onboarded), whether or not anyone is connected, and the director in `apps/realtime/src/director` places them. Slot 0 follows its owner; the other pets copy its pose and the client fans them out. Pet changes made while the office is closed reach the town when it opens:

- **Inputs:** the owner's manual status, the town being open (gated by `show_live`), and, when the owner shares activity, today's `activity_reports` row and the colleague-visible log flags. Nothing else: no tab visibility, input events, mail or commit times.
- **Rules:** every second (and right after a status change or DB event) it runs `resolveActivity` and `projectForColleagues` for each person, `groupPeople` over the projected group keys, and `allocateSpots` (`packages/map/src/spots.ts`) for the target tiles: own desk, meeting chairs, a visitor tile at a colleague's desk, the pantry or the guest area. `Walker` walks a person to a new spot; arrivals and departures are a sparkle in place.
- **Labels only:** Claude's `now` report and today's log label an avatar or desk plate; they never make anyone appear.
- **Office hours:** outside business days 08:30–19:30 (`APP_TIMEZONE`) every `Player` is neutral (hidden, offline) and parked at its own seat (or the first guest spot) with `Idle`, so nothing tells who was in a meeting or at the pantry at closing; `logPulse` resets to 0, pets sleep and bubbles stay quiet.
- **No history:** the director persists nothing. Sessions and positions live in memory only, join/leave log lines carry no user id, the manual status is a current value in `profiles`, and `activity_reports` holds the current office day only (the worker purges older rows at 03:17). `logPulse` moves by a random non-zero step, so its value never counts log writes. Work-log ids are random UUIDv4 (a v7 id would carry the owner-only first-write time). Error logs go through `safeErr` (`packages/db`), which never writes a failed query's bound values (chat bodies, Claude's text, names).

## Names

| What                        | Name                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| Product                     | ENU Den (`APP_NAME` in `packages/shared/src/constants.ts`)                 |
| Host                        | `den.enu-tech.co.kr` (dev: `den-dev.<domain>`)                             |
| MCP server (serverInfo)     | `enu-den` (`MCP_SERVER_NAME`)                                              |
| Claude plugin and skills    | `enu-den` with `enu-den-checkin`, `enu-den-setup` (marketplace `enu-tech`) |
| Databases                   | `enu_den` (production), `enu_den_dev`, `enu_den_test`, `enu_den_e2e`       |
| NOTIFY channel              | `enu_den_events` (`TOWN_EVENTS_CHANNEL`)                                   |
| Realtime ticket audience    | `enu-den-realtime`                                                         |
| Advisory lock keys          | `enu_den_pet_species`, `enu-den:<scope>:<userId>`                          |
| Browser storage, debug hook | `enu-den:*`, `window.__ENU_DEN_DEBUG__`                                    |
| Docker                      | project `enu-den`, images `enu-den/{web,realtime,worker}`                  |

"town / 타운" is the name of the map view inside ENU Den, not the brand. Identifiers such as `notifyTown`,
`TOWN_EVENTS_CHANNEL`, the `/town` route and the MCP field `town_messages` keep that meaning.

## Packages

See `CLAUDE.md` for the package map. The key invariants live in pure functions with unit tests:

| File                                    | Invariant                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/visibility.ts`     | Who may see logs, chat summaries, pets and pet messages (a reply only while its question is company); `canShareActivity` and `canShowLive` gate activity and the online dot; `projectForColleagues` is the single colleague projection (neutral after hours, `부재` without end time) |
| `packages/domain/src/activity.ts`       | `resolveActivity`: who is shown and with which label, from real inputs only; Claude's `now` and the log only label                                                                                                                                                                    |
| `packages/domain/src/groups.ts`         | `groupPeople`: people are grouped only by mutual corroboration; meetings need 3 or more                                                                                                                                                                                               |
| `packages/domain/src/worklog-upsert.ts` | Owner edits, deletes and visibility always win                                                                                                                                                                                                                                        |
| `packages/domain/src/validation.ts`     | Text that breaks the rules is rejected, never rewritten; `post_activity` is rejected as a whole                                                                                                                                                                                       |
| `packages/domain/src/nudge-policy.ts`   | When a bubble may show (office hours, quiet hours, interval, daily cap, focus or meeting)                                                                                                                                                                                             |
| `packages/domain/src/worklog-delta.ts`  | What a Claude write changed (tasks added, status moves, blockers added, summary); empty when nothing visible changed                                                                                                                                                                  |
| `packages/domain/src/worklog-feed.ts`   | The work feed: `HH:MM` only for today's office-hours writes of authors who share activity; everything else one digest per person per day, ordered by team, desk and name                                                                                                              |
| `packages/domain/src/link-state.ts`     | Not linked / linked / stale                                                                                                                                                                                                                                                           |
| `packages/domain/src/pets.ts`           | Pet limits and looks; `decideReplyAdmission`: the first lane to answer wins, claims are 10-minute leases, the connector lane only in office hours                                                                                                                                     |
| `packages/map/src/spots.ts`             | Where the director may place people and pets; allocation is deterministic and never doubles up a tile                                                                                                                                                                                 |

## Map

Generated once from `packages/map/src/layouts/office-606.ts`. After that, `apps/web/public/assets/maps/office-606/office-606.tmj` is the source of truth, and you can edit it in Tiled. Team desks are ㄱ-shaped (a one-tile return beside each chair, so each pair sits in the inner corners of mirrored ㄱ shapes); R1 is an executive desk in front of the CEO, who faces L1b, with a return on his right toward the balcony door. `pnpm map:check` validates the map:

- seats are reachable
- the partition around the CEO desk works
- the server room cannot be entered
- the director spots are usable: meeting seats and pantry spots are walkable and reachable, and every desk has a visitor tile

It also writes the hash that realtime compares against.

## Art

All art is original pixel art defined in code (`packages/sprites`): avatars 32×32 in 4 directions with idle-bounce and hop-walk, fairy pets 24×24 with wings (every employee's default pet is a different species; extra pets use one of five tints, mixed into the species' own palette keys), companion expression sheets for the pet rooms (22 frames: idle, blink, listen, think, talk, happy, sleep), office tiles 32×32 and effects, including the activity icons shown over heads and desk plates. The web app renders avatar sheets and tinted pet and companion sheets on demand (`/api/sprites/avatar/:key`, `/api/sprites/pet/:key`). The build writes the pets, tiles and default avatars to `apps/web/public/assets`.

## Phase 2 seam

A future meeting voice room = the gathered meeting group: the members of an `ActivityGroup` with `family: 'meeting'` and `gather: true` from `groupPeople`. Nothing for voice or video exists yet; adding it needs its own ADR.
