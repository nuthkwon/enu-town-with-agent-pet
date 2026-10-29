# ADR 0003 — Work log visibility

Status: accepted (2026-10-29)

- Two levels: `private`, `company`. Default for work logs: company (owner can change per log or by default).
- The Claude work-conversation summary is private until the owner opts in, and never more visible than its log.
- Claude can only lower visibility (`min(requested, owner default)`); a visibility the owner set in the web UI
  (`visibility_set_by = 'user'`) is never overwritten by Claude.
- Logs the owner edited or deleted are never overwritten or resurrected by Claude.
- Decided in exactly one place: `packages/domain/src/visibility.ts`. Invisible = 404. Admins cannot read private logs.
- ENU Den never collects conversations held in claude.ai, Cowork or Claude Code (no transcripts, no history search,
  no Compliance API). A pet conversation ([ADR 0005](0005-enu-den-messenger-and-pets.md)) is not such a transcript: it
  holds only what the owner types into ENU Den and the replies the owner's Claude chooses to send back through ENU
  Den's tools.

## Addendum (2026-10-29): activity and the colleague projection ([ADR 0004](0004-town-is-a-visualization.md))

- `packages/domain/src/visibility.ts` also decides who sees the town's activity state:
  - `ANY_COLLEAGUE` — a viewer that never equals an owner id; log-derived signals (the `오늘 업무 기록` label and the
    log sparkle) use `canViewLog(ANY_COLLEAGUE, …)`.
  - `canShareActivity` — Claude-derived activity (calendar blocks, `now` reports, log-derived labels) may be shown
    only if the author is active and `share_activity === true`. `null` means not chosen, which is off.
  - `canShowLive` — having the town open may draw the owner and their online dot only if `show_live` is on.
  - `canViewLogTimestamps` — exact work-log timestamps are for the owner only. Colleague-facing DTOs return `null`
    for them and keep the period dates and the `본인 수정` flag; `PersonDto` has no `statusText` or `lastWorkLogAt`.
  - `projectForColleagues` — the single projection of `resolveActivity` into shared state:
    - office closed → `NEUTRAL_PROJECTION` for everyone;
    - `online` = connected now ∧ shown (no grace period, no reconnect hold);
    - `부재` (`note = absent`) carries no end time and no source;
    - 상태 문구 only while the owner is shown or `자리 비움`;
    - a group key only when the owner shares, so a group requires every member to share.
- Everyone, the owner included, sees the same projection. Claude can only send less (skip `post_activity`, `now:
null`); it can never turn sharing on. Only the owner can, explicitly.
- Admins see exactly what colleagues see; there is no admin view of activity or presence.

## Addendum (2026-10-29): pet conversations ([ADR 0005](0005-enu-den-messenger-and-pets.md))

- Same two levels. `canViewPet`, `canChatWithPet`, `canViewPetPrivateFields`, `canViewPetMessage`,
  `petMessageVisibility` and `petReplyVisibility` live in `packages/domain/src/visibility.ts`.
- A new owner message gets the requested visibility, else the pet's default, else the profile default
  (`company` unless the owner lowers it). The owner may raise or lower any message and hide a pet's history at once.
- Claude only lowers: a reply gets the lowest of the requested visibility, the pet's default and the visibility of
  the message it answers. When reading, a reply is visible only while its question is visible.
- Colleagues see the date only, never times; ids are UUIDv4. No live push and no typing, read, pending, answered or
  reply-path signal. Invisible messages are absent (404 for direct reads). Authors must be active.
- Owner-only: role instructions, reply routes, exact times, to-dos, nudges, the channel state. Pet names and looks
  are company-wide.
- Admins see exactly what colleagues see; they cannot read private pet messages.
