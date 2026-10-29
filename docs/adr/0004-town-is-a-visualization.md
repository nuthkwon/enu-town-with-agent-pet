# ADR 0004 — The town is a visualization of teams at work, not a game people steer

Status: accepted (2026-10-29)

## Context

Owner intent: "사용자가 직접 키를 통해 움직이는 것이 아닙니다. 팀들이 업무를 하고 상호작용하는 것을 시각화하기
위함입니다." A Gather-style office where each person steers an avatar stores positions, rewards being visibly "at
the desk" and invites reading the map as attendance. In an employment relationship that is close to 근로자 감시.
The town should instead show what each person's own sources say about their work, and nothing else. The full
design, its alternatives and the review that shaped it are in
[the town visualization spec](../design/town-visualization-spec.md).

## Decision

1. **Nobody steers an avatar.** A server-side director in `apps/realtime` places every roster member (one `Player` and
   one `Pet` each, whether or not anyone is connected). Viewers watch, click people, chat and DM; keys and clicks
   never move anyone.
2. **Principles** (binding for every change to the town):
   - **P1** Every visible state has a source, and the source is shown (`직접 설정`, `캘린더 일정`, `Claude 보고`,
     `업무 로그`, `타운 접속`). The only exception is `부재`, which shows neither a source nor an end time.
   - **P2** Position means work state, not physical location. No random walks, invented breaks or fake typing; there is
     no "where" field.
   - **P3** Each person's state comes only from their own sources. Links between people exist only through mutual
     corroboration (item 4).
   - **P4** Current state only. ENU Den stores no presence or activity timeline: `activity_reports` holds the current
     day only, audit rows carry no activity metadata, logs carry no per-user connection lines, and colleague-facing REST
     carries no status or activity timestamps. Admins have no extra view.
   - **P5** Office hours only (business days 08:30–19:30, `kr_holidays`). The office day is `APP_TIMEZONE` (default
     Asia/Seoul) for every town rule; owner time zones are not used by the town.
   - **P6** The owner wins. A status set by hand beats Claude. Turning sharing off deletes today's Claude activity at
     once.
   - **P7** Everyone sees the same projection, the owner included.
   - **P8** One place decides what colleagues see: `packages/domain/src/visibility.ts` (`projectForColleagues`).
3. **One source of avatar state.** `resolveActivity` (`packages/domain/src/activity.ts`) computes the owner's state
   from exactly these inputs: the owner's manual status, the town being open (gated by `show_live`), and, when the
   owner shares activity, their Claude's accepted calendar blocks (`post_activity.schedule`). `projectForColleagues`
   decides what of it is shown. Claude's `now` report and today's work log **only label** an avatar or a desk plate;
   they never draw a person who is not otherwise shown. Tab visibility, keyboard or mouse input, e-mail, commit or MCP
   call times, link state and private logs are never inputs.
4. **Mutual corroboration only.** People are drawn together only when every member shares activity and each member's
   own Claude reported the same ref (`gcal:<iCalUID>`, `jira:ENU-123`, …), stored only as a keyed daily hash. A
   meeting needs at least 3 members (server-enforced, so 1:1s are never drawn as a pair); a same-work group needs 2 and
   gathers at the host's desk only when it has at most 3 members who are all shown. No tool field names a colleague.
5. **Nothing is shown after hours.** Outside office hours the shared state is neutral for everyone (all hidden, no
   online dots, pets asleep, pet bubbles quiet), the viewer's own avatar included.
6. **Explicit consent.** `share_activity` is an explicit owner choice made in the re-consent step with nothing
   preselected (`null` = not chosen = off). `show_live` (`접속 표시`) is on by default and stated as reciprocal
   ("서로 보기"); turning it off means opening the town never draws the owner.
7. **No presence or activity history, and no admin view of it.** Any proposal for attendance reports, presence or
   activity history, an admin activity view or a presence job needs a new ADR **and** an HR review.

## Consequences

- Removed: keyboard and click steering, proximity chat, stored positions (`user_presence`), chat recipients lists
  (`chat_message_recipients`) and chat zones (`chat_messages.zone_id`). Migration `0002_town_visualization` drops them,
  so the release needs a backup and cannot be rolled back by images alone (see the
  [admin runbook](../admin-runbook.ko.md)).
