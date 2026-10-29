# ADR 0003 — Work log visibility

Status: accepted (2026-10-29)

- Two levels: `private`, `company`. Default for work logs: company (owner can change per log or by default).
- The Claude work-conversation summary is private until the owner opts in, and never more visible than its log.
- Claude can only lower visibility (`min(requested, owner default)`); a visibility the owner set in the web UI
  (`visibility_set_by = 'user'`) is never overwritten by Claude.
- Logs the owner edited or deleted are never overwritten or resurrected by Claude.
- Decided in exactly one place: `packages/domain/src/visibility.ts`. Invisible = 404. Admins cannot read private logs.
- No raw Claude conversations, no Compliance API.

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
