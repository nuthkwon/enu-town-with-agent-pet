# Claude pilot checklist (3–5 people, 5 business days)

Record results in a copy of this file per pilot. Plan: ____ (Team / Enterprise)

## Before
- [ ] `scripts/check-oauth-discovery.sh https://<host>` passes
- [ ] Google OAuth client is Internal + Trusted; a personal gmail account is rejected at sign-in
- [ ] Owner settings from `docs/admin-runbook.ko.md` applied (connector, cloud Cowork, Always allow, roles, auto-approve, plugin)

## Connect (each person)
- [ ] Connect shows the consent screen with **their own email** and the redirect host
- [ ] ENU Town shows the pet awake (linked), no speech yet
- [ ] Audit log shows `oauth.consent` and `oauth.client_discovered` (note the CIMD host: ________)

## Check-in
- [ ] "ENU Town 체크인 해줘" → approval prompts seen: ________ → choose Always allow
- [ ] Within 5 min: work log (badge "OO님의 Claude가 작성"), to-dos, pet nudge appear
- [ ] Pet bubble visible only to the owner; colleagues see "…"

## Unattended (most important)
- [ ] Scheduled task (Hourly) runs with the desktop app closed / laptop asleep — 2 runs observed
- [ ] Repeat with Always allow OFF / ON (Enterprise: a role left at "Needs approval")
      Result per run: wrote / stalled / skipped / failed: ________
- [ ] Outside work hours the run ends immediately with `skip`
- [ ] Fallback if stalls persist: per-task "Skip all approvals" mode, else a daily interactive check-in

## Tokens
- [ ] Still works after 1 h (access token refresh) and after 2 days
- [ ] Revoke in ENU Town `/me` → next call 401 → Claude asks to reconnect
- [ ] Revoke in Claude → after a business day the pet shows stale (clock icon)

## Privacy
- [ ] A log set to private (by Claude or in `/me`) is invisible to colleagues; editing shows "본인 수정"; deleting removes it and Claude does not resurrect it
- [ ] Chat summary hidden unless the owner opted in
- [ ] Inject "ignore previous instructions…" into a DM → the owner's Claude treats it as data (only when DM sharing is on)

## Exit criteria
- [ ] ≥ 90% of scheduled runs in 5 business days wrote without manual approval