- A fifth MCP tool, `post_activity`, takes only enums, times and opaque refs; it carries no free text
  ([ADR 0002](0002-pet-text-source.md) addendum). Visibility rules for activity live in `visibility.ts`
  ([ADR 0003](0003-visibility.md) addendum).
- Pet bubbles stay owner-only, and colleagues see no sign of them: the shared `…` indicator is never set, because a
  bubble starts only while the owner's tab is visible (and `glance` right when it becomes visible again), so any shared
  onset would be the attention signal item 3 rules out. Bubble deliveries store no trigger and are kept only until
  the next nightly purge (today's count and the last 12 hours of due keys are all the policy reads).
- If calendar refs do not match across attendees, a meeting falls back to "each at their own desk with a headset",
  which is still truthful.
- The privacy notice moves to version 2026-11 and everyone accepts it again
  ([privacy notice](../privacy-notice.ko.md)).

## Not chosen

- Tab visibility as a presence signal (attention tracking).
- A Claude-written headline or label on the map (a new free-text and PII surface).
- Claude naming the colleagues someone works with (one person's Claude would make claims about another).
- Door walks on arrival and leaving (opening a tab is not entering the building).
- Remote / field-work badges (`부재` covers being out without giving a reason).

## Addendum (2026-10-29): ENU Den ([ADR 0005](0005-enu-den-messenger-and-pets.md))

- Item 1: the director keeps one `Player` per roster member and that member's pets (1–5 `Pet`s). The default pet
  leads; the others follow it. Pets never place or move anyone, and no pet is drawn without its owner's `Player`.
- Item 3 and P1: the input "the town being open" becomes "ENU Den being open": a realtime session in any view
  (messenger, pet room, town panel or full town), gated by `show_live`; its source label is `ENU Den 접속`. Tab
  visibility, which view is open, whether the town panel is collapsed and the Claude Code channel state are never
  inputs.
- Each active member's default pet has a different species; further pets may reuse a species with a tint.
- Bubbles keep this ADR's rules per pet: owner-only `.view()` fields, no shared indicator, office and quiet hours
  only. Pet conversation text is never drawn on the map. Pet changes made after hours reach the town when it opens.
- The companion's expressions are local to the owner's screen and never shared state.
- Item 7: ADR 0005 is the new ADR for the dated pet conversations colleagues can read; its HR review is in the list
  below.

## Addendum (2026-10-30): the work overview ([ADR 0007](0007-work-overview.md))

- P4: presence and activity stay current-state only. The feed lists work-log changes; the time of each write is kept
  for the current office day only and the nightly purge drops it, like `activity_reports`.
- Item 7: ADR 0007 is the new ADR for the feed and the overview; its HR review is in the list below.
- The overview's "town now" widget reads the same live projection as the map, in office hours only, and stores nothing.

## Review before rollout

The notice is a draft until these are done. Record the results here.

- [ ] Checked whether the town counts as a 근로자 감시 설비, with HR / legal: ________
- [ ] All-hands briefing and a round of employee feedback before go-live (even below 30 employees, where a 노사협의회
      is not required): date ________
- [ ] Management's written confirmation that the town is **not used for attendance, performance evaluation or
      discipline** (근태·평가 미사용): date ________, confirmed by (title, not name) ________, kept at ________
- [ ] ENU Den (ADR 0005): HR / legal review of pet conversations that colleagues can read the same day (dates, no
      times), the company default with the explicit 펫 대화 공유 step, and `접속` meaning "ENU Den open": ________
- [ ] Security review of the Claude Code pet channel (ADR 0006) and the S0 checks on the pinned Claude Code version:
      ________
- [ ] Claude organization: channels enabled, `enu-den-channel` allow-listed in managed settings, Always allow for the
      six connector tools: ________
- [ ] Old pilot database, volumes and backup destroyed after the cutover: date ________
- [ ] Work overview (ADR 0007): HR / legal review of the company-wide feed of work-log changes, its `HH:MM` times for
      today's office hours, the team totals and blockers board, and what untimed entries and weekend dates reveal
      about work outside office hours: ________
