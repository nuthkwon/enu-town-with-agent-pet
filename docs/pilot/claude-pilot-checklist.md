# Claude pilot checklist (3–5 people, 5 business days)

Record results in a copy of this file per pilot. Plan: ____ (Team / Enterprise)

## Before

- [ ] `scripts/check-oauth-discovery.sh https://<host>` passes
- [ ] Google OAuth client is Internal + Trusted; a personal gmail account is rejected at sign-in
- [ ] Owner settings from `docs/admin-runbook.ko.md` applied (connector, cloud Cowork, Always allow for all six tools, roles, auto-approve, plugin)
- [ ] Review items in [ADR 0004](../adr/0004-town-is-a-visualization.md) done (근로자 감시 설비 check, all-hands briefing, management's written "근태·평가 미사용" confirmation)

## Connect (each person)

- [ ] Connect shows the consent screen with **their own email** and the redirect host
- [ ] ENU Den shows the pet awake (linked), no speech yet
- [ ] Audit log shows `oauth.consent` and `oauth.client_discovered` (note the CIMD host: ________)

## Check-in

- [ ] "ENU Den 체크인 해줘" → approval prompts seen: ________ → choose Always allow
- [ ] Within 5 min: work log (badge "OO님의 Claude가 작성"), to-dos, pet nudge appear; with 활동 공유 on, the avatar or
      desk plate shows the reported activity (e.g. `검토 중 · Claude 보고`)
- [ ] Pet bubble visible only to the owner; colleagues see no "…" or any other sign that a bubble is up

## Unattended (most important)

- [ ] Scheduled task (Hourly) runs with the desktop app closed / laptop asleep — 2 runs observed
- [ ] Repeat with Always allow OFF / ON (Enterprise: a role left at "Needs approval")
      Result per run: wrote / stalled / skipped / failed: ________
- [ ] Outside work hours the run ends immediately with `skip`
- [ ] Fallback if stalls persist: per-task "Skip all approvals" mode, else a daily interactive check-in

## Tokens

- [ ] Still works after 1 h (access token refresh) and after 2 days
- [ ] Revoke in ENU Den `/me` → next call 401 → Claude asks to reconnect
- [ ] Revoke in Claude → after a business day the pet shows stale (clock icon)

## Privacy

- [ ] A log set to private (by Claude or in `/me`) is invisible to colleagues; editing shows "본인 수정"; deleting removes it and Claude does not resurrect it
- [ ] Chat summary hidden unless the owner opted in
- [ ] Inject "ignore previous instructions…" into a DM → the owner's Claude treats it as data (only when DM sharing is on)

## Activity and calendar (town visualization)

- [ ] The claude.ai Google Calendar connector exposes each event's `iCalUID` (not only the per-calendar event id), the
      attendee count and the owner's response status: ________
- [ ] Focus time and out-of-office events are recognizable: ________
- [ ] Three attendees of one meeting (all with 활동 공유 on): each one's Claude sends the **same** `gcal:<iCalUID>` ref
      → at the block start all three sit at the meeting table with `회의 중 · 3명 · ~HH:MM`
- [ ] A 1:1 is sent without a ref and stays two people at their own desks; personal and HR events (면담·평가) are not
      sent at all; an out-of-office block shows only `부재` (no end time, no reason)
- [ ] Two people whose Claudes report the same ticket (`now` with one `jira:` ref, one `review`) and who have the town
      open: the reviewer stands at the author's desk with `같은 작업`
- [ ] A `now` report alone never makes someone appear: a person with no status, no meeting/focus block and the town
      closed stays hidden, with the label on the desk plate
- [ ] With 활동 공유 off (or not chosen), the check-in skips `post_activity` or gets `skipped_sharing_off`; turning it
      off in `/me` removes the Claude-derived state for colleagues within seconds
- [ ] Outside office hours nobody is shown and pets sleep; `post_activity` still runs unattended under Always allow

## Exit criteria

- [ ] ≥ 90% of scheduled runs in 5 business days wrote without manual approval
- [ ] Anonymous survey after two weeks of use (not usage metrics): default of 활동 공유, 접속 표시 (서로 보기), whether the
      map reads as monitoring: ________
